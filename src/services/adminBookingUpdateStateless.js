const { processAdminBookingUpdateMessage } = require('./adminBookingUpdate');
const { processAdminAppointmentCancellationMessage, hasPendingCancellationIntent } = require('./adminAppointmentCancellation');
const { pool } = require('../db/pool');
const { checkClinicHours } = require('./clinicHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');

function appointmentIdFromBody(body = '') {
  const match = String(body || '').match(/Manage booking #(\d+)/i);
  return match ? Number(match[1]) : null;
}

function scopeId(id, appointmentId) {
  const raw = String(id || '');
  if (!appointmentId) return raw;
  if (raw === 'manage_change_service') return `manage_change_service_${appointmentId}`;
  if (raw === 'manage_cancel_booking') return `manage_cancel_booking_${appointmentId}`;
  if (raw === 'manage_booking_menu') return `manage_booking_menu_${appointmentId}`;
  if (raw === 'manage_booking_back') return `manage_booking_back_${appointmentId}`;
  const servicePick = raw.match(/^manage_service_pick_(\d+)$/i);
  if (servicePick) return `manage_service_pick_${appointmentId}_${servicePick[1]}`;
  const servicePage = raw.match(/^manage_service_page_(\d+)$/i);
  if (servicePage) return `manage_service_page_${appointmentId}_${servicePage[1]}`;
  return raw;
}

function addCancellationRow(rows) {
  if (!Array.isArray(rows)) return rows;
  const isManageMenu = rows.some((row) => row?.id === 'manage_change_service')
    && rows.some((row) => row?.id === 'manage_change_price')
    && rows.some((row) => row?.id === 'manage_booking_back');
  if (!isManageMenu || rows.some((row) => row?.id === 'manage_cancel_booking')) return rows;
  const next = [...rows];
  const backIndex = next.findIndex((row) => row?.id === 'manage_booking_back');
  const cancelRow = { id: 'manage_cancel_booking', title: 'Cancel booking', description: 'Cancel this appointment safely' };
  if (backIndex >= 0) next.splice(backIndex, 0, cancelRow);
  else next.push(cancelRow);
  return next;
}

function scopeRows(rows, appointmentId) {
  const prepared = addCancellationRow(rows);
  return Array.isArray(prepared) ? prepared.map((row) => ({ ...row, id: scopeId(row.id, appointmentId) })) : prepared;
}

function scopeAdminBookingInteractive(result) {
  if (!result?.interactive) return result;
  const appointmentId = appointmentIdFromBody(result.interactive.body);
  if (!appointmentId) return result;
  const interactive = { ...result.interactive };
  if (Array.isArray(interactive.rows)) interactive.rows = scopeRows(interactive.rows, appointmentId);
  if (Array.isArray(interactive.buttons)) interactive.buttons = scopeRows(interactive.buttons, appointmentId);
  if (Array.isArray(interactive.sections)) interactive.sections = interactive.sections.map((section) => ({ ...section, rows: scopeRows(section.rows, appointmentId) }));
  return { ...result, interactive };
}

async function primeAppointment(sender, appointmentId) {
  const opened = await processAdminBookingUpdateMessage(sender, 'Manage a booking');
  if (!opened?.handled) return opened;
  return processAdminBookingUpdateMessage(sender, `manage_booking_select_${appointmentId}`);
}

async function activePackageChoices(appointmentId) {
  const r = await pool.query(`
    SELECT sp.session_service_id AS id, s.name, s.duration_minutes, sp.name AS package_name,
           e.id AS entitlement_id, e.expires_at, e.sessions_total,
           e.sessions_total - COUNT(red.id)::int AS credits_remaining
      FROM appointments a
      JOIN client_package_entitlements e ON e.client_id=a.client_id
      JOIN service_packages sp ON sp.id=e.package_id AND sp.status='active'
      JOIN services s ON s.id=sp.session_service_id AND s.status='active'
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.staff_id IS NOT NULL
      JOIN staff_services ss ON ss.staff_id=ast.staff_id AND ss.service_id=s.id
      LEFT JOIN package_session_redemptions red ON red.entitlement_id=e.id AND red.status IN ('reserved','redeemed')
     WHERE a.id=$1
       AND e.status='active' AND e.payment_status='paid'
       AND NOW() >= e.starts_at AND NOW() < e.expires_at
       AND a.starts_at >= e.starts_at AND a.starts_at < e.expires_at
       AND NOT EXISTS (SELECT 1 FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_id=s.id)
     GROUP BY sp.session_service_id,s.name,s.duration_minutes,sp.name,e.id,e.expires_at,e.sessions_total
    HAVING e.sessions_total - COUNT(red.id)::int > 0
     ORDER BY e.expires_at,sp.name`, [appointmentId]);
  return r.rows;
}

async function addPackageChoices(appointmentId, result) {
  if (!result?.handled || result?.interactive?.type !== 'list' || !Array.isArray(result.interactive.rows)) return result;
  const packages = await activePackageChoices(appointmentId);
  if (!packages.length) return result;
  const rows = [...result.interactive.rows];
  let insertAt = rows.findIndex((row) => /^manage_service_page_|^manage_booking_menu$/.test(String(row.id || '')));
  if (insertAt < 0) insertAt = rows.length;
  for (const pkg of packages) {
    rows.splice(insertAt++, 0, {
      id: `manage_service_pick_${pkg.id}`,
      title: 'Sports Massage Package',
      description: `${pkg.duration_minutes} min · Package credit · ${pkg.credits_remaining} left`.slice(0, 72),
    });
  }
  return { ...result, interactive: { ...result.interactive, rows } };
}

async function isPackageService(serviceId) {
  const r = await pool.query(`SELECT sp.id package_id,sp.name package_name,s.id service_id,s.name service_name,s.duration_minutes FROM service_packages sp JOIN services s ON s.id=sp.session_service_id WHERE sp.session_service_id=$1 AND sp.status='active' AND s.status='active'`, [serviceId]);
  return r.rows[0] || null;
}

async function changeToPackageService(sender, appointmentId, serviceId) {
  const pkg = await isPackageService(serviceId);
  if (!pkg) return null;
  const adminResult = await pool.query(`SELECT id,display_name FROM staff_admin_accounts WHERE normalized_whatsapp=regexp_replace($1,'\\D','','g') AND active=TRUE`, [sender]);
  const admin = adminResult.rows[0];
  if (!admin) return { handled: false };

  const contextResult = await pool.query(`
    SELECT a.id,a.client_id,a.location_id,a.starts_at,a.ends_at,a.total_price,a.currency,
           COALESCE(c.display_name,a.source_client_name,'Client') client_name,
           l.name location_name,
           ast.staff_id,COALESCE(st.display_name,ast.staff_name_snapshot) staff_name,
           aps.id appointment_service_id,COALESCE(s0.name,aps.service_name_snapshot) old_service
      FROM appointments a
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN locations l ON l.id=a.location_id
      JOIN appointment_staff ast ON ast.appointment_id=a.id
      LEFT JOIN staff st ON st.id=ast.staff_id
      JOIN appointment_services aps ON aps.appointment_id=a.id
      LEFT JOIN services s0 ON s0.id=aps.service_id
     WHERE a.id=$1 AND a.status NOT IN ('cancelled','no_show')`, [appointmentId]);
  if (contextResult.rowCount !== 1) return { handled: true, admin, reply: 'Package conversion is currently limited to single-service, single-practitioner bookings.' };
  const a = contextResult.rows[0];
  const starts = new Date(a.starts_at);
  const ends = new Date(starts.getTime() + Number(pkg.duration_minutes) * 60000);
  const clinic = await checkClinicHours({ locationId: a.location_id, startsAt: starts, endsAt: ends });
  if (!clinic.covered) return { handled: true, admin, reply: 'The package session would fall outside clinic hours. No change was saved.' };
  const schedule = await checkAuthoritativeSchedule({ staffId: a.staff_id, locationId: a.location_id, startsAt: starts, endsAt: ends });
  if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) return { handled: true, admin, reply: 'The 50-minute package session does not fit the practitioner schedule at this time. No change was saved.' };
  const conflict = await pool.query(`SELECT a.id FROM appointments a JOIN appointment_staff ast ON ast.appointment_id=a.id WHERE ast.staff_id=$1 AND a.id<>$2 AND a.status NOT IN ('cancelled','no_show') AND a.starts_at<$4 AND a.ends_at>$3 LIMIT 1`, [a.staff_id, appointmentId, starts, ends]);
  if (conflict.rowCount) return { handled: true, admin, reply: 'The 50-minute package session would conflict with another CRM appointment. No change was saved.' };
  const db = await pool.connect();
  let entitlement;
  try {
    await db.query('BEGIN');
    const entitlementResult = await db.query(`
      SELECT e.id,e.sessions_total,e.expires_at
        FROM client_package_entitlements e
       WHERE e.client_id=$1 AND e.package_id=$2 AND e.status='active' AND e.payment_status='paid'
         AND NOW() >= e.starts_at AND NOW() < e.expires_at
         AND $3::timestamptz >= e.starts_at AND $3::timestamptz < e.expires_at
       ORDER BY e.expires_at,e.id FOR UPDATE`, [a.client_id, pkg.package_id, starts]);
    for (const candidate of entitlementResult.rows) {
      const used = await db.query(`SELECT COUNT(*)::int used FROM package_session_redemptions WHERE entitlement_id=$1 AND status IN ('reserved','redeemed')`, [candidate.id]);
      if (Number(used.rows[0].used) < Number(candidate.sessions_total)) { entitlement = { ...candidate, remaining: Number(candidate.sessions_total) - Number(used.rows[0].used) }; break; }
    }
    if (!entitlement) { await db.query('ROLLBACK'); return { handled: true, admin, reply: 'This client does not currently have a paid, active Sports Massage package credit valid for this appointment. No change was saved.' }; }
    const mapped = await db.query(`SELECT 1 FROM staff_services WHERE staff_id=$1 AND service_id=$2`, [a.staff_id, serviceId]);
    if (!mapped.rowCount) { await db.query('ROLLBACK'); return { handled: true, admin, reply: `${a.staff_name} is not authorized for the Sports Massage package session. No change was saved.` }; }
    await db.query(`UPDATE appointment_services SET service_id=$1,service_name_snapshot=$2,duration_minutes_snapshot=$3,price_snapshot=0 WHERE id=$4`, [serviceId, pkg.service_name, pkg.duration_minutes, a.appointment_service_id]);
    await db.query(`INSERT INTO package_session_redemptions(entitlement_id,appointment_id,status) VALUES($1,$2,'reserved') ON CONFLICT (appointment_id) DO UPDATE SET entitlement_id=EXCLUDED.entitlement_id,status='reserved',reserved_at=NOW(),redeemed_at=NULL,released_at=NULL,updated_at=NOW()`, [entitlement.id, appointmentId]);
    await db.query(`UPDATE appointments SET ends_at=$1,title=$2,total_price=0,notes=CONCAT_WS(E'\\n',NULLIF(notes,''),'Prepaid Sports Massage monthly package session'),updated_at=NOW() WHERE id=$3`, [ends, pkg.service_name, appointmentId]);
    await db.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'appointment.service_updated','appointment',$2,$3::jsonb)`, [admin.id, String(appointmentId), JSON.stringify({ from: a.old_service, to: pkg.service_name, packageEntitlementId: entitlement.id, packageCreditReserved: true })]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }

  const refreshed = await primeAppointment(sender, appointmentId);
  if (!refreshed?.handled) return refreshed || { handled: false };
  const remainingAfter = entitlement.remaining - 1;
  return { ...refreshed, admin, interactive: refreshed.interactive ? { ...refreshed.interactive, body: `✅ Service changed to *${pkg.service_name}*. One prepaid package credit is reserved (${remainingAfter} remaining after this booking). Shiloh Calendar was updated.\n\n${refreshed.interactive.body}` } : refreshed.interactive };
}

async function processStatelessAdminBookingUpdateMessage(sender, text) {
  const raw = String(text || '').trim();

  let match = raw.match(/^manage_cancel_booking_(\d+)$/i);
  if (match) {
    return processAdminAppointmentCancellationMessage(sender, `cancel appointment #${Number(match[1])}`);
  }

  if (await hasPendingCancellationIntent(sender)) {
    const cancellation = await processAdminAppointmentCancellationMessage(sender, raw);
    if (cancellation?.handled) return cancellation;
  }

  match = raw.match(/^manage_change_service_(\d+)$/i);
  if (match) {
    const appointmentId = Number(match[1]);
    const primed = await primeAppointment(sender, appointmentId);
    if (!primed?.handled) return primed || { handled: false };
    const picker = await processAdminBookingUpdateMessage(sender, 'manage_change_service');
    return addPackageChoices(appointmentId, picker);
  }

  match = raw.match(/^manage_service_pick_(\d+)_(\d+)$/i);
  if (match) {
    const appointmentId = Number(match[1]);
    const serviceId = Number(match[2]);
    const primed = await primeAppointment(sender, appointmentId);
    if (!primed?.handled) return primed || { handled: false };
    const packageChange = await changeToPackageService(sender, appointmentId, serviceId);
    if (packageChange) return packageChange;
    const picker = await processAdminBookingUpdateMessage(sender, 'manage_change_service');
    if (!picker?.handled) return picker || { handled: false };
    return processAdminBookingUpdateMessage(sender, `manage_service_pick_${serviceId}`);
  }

  match = raw.match(/^manage_service_page_(\d+)_(\d+)$/i);
  if (match) {
    const appointmentId = Number(match[1]);
    const page = Number(match[2]);
    const primed = await primeAppointment(sender, appointmentId);
    if (!primed?.handled) return primed || { handled: false };
    const picker = await processAdminBookingUpdateMessage(sender, 'manage_change_service');
    if (!picker?.handled) return picker || { handled: false };
    const paged = await processAdminBookingUpdateMessage(sender, `manage_service_page_${page}`);
    return addPackageChoices(appointmentId, paged);
  }

  match = raw.match(/^manage_booking_menu_(\d+)$/i);
  if (match) return primeAppointment(sender, Number(match[1]));
  match = raw.match(/^manage_booking_back_(\d+)$/i);
  if (match) {
    const primed = await primeAppointment(sender, Number(match[1]));
    if (!primed?.handled) return primed || { handled: false };
    return processAdminBookingUpdateMessage(sender, 'manage_booking_back');
  }
  return { handled: false };
}

module.exports = { appointmentIdFromBody, scopeAdminBookingInteractive, processStatelessAdminBookingUpdateMessage, activePackageChoices, addPackageChoices, addCancellationRow };
