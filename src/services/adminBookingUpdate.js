const { pool } = require('../db/pool');
const { normalizePhone } = require('./clientIdentityOnboarding');
const { checkClinicHours } = require('./clinicHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');
const { listAvailableSlots } = require('./availabilityService');
const { getNextOpenClinicDates, shortDateTitle } = require('./clinicDateChoices');
const { compactListTitle, fullLabelDescription } = require('../presentation/whatsappListRowPresentation');
const {
  listEligibleReplacementServices,
  updateSingleAppointmentTreatment,
  updateAppointmentChargedPrice,
} = require('./appointmentTreatmentPriceMutation');

const sessions = new Map();
const SLOT_PAGE_SIZE = 8;
const MANAGE_LIST_SIZE = 9;
const SERVICE_PAGE_SIZE = 7;

function key(sender) { return normalizePhone(sender); }
function norm(v = '') { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function privileged(admin) { return ['jean-pierre', 'christel'].includes(norm(admin.display_name)) || norm(admin.role) === 'owner' || norm(admin.role) === 'admin'; }
function formatDT(v) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)); }
function formatTime(v) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)); }
function formatManageDate(v) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(v)); }
function parseLocal(v = '') { const m = String(v).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2})$/); if (!m) return null; const [, d, mo, y, h, mi] = m; const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${mi}:00+02:00`; const dt = new Date(iso); return Number.isNaN(dt.getTime()) ? null : dt; }
function parseDateOnly(v = '') { const m = String(v).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if (!m) return null; const [, d, mo, y] = m; const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; const probe = new Date(`${iso}T12:00:00+02:00`); return Number.isNaN(probe.getTime()) ? null : iso; }
function serviceTitle(v = '') { return compactListTitle(v, 'Service'); }
function money(v) { const n = Number(v); return Number.isFinite(n) ? `R${n.toFixed(2)}` : 'Price on request'; }

async function adminFor(sender) {
  const r = await pool.query(`SELECT id,staff_id,display_name,role,permissions FROM staff_admin_accounts WHERE normalized_whatsapp=$1 AND active=TRUE`, [key(sender)]);
  return r.rows[0] || null;
}

async function loadAppointment(admin, id) {
  const r = await pool.query(`SELECT a.id,a.client_id,a.location_id,a.starts_at,a.ends_at,a.status,a.total_price,a.currency,COALESCE(c.display_name,a.source_client_name,'Client') client_name,l.name location_name FROM appointments a LEFT JOIN clients c ON c.id=a.client_id LEFT JOIN locations l ON l.id=a.location_id WHERE a.id=$1 AND a.status NOT IN ('cancelled','no_show')`, [id]);
  if (!r.rowCount) return null;
  const a = r.rows[0];
  const staff = (await pool.query(`SELECT ast.staff_id,ast.staff_name_snapshot,s.display_name FROM appointment_staff ast LEFT JOIN staff s ON s.id=ast.staff_id WHERE ast.appointment_id=$1 ORDER BY ast.position`, [id])).rows;
  const services = (await pool.query(`SELECT aps.id,aps.service_id,aps.service_name_snapshot,aps.price_snapshot,aps.duration_minutes_snapshot,s.name,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes FROM appointment_services aps LEFT JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=$1 ORDER BY aps.position`, [id])).rows;
  if (!privileged(admin)) {
    if (!admin.staff_id || !staff.some((x) => Number(x.staff_id) === Number(admin.staff_id))) return { forbidden: true };
  }
  return { ...a, staff, services };
}

async function upcomingAppointmentsInteractive(admin) {
  const params = [];
  let scope = '';
  if (!privileged(admin)) {
    if (!admin.staff_id) return null;
    params.push(admin.staff_id);
    scope = `AND EXISTS (SELECT 1 FROM appointment_staff ast_scope WHERE ast_scope.appointment_id=a.id AND ast_scope.staff_id=$1)`;
  }
  params.push(MANAGE_LIST_SIZE);
  const limitParam = `$${params.length}`;
  const r = await pool.query(`
    SELECT a.id,a.starts_at,a.ends_at,
           COALESCE(c.display_name,a.source_client_name,'Client') client_name,
           COALESCE((SELECT string_agg(COALESCE(s.name,aps.service_name_snapshot), ' + ' ORDER BY aps.position)
                     FROM appointment_services aps LEFT JOIN services s ON s.id=aps.service_id
                     WHERE aps.appointment_id=a.id),'Service not recorded') service_name,
           COALESCE((SELECT string_agg(COALESCE(st.display_name,ast.staff_name_snapshot), ' + ' ORDER BY ast.position)
                     FROM appointment_staff ast LEFT JOIN staff st ON st.id=ast.staff_id
                     WHERE ast.appointment_id=a.id),'Practitioner not recorded') staff_name
    FROM appointments a
    LEFT JOIN clients c ON c.id=a.client_id
    WHERE a.status NOT IN ('cancelled','no_show') AND a.starts_at>=NOW() ${scope}
    ORDER BY a.starts_at,a.id
    LIMIT ${limitParam}`, params);
  if (!r.rowCount) return null;
  const rows = r.rows.map((a) => ({
    id: `manage_booking_select_${a.id}`,
    title: compactListTitle(`${formatTime(a.starts_at)} · ${a.client_name}`),
    description: fullLabelDescription(a.service_name, `${formatManageDate(a.starts_at)} · ${a.client_name} · ${a.staff_name}`),
  }));
  rows.push({ id: 'manage_booking_manual', title: 'Enter appointment no.', description: 'Use a Shiloh appointment number instead' });
  return {
    type: 'list',
    body: '*Manage a booking*\nHere are the upcoming appointments you are authorized to manage. Choose one to continue.',
    buttonText: 'Upcoming bookings',
    sectionTitle: 'Upcoming appointments',
    rows,
  };
}

async function audit(admin, appointmentId, action, metadata) {
  await pool.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'appointment',$3,$4::jsonb)`, [admin.id, action, String(appointmentId), JSON.stringify(metadata)]);
}

async function transaction(work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

function appointmentSummary(a) {
  const service = a.services.map((x) => x.name || x.service_name_snapshot).join(' + ');
  const staff = a.staff.map((x) => x.display_name || x.staff_name_snapshot).join(' + ');
  return [
    `*Manage booking #${a.id}*`,
    `👤 ${a.client_name}`,
    `✨ ${service || 'Service not recorded'}`,
    `💆 ${staff || 'Practitioner not recorded'}`,
    `🕘 ${formatDT(a.starts_at)}–${formatTime(a.ends_at)}`,
    `💰 ${a.total_price == null ? 'Not set' : `R${Number(a.total_price).toFixed(2)}`}`,
  ].join('\n');
}

function manageInteractive(a) {
  return {
    type: 'list',
    body: `${appointmentSummary(a)}\n\nChoose what you want to change. No customer message is sent until Shiloh customer-change notifications are enabled.`,
    buttonText: 'Manage booking',
    sectionTitle: 'Booking changes',
    rows: [
      { id: 'manage_change_service', title: 'Change service', description: 'Replace the booked service safely' },
      { id: 'manage_change_practitioner', title: 'Change practitioner', description: 'Move to an authorized practitioner' },
      { id: 'manage_change_time', title: 'Change date / time', description: 'Choose an authoritative available slot' },
      { id: 'manage_change_price', title: 'Change booked price', description: 'Update the canonical booked price' },
      { id: 'manage_booking_back', title: '← Back', description: 'Close booking management' },
    ],
  };
}

async function eligibleReplacementServices(a) {
  if (!a || a.services.length !== 1 || !a.services[0].service_id) return [];
  return listEligibleReplacementServices(pool, { appointmentId: a.id, currentServiceId: a.services[0].service_id });
}

function replacementServiceInteractive(a, services, page = 1) {
  const totalPages = Math.max(1, Math.ceil(services.length / SERVICE_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * SERVICE_PAGE_SIZE;
  const pageRows = services.slice(start, start + SERVICE_PAGE_SIZE).map((service) => {
    const minutes = Number(service.duration_minutes || 0) + Number(service.processing_time_minutes || 0) + Number(service.extra_time_minutes || 0);
    const price = service.display_price || (service.variable_price ? 'Variable price' : money(service.price));
    return {
      id: `manage_service_pick_${service.id}`,
      title: serviceTitle(service.name),
      description: fullLabelDescription(service.name, `${minutes || '?'} min · ${price}`),
    };
  });
  if (safePage > 1) pageRows.push({ id: `manage_service_page_${safePage - 1}`, title: '← Previous', description: 'Show previous services' });
  if (safePage < totalPages) pageRows.push({ id: `manage_service_page_${safePage + 1}`, title: 'More services →', description: 'Show more eligible services' });
  pageRows.push({ id: 'manage_booking_menu', title: '← Back', description: 'Return to booking changes' });
  const current = a.services[0]?.name || a.services[0]?.service_name_snapshot || 'current service';
  const staff = a.staff.map((x) => x.display_name || x.staff_name_snapshot).join(' + ') || 'assigned practitioner';
  if (!services.length) {
    return {
      type: 'button',
      body: `${appointmentSummary(a)}\n\nThere are no other active services currently authorized for ${staff}. The booked service remains *${current}*.`,
      buttons: [{ id: 'manage_booking_menu', title: 'Back' }],
    };
  }
  return {
    type: 'list',
    body: `${appointmentSummary(a)}\n\nChoose the replacement service for *${staff}*. The current service (*${current}*) is excluded. Availability and duration are re-checked before anything is saved.`,
    buttonText: 'Choose service',
    sectionTitle: `Eligible services ${safePage}/${totalPages}`.slice(0, 24),
    rows: pageRows,
  };
}

async function validateWindow(a, staffId, staffName, startsAt, endsAt) {
  const clinic = await checkClinicHours({ locationId: a.location_id, startsAt, endsAt });
  if (!clinic.covered) return 'That time falls outside clinic hours.';
  const schedule = await checkAuthoritativeSchedule({ staffId, locationId: a.location_id, startsAt, endsAt });
  if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) return 'That time falls outside the practitioner’s allowed schedule.';
  const c = await pool.query(`SELECT a.id FROM appointments a JOIN appointment_staff ast ON ast.appointment_id=a.id WHERE ast.staff_id=$1 AND a.id<>$2 AND a.status NOT IN ('cancelled','no_show') AND a.starts_at<$4 AND a.ends_at>$3 LIMIT 1`, [staffId, a.id, startsAt, endsAt]);
  if (c.rowCount) return 'That practitioner already has another CRM appointment at that time.';
  return null;
}

async function dateChoiceInteractive(a) {
  if (a.staff.length !== 1 || a.services.length !== 1 || !a.staff[0].staff_id || !a.services[0].service_id) {
    return {
      type: 'button',
      body: `${appointmentSummary(a)}\n\nThis booking has multiple resources, so Shiloh cannot safely calculate one-click replacement slots yet. Send the new date and time as *DD/MM/YYYY HH:MM* and it will still be fully re-checked before any change is saved.`,
      buttons: [{ id: 'manage_reschedule_manual', title: 'Enter date/time' }, { id: 'manage_booking_menu', title: 'Back' }],
    };
  }
  const dates = await getNextOpenClinicDates({ locationId: a.location_id, count: 2, maxDays: 21 });
  const buttons = dates.map((d) => ({ id: `manage_reschedule_date_${d.date}`, title: d.title.slice(0, 20) }));
  buttons.push({ id: 'manage_reschedule_other', title: 'Other date' });
  return {
    type: 'button',
    body: `${appointmentSummary(a)}\n\nChoose a date. Shiloh will show only slots that are currently bookable after clinic hours, practitioner schedule, canonical appointments and blocks are applied.`,
    buttons: buttons.slice(0, 3),
  };
}

async function slotsInteractive(a, date, page = 1) {
  if (a.staff.length !== 1 || a.services.length !== 1) return null;
  const staff = a.staff[0];
  const service = a.services[0];
  const result = await listAvailableSlots({ staffId: staff.staff_id, serviceId: service.service_id, date, locationId: a.location_id, intervalMinutes: 15, excludeAppointmentId: a.id });
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * SLOT_PAGE_SIZE;
  const pageSlots = result.slots.slice(offset, offset + SLOT_PAGE_SIZE);
  const hasNext = result.slots.length > offset + SLOT_PAGE_SIZE;
  const rows = pageSlots.map((slot) => ({ id: `manage_reschedule_slot_${new Date(slot.starts_at).getTime()}`, title: `${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}`.slice(0, 24), description: `${shortDateTitle(date)} · authoritative available slot`.slice(0, 72) }));
  if (hasNext) rows.push({ id: `manage_reschedule_slots_${date}_${safePage + 1}`, title: 'More times', description: 'Show later available times' });
  rows.push({ id: 'manage_reschedule_other', title: 'Choose another date', description: 'Enter or select a different date' });
  if (!rows.length || (rows.length === 1 && rows[0].id === 'manage_reschedule_other')) return { type: 'button', body: `*No authoritative slots found*\n${shortDateTitle(date)}\n\nNo currently bookable time remains on this date.`, buttons: [{ id: 'manage_reschedule_other', title: 'Another date' }, { id: 'manage_booking_menu', title: 'Back' }] };
  return { type: 'list', body: `*Available times — ${shortDateTitle(date)}*\nChoose a slot. Availability will be re-checked immediately before the booking is moved.`, buttonText: 'Available times', sectionTitle: 'Bookable slots', rows };
}

async function applyReschedule(admin, a, starts) {
  if (starts.getTime() <= Date.now()) return { reply: 'Choose a future date and time.' };
  const duration = new Date(a.ends_at) - new Date(a.starts_at);
  const ends = new Date(starts.getTime() + duration);
  if (a.staff.length !== 1) return { reply: 'Multi-practitioner time changes are not supported in this guarded flow yet.' };
  const st = a.staff[0];
  const problem = await validateWindow(a, st.staff_id, st.display_name || st.staff_name_snapshot, starts, ends);
  if (problem) return { reply: `${problem}\n\nNo change was saved. Choose another available time.` };
  await transaction(async (db) => {
    await db.query(`UPDATE appointments SET starts_at=$1,ends_at=$2,updated_at=NOW() WHERE id=$3`, [starts, ends, a.id]);
    await db.query(
      `UPDATE appointment_lifecycle
          SET appointment_at=$1,appointment_ends_at=$2,reminder_sent_at=NULL,updated_at=NOW()
        WHERE appointment_id=$3`,
      [starts, ends, a.id]
    );
  });
  const after = await loadAppointment(admin, a.id);
  await audit(admin, a.id, 'appointment.time_updated', { fromStart: a.starts_at, fromEnd: a.ends_at, toStart: starts, toEnd: ends, authoritativeSlotFlow: true });
  return { after };
}

async function processAdminBookingUpdateMessage(sender, text) {
  const admin = await adminFor(sender);
  if (!admin) return { handled: false };
  const raw = String(text || '').trim();
  const n = norm(raw);
  const k = key(sender);
  let s = sessions.get(k);

  if (['menu', 'admin menu', 'home', 'admin'].includes(n) || /^(hi|hello|hey|howzit|hiya|good morning|good afternoon|good evening)[!. ]*$/i.test(raw)) { sessions.delete(k); return { handled: false }; }

  if (['manage booking', 'manage a booking', 'update booking', 'edit booking'].includes(n)) {
    const interactive = await upcomingAppointmentsInteractive(admin);
    sessions.set(k, { step: interactive ? 'select' : 'id' });
    if (interactive) return { handled: true, admin, interactive };
    return { handled: true, admin, reply: ['*Manage a booking*', '', 'There are no upcoming appointments in your authorized scope.', 'You can still send a Shiloh appointment number.', '', '0️⃣ Back'].join('\n') };
  }

  if (!s) return { handled: false };
  if (['0', 'back', 'cancel', 'manage_booking_back'].includes(n)) { sessions.delete(k); return { handled: true, admin, reply: 'Booking update closed. Send *Menu* to return to Admin.' }; }

  if (s.step === 'select') {
    if (n === 'manage_booking_manual') { sessions.set(k, { step: 'id' }); return { handled: true, admin, reply: 'Send the Shiloh appointment number.' }; }
    const selected = raw.match(/^manage_booking_select_(\d+)$/i);
    if (!selected) return { handled: true, admin, interactive: await upcomingAppointmentsInteractive(admin) };
    const a = await loadAppointment(admin, Number(selected[1]));
    if (!a) return { handled: true, admin, reply: 'That booking is no longer available. Open Manage a booking again to refresh the list.' };
    if (a.forbidden) { sessions.delete(k); return { handled: true, admin, reply: "You don't have permission to manage that booking." }; }
    sessions.set(k, { step: 'menu', appointmentId: a.id });
    return { handled: true, admin, interactive: manageInteractive(a) };
  }

  if (s.step === 'id') {
    if (!/^\d+$/.test(raw)) return { handled: true, admin, reply: 'Please send the numeric Shiloh appointment number.' };
    const a = await loadAppointment(admin, Number(raw));
    if (!a) return { handled: true, admin, reply: 'I could not find an active booking with that appointment number.' };
    if (a.forbidden) { sessions.delete(k); return { handled: true, admin, reply: "You don't have permission to manage that booking." }; }
    sessions.set(k, { step: 'menu', appointmentId: a.id });
    return { handled: true, admin, interactive: manageInteractive(a) };
  }

  const a = await loadAppointment(admin, s.appointmentId);
  if (!a || a.forbidden) { sessions.delete(k); return { handled: true, admin, reply: 'That booking is no longer available to manage.' }; }
  if (n === 'manage_booking_menu') { sessions.set(k, { step: 'menu', appointmentId: a.id }); return { handled: true, admin, interactive: manageInteractive(a) }; }

  if (s.step === 'menu') {
    if (['1', 'change service', 'manage_change_service'].includes(n)) {
      if (a.services.length !== 1) return { handled: true, admin, reply: 'This is a multi-service booking. For safety, service replacement is currently limited to single-service bookings. You can still change practitioner, time, or booked price.' };
      const services = await eligibleReplacementServices(a);
      sessions.set(k, { step: 'service', appointmentId: a.id });
      return { handled: true, admin, interactive: replacementServiceInteractive(a, services, 1) };
    }
    if (['2', 'change practitioner', 'manage_change_practitioner'].includes(n)) { sessions.set(k, { step: 'staff', appointmentId: a.id }); return { handled: true, admin, reply: 'Send the exact practitioner name.' }; }
    if (['3', 'change date / time', 'change date/time', 'manage_change_time'].includes(n)) { sessions.set(k, { step: 'time_date', appointmentId: a.id }); return { handled: true, admin, interactive: await dateChoiceInteractive(a) }; }
    if (['4', 'change booked price', 'change price', 'manage_change_price'].includes(n)) { sessions.set(k, { step: 'price', appointmentId: a.id }); return { handled: true, admin, reply: 'Send the new booked price, for example *650* or *R650*.' }; }
    return { handled: true, admin, interactive: manageInteractive(a) };
  }

  const dateMatch = raw.match(/^manage_reschedule_date_(\d{4}-\d{2}-\d{2})$/i);
  const pageMatch = raw.match(/^manage_reschedule_slots_(\d{4}-\d{2}-\d{2})_(\d+)$/i);
  const slotMatch = raw.match(/^manage_reschedule_slot_(\d+)$/i);
  if (dateMatch || pageMatch) { const date = (dateMatch || pageMatch)[1]; const page = pageMatch ? Number(pageMatch[2]) : 1; sessions.set(k, { step: 'time_slot', appointmentId: a.id, date }); return { handled: true, admin, interactive: await slotsInteractive(a, date, page) }; }
  if (n === 'manage_reschedule_other') { sessions.set(k, { step: 'time_other_date', appointmentId: a.id }); return { handled: true, admin, reply: 'Send the date as *DD/MM/YYYY*. Shiloh will then show authoritative available times.' }; }
  if (n === 'manage_reschedule_manual') { sessions.set(k, { step: 'time_manual', appointmentId: a.id }); return { handled: true, admin, reply: 'Send the new date and time as *DD/MM/YYYY HH:MM*. It will be fully re-checked before saving.' }; }
  if (s.step === 'time_other_date') { const date = parseDateOnly(raw); if (!date) return { handled: true, admin, reply: 'Use *DD/MM/YYYY*, for example *18/08/2026*.' }; sessions.set(k, { step: 'time_slot', appointmentId: a.id, date }); return { handled: true, admin, interactive: await slotsInteractive(a, date, 1) }; }
  if (s.step === 'time_slot' && slotMatch) { const starts = new Date(Number(slotMatch[1])); if (Number.isNaN(starts.getTime())) return { handled: true, admin, reply: 'That slot is no longer valid. Choose another date/time.' }; const applied = await applyReschedule(admin, a, starts); if (applied.reply) return { handled: true, admin, reply: applied.reply }; sessions.set(k, { step: 'menu', appointmentId: a.id }); return { handled: true, admin, interactive: { ...manageInteractive(applied.after), body: `✅ Date/time updated in Shiloh Calendar.\n\n${manageInteractive(applied.after).body}` } }; }
  if (s.step === 'time_manual') { const starts = parseLocal(raw); if (!starts) return { handled: true, admin, reply: 'Use *DD/MM/YYYY HH:MM*, for example *18/08/2026 09:00*.' }; const applied = await applyReschedule(admin, a, starts); if (applied.reply) return { handled: true, admin, reply: applied.reply }; sessions.set(k, { step: 'menu', appointmentId: a.id }); return { handled: true, admin, interactive: { ...manageInteractive(applied.after), body: `✅ Date/time updated in Shiloh Calendar.\n\n${manageInteractive(applied.after).body}` } }; }

  if (s.step === 'service') {
    const services = await eligibleReplacementServices(a);
    const servicePageMatch = raw.match(/^manage_service_page_(\d+)$/i);
    if (servicePageMatch) return { handled: true, admin, interactive: replacementServiceInteractive(a, services, Number(servicePageMatch[1])) };
    const servicePickMatch = raw.match(/^manage_service_pick_(\d+)$/i);
    let service = servicePickMatch
      ? services.find((row) => Number(row.id) === Number(servicePickMatch[1]))
      : services.find((row) => norm(row.name) === n);
    if (!service) {
      return {
        handled: true,
        admin,
        interactive: replacementServiceInteractive(a, services, 1),
        reply: 'Choose one of the eligible services shown, or type its exact service name.',
      };
    }
    const minutes = Number(service.duration_minutes || 0) + Number(service.processing_time_minutes || 0) + Number(service.extra_time_minutes || 0);
    const starts = new Date(a.starts_at); const ends = new Date(starts.getTime() + minutes * 60000);
    if (a.staff.length === 1) { const problem = await validateWindow(a, a.staff[0].staff_id, a.staff[0].display_name || a.staff[0].staff_name_snapshot, starts, ends); if (problem) return { handled: true, admin, reply: `${problem}\n\nNo service change was saved. Choose another eligible service.` }; }
    await transaction((db) => updateSingleAppointmentTreatment(db, { appointmentId: a.id, appointmentServiceId: a.services[0].id, serviceId: service.id, serviceName: service.name, durationMinutes: service.duration_minutes, priceSnapshot: service.price, endsAt: ends }));
    const after = await loadAppointment(admin, a.id); await audit(admin, a.id, 'appointment.service_updated', { from: a.services[0].name || a.services[0].service_name_snapshot, to: service.name, selectedFromInteractiveList: Boolean(servicePickMatch) }); sessions.set(k, { step: 'menu', appointmentId: a.id });
    return { handled: true, admin, interactive: { ...manageInteractive(after), body: `✅ Service changed to *${service.name}* in Shiloh Calendar.\n\n${manageInteractive(after).body}` } };
  }

  if (s.step === 'staff') {
    const r = await pool.query(`SELECT id,display_name FROM staff WHERE status='active' AND resource_type='practitioner' AND LOWER(display_name)=LOWER($1)`, [raw]);
    if (r.rowCount !== 1) return { handled: true, admin, reply: 'Send the exact name of one active practitioner.' };
    const st = r.rows[0];
    if (!privileged(admin) && Number(admin.staff_id) !== Number(st.id)) return { handled: true, admin, reply: "You can only manage bookings inside your own practitioner scope." };
    for (const svc of a.services) { const ok = await pool.query(`SELECT 1 FROM staff_services WHERE staff_id=$1 AND service_id=$2`, [st.id, svc.service_id]); if (!ok.rowCount) return { handled: true, admin, reply: `${st.display_name} is not authorized for ${svc.name || svc.service_name_snapshot}.` }; }
    const problem = await validateWindow(a, st.id, st.display_name, a.starts_at, a.ends_at); if (problem) return { handled: true, admin, reply: problem };
    await transaction(async (db) => { await db.query(`DELETE FROM appointment_staff WHERE appointment_id=$1`, [a.id]); await db.query(`INSERT INTO appointment_staff(appointment_id,staff_id,position,staff_name_snapshot) VALUES($1,$2,1,$3)`, [a.id, st.id, st.display_name]); });
    const after = await loadAppointment(admin, a.id); await audit(admin, a.id, 'appointment.staff_updated', { from: a.staff.map((x) => x.display_name || x.staff_name_snapshot), to: st.display_name }); sessions.set(k, { step: 'menu', appointmentId: a.id });
    return { handled: true, admin, interactive: { ...manageInteractive(after), body: `✅ Practitioner changed to *${st.display_name}* in Shiloh Calendar.\n\n${manageInteractive(after).body}` } };
  }

  if (s.step === 'time') { const starts = parseLocal(raw); if (!starts) return { handled: true, admin, reply: 'Use *DD/MM/YYYY HH:MM*, for example 18/08/2026 09:00.' }; const applied = await applyReschedule(admin, a, starts); if (applied.reply) return { handled: true, admin, reply: applied.reply }; sessions.set(k, { step: 'menu', appointmentId: a.id }); return { handled: true, admin, interactive: manageInteractive(applied.after) }; }

  if (s.step === 'price') {
    const m = n.match(/^r?\s*(\d+(?:\.\d{1,2})?)$/); if (!m) return { handled: true, admin, reply: 'Send a valid booked price, for example *650* or *R650*.' };
    const price = Number(m[1]); if (price < 0 || price > 100000) return { handled: true, admin, reply: 'That price is outside the allowed range.' };
    await transaction((db) => updateAppointmentChargedPrice(db, { appointmentId: a.id, appointmentServiceId: a.services.length === 1 ? a.services[0].id : null, chargedPrice: price }));
    await audit(admin, a.id, 'appointment.price_updated', { from: a.total_price == null ? null : Number(a.total_price), to: price }); const after = await loadAppointment(admin, a.id); sessions.set(k, { step: 'menu', appointmentId: a.id });
    return { handled: true, admin, interactive: { ...manageInteractive(after), body: `✅ Booked price updated to *R${price.toFixed(2)}*. The calendar title remains price-free.\n\n${manageInteractive(after).body}` } };
  }

  return { handled: false };
}

module.exports = { manageInteractive, upcomingAppointmentsInteractive, eligibleReplacementServices, replacementServiceInteractive, dateChoiceInteractive, slotsInteractive, processAdminBookingUpdateMessage };
