const { pool } = require('../db/pool');
const { normalizePhone } = require('./clientIdentityOnboarding');
const { canAccessOwnFinalization, canCertifyAppointment, certificationStaffIds, authorityDescription } = require('./attendanceFinalizationAuthority');
const { processAdminBookingUpdateMessage } = require('./adminBookingUpdate');
const { processAdminAppointmentCancellationMessage, hasPendingCancellationIntent } = require('./adminAppointmentCancellation');
const { compactListTitle, fullLabelDescription } = require('../presentation/whatsappListRowPresentation');

// Reserve two of WhatsApp's 10 list rows for pagination and Back controls.
const PAGE_SIZE = 8;
const SERVICE_PAGE_SIZE = 8;
const FINAL_STATUSES = new Set(['completed', 'no_show', 'no_charge']);
// Temporary historical reconciliation window approved for the current backlog.
// Start is inclusive; end is exclusive so all of 15 Aug 2026 is included.
const HISTORICAL_WINDOW_START = '2026-08-01T00:00:00+02:00';
const HISTORICAL_WINDOW_END = '2026-08-16T00:00:00+02:00';

function key(sender) { return normalizePhone(sender); }
function has(admin, permission) { return admin?.permissions?.[permission] === true; }
function cleanName(value = '') { return String(value || '').trim().toLowerCase(); }
function isBusinessWide(admin) {
  return ['owner', 'business_admin'].includes(admin?.business_role) || admin?.calendar_scope === 'all_business';
}
function canUseDiscretionaryFinalization(admin) {
  return canAccessOwnFinalization(admin);
}
function formatDateTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
function money(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value));
}
function parseAdjustedPrice(value) {
  let text = String(value || '').trim().replace(/^R\s*/i, '').replace(/\s+/g, '');
  if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) return null;
  return Math.round(amount * 100) / 100;
}

async function getAdmin(sender) {
  const result = await pool.query(
    `SELECT id, staff_id, display_name, role, permissions, service_scope, business_role, calendar_scope
       FROM staff_admin_accounts
      WHERE normalized_whatsapp=$1 AND active=TRUE`,
    [key(sender)]
  );
  return result.rows[0] || null;
}

function scopeSql(alias = 'a') {
  return `(
    $1::boolean = TRUE
    OR (
      $2::bigint IS NOT NULL
      AND EXISTS (SELECT 1 FROM appointment_staff ast_scope WHERE ast_scope.appointment_id=${alias}.id AND ast_scope.staff_id=$2)
      AND EXISTS (
        SELECT 1 FROM appointment_services aps_scope
        JOIN staff_services ss_scope ON ss_scope.service_id=aps_scope.service_id AND ss_scope.staff_id=$2
        WHERE aps_scope.appointment_id=${alias}.id
      )
    )
  )`;
}

async function pendingPastAppointments(admin, page = 1) {
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * PAGE_SIZE;
  const certifiableStaff = await certificationStaffIds(admin);
  if (!certifiableStaff.length) return { rows: [], page: safePage, hasNext: false };
  const certifiableOnly = certifiableStaff.length > 0;
  const result = await pool.query(
    `SELECT a.id, a.starts_at, a.ends_at, a.status,
            COALESCE(c.display_name, a.source_client_name, 'Unknown client') AS client_name,
            COALESCE(string_agg(DISTINCT aps.service_name_snapshot, ', ') FILTER (WHERE aps.service_name_snapshot IS NOT NULL), '') AS services,
            COALESCE(string_agg(DISTINCT ast.staff_name_snapshot, ', ') FILTER (WHERE ast.staff_name_snapshot IS NOT NULL), '') AS staff
       FROM appointments a
       LEFT JOIN clients c ON c.id=a.client_id
       LEFT JOIN appointment_services aps ON aps.appointment_id=a.id
       LEFT JOIN appointment_staff ast ON ast.appointment_id=a.id
      WHERE a.ends_at < NOW()
        AND a.starts_at >= $7::timestamptz
        AND a.starts_at < $8::timestamptz
        AND a.status NOT IN ('completed','cancelled','no_show')
        AND ${scopeSql('a')}
        AND ($5::boolean = FALSE OR (
          EXISTS (SELECT 1 FROM appointment_staff ast_any WHERE ast_any.appointment_id=a.id AND ast_any.staff_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM appointment_staff ast_forbidden
             WHERE ast_forbidden.appointment_id=a.id
               AND ast_forbidden.staff_id IS NOT NULL
               AND NOT (ast_forbidden.staff_id = ANY($6::bigint[]))
          )
        ))
      GROUP BY a.id,a.starts_at,a.ends_at,a.status,c.display_name,a.source_client_name
      ORDER BY a.starts_at DESC,a.id DESC
      LIMIT $3 OFFSET $4`,
    [isBusinessWide(admin), admin.staff_id, PAGE_SIZE + 1, offset, certifiableOnly, certifiableStaff, HISTORICAL_WINDOW_START, HISTORICAL_WINDOW_END]
  );
  return { rows: result.rows.slice(0, PAGE_SIZE), page: safePage, hasNext: result.rows.length > PAGE_SIZE };
}

function pendingListInteractive(data, admin = null) {
  const rows = data.rows.map((row) => ({
    id: `finalize_appt_${row.id}`,
    title: compactListTitle(`#${row.id} ${row.client_name || 'Client'}`),
    description: fullLabelDescription(row.client_name || 'Client', `${formatDateTime(row.starts_at)} · ${row.services || row.staff || row.status}`),
  }));
  if (data.hasNext) rows.push({ id: `finalize_appts_page_${data.page + 1}`, title: 'More appointments', description: 'Show more visits from 1–15 Aug awaiting final status' });
  rows.push({ id: 'appointments', title: '← Back', description: 'Return to Appointments' });
  const authority = admin ? authorityDescription(admin) : null;
  return {
    type: 'list',
    body: data.rows.length
      ? `*Visits awaiting finalization — 1–15 Aug 2026*\nChoose a visit and record what actually happened.${authority ? `\nYou can certify: ${authority}.` : ''}`
      : '*Visits awaiting finalization — 1–15 Aug 2026*\nThere are no visits in this approved historical window awaiting final status in your authorized certification scope.',
    buttonText: 'Review visits', rows, sectionTitle: 'Awaiting finalization',
  };
}

async function refreshedQueueInteractive(admin, successMessage) {
  const data = await pendingPastAppointments(admin, 1);
  const interactive = pendingListInteractive(data, admin);
  return { ...interactive, body: `${successMessage}\n\n${interactive.body}` };
}

async function loadAuthorizedPendingAppointment(admin, appointmentId, db = pool, lock = false, {
  windowStart = HISTORICAL_WINDOW_START,
  windowEnd = HISTORICAL_WINDOW_END,
  allowStartedNoShow = false,
} = {}) {
  const attendanceBoundarySql = allowStartedNoShow ? 'a.starts_at <= NOW()' : 'a.ends_at < NOW()';
  const result = await db.query(
    `SELECT a.id,a.client_id,a.starts_at,a.ends_at,a.status,a.updated_at,a.total_price,a.financial_classification,a.pre_adjustment_total_price,
            COALESCE(c.display_name,a.source_client_name,'Unknown client') AS client_name,
            COALESCE((SELECT string_agg(DISTINCT aps.service_name_snapshot, ', ') FROM appointment_services aps WHERE aps.appointment_id=a.id AND aps.service_name_snapshot IS NOT NULL), '') AS services,
            COALESCE((SELECT string_agg(DISTINCT ast.staff_name_snapshot, ', ') FROM appointment_staff ast WHERE ast.appointment_id=a.id AND ast.staff_name_snapshot IS NOT NULL), '') AS staff
       FROM appointments a
       LEFT JOIN clients c ON c.id=a.client_id
      WHERE a.id=$3
        AND ${attendanceBoundarySql}
        AND a.starts_at >= $4::timestamptz
        AND a.starts_at < $5::timestamptz
        AND a.status NOT IN ('completed','cancelled','no_show')
        AND ${scopeSql('a')}
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    [isBusinessWide(admin), admin.staff_id, appointmentId, windowStart, windowEnd]
  );
  return result.rows[0] || null;
}

function appointmentDetails(appointment) {
  return [
    `*Finalize appointment #${appointment.id}*`, `👤 ${appointment.client_name}`,
    `✨ ${appointment.services || 'Service not recorded'}`, `💆 ${appointment.staff || 'Practitioner not recorded'}`,
    `🕘 ${formatDateTime(appointment.starts_at)}`,
  ].join('\n');
}

function decisionInteractive(appointment) {
  return {
    type: 'list',
    body: `${appointmentDetails(appointment)}\n\n*What actually happened with this visit?*`,
    buttonText: 'Choose outcome',
    sectionTitle: 'Visit outcome',
    rows: [
      { id: `finalize_completed_${appointment.id}`, title: 'Completed', description: 'Client attended as booked' },
      { id: `finalize_no_show_${appointment.id}`, title: 'No-show', description: 'Client did not attend' },
      { id: `finalize_cancelled_${appointment.id}`, title: 'Cancelled', description: 'Appointment was cancelled' },
      { id: `finalize_no_charge_${appointment.id}`, title: 'No charge', description: 'Client attended; R0 charge and R0 earnings' },
      { id: `finalize_service_change_${appointment.id}`, title: 'Service change', description: 'A different treatment was performed' },
      { id: `finalize_price_adjust_${appointment.id}`, title: 'Adjust price', description: 'Change the final amount charged' },
      { id: `finalize_reschedule_${appointment.id}`, title: 'Reschedule', description: 'Move the appointment to another date/time' },
      { id: 'finalize_back', title: 'Leave unresolved', description: 'Save no final outcome yet' },
    ],
  };
}

function reviewOnlyInteractive(appointment) {
  return {
    type: 'button',
    body: `${appointmentDetails(appointment)}\n\n🔒 Review only. Attendance must be certified by the assigned practitioner through their own linked Admin account.`,
    buttons: [{ id: 'finalize_back', title: 'Back' }],
  };
}

function priceEntryInteractive(appointment, prefix = '') {
  return {
    type: 'button',
    body: `${prefix ? `${prefix}\n\n` : ''}${appointmentDetails(appointment)}\n\nCurrent price: *${money(appointment.total_price)}*\n\nSend the final price in rand (for example: *550* or *R550.00*).\nFor a R0 visit, use *No charge* instead.`,
    buttons: [{ id: 'finalize_price_back', title: '← Back' }],
  };
}

function priceConfirmationInteractive(appointment, adjustedPrice) {
  return {
    type: 'button',
    body: `${appointmentDetails(appointment)}\n\nCurrent price: *${money(appointment.total_price)}*\nAdjusted final price: *${money(adjustedPrice)}*\n\nThis will finalize the visit as *Completed*. The adjusted value becomes the client charge and practitioner-earnings basis.`,
    buttons: [
      { id: 'finalize_price_confirm', title: 'Confirm price' },
      { id: 'finalize_price_back', title: '← Back' },
    ],
  };
}

async function getPriceAdjustmentIntent(sender) {
  const result = await pool.query(
    `SELECT phone,appointment_id,adjusted_price,status
       FROM admin_appointment_price_adjustment_intents
      WHERE phone=$1`,
    [key(sender)]
  );
  return result.rows[0] || null;
}
async function hasPendingPriceAdjustmentIntent(sender) { return Boolean(await getPriceAdjustmentIntent(sender)); }
async function savePriceAdjustmentIntent(sender, appointmentId, adjustedPrice, status) {
  const result = await pool.query(
    `INSERT INTO admin_appointment_price_adjustment_intents (phone,appointment_id,adjusted_price,status,updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (phone) DO UPDATE SET appointment_id=EXCLUDED.appointment_id,adjusted_price=EXCLUDED.adjusted_price,status=EXCLUDED.status,updated_at=NOW()
     RETURNING phone,appointment_id,adjusted_price,status`,
    [key(sender), appointmentId, adjustedPrice, status]
  );
  return result.rows[0];
}
async function clearPriceAdjustmentIntent(sender) {
  await pool.query(`DELETE FROM admin_appointment_price_adjustment_intents WHERE phone=$1`, [key(sender)]);
}

async function ensureServiceChangeSchema(db = pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS admin_appointment_service_change_intents (
    phone TEXT PRIMARY KEY,
    appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    proposed_service_id BIGINT REFERENCES services(id) ON DELETE SET NULL,
    adjusted_price NUMERIC(12,2),
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT admin_service_change_price_check CHECK (adjusted_price IS NULL OR adjusted_price >= 0),
    CONSTRAINT admin_service_change_status_check CHECK (status IN ('selecting_service','awaiting_service_confirmation','collecting_price','awaiting_price_confirmation'))
  )`);
}
async function getServiceChangeIntent(sender) {
  await ensureServiceChangeSchema();
  const result = await pool.query(
    `SELECT phone,appointment_id,proposed_service_id,adjusted_price,status
       FROM admin_appointment_service_change_intents WHERE phone=$1`,
    [key(sender)]
  );
  return result.rows[0] || null;
}
async function hasPendingServiceChangeIntent(sender) { return Boolean(await getServiceChangeIntent(sender)); }
async function saveServiceChangeIntent(sender, appointmentId, proposedServiceId, adjustedPrice, status) {
  await ensureServiceChangeSchema();
  const result = await pool.query(
    `INSERT INTO admin_appointment_service_change_intents (phone,appointment_id,proposed_service_id,adjusted_price,status,updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (phone) DO UPDATE SET appointment_id=EXCLUDED.appointment_id,proposed_service_id=EXCLUDED.proposed_service_id,
       adjusted_price=EXCLUDED.adjusted_price,status=EXCLUDED.status,updated_at=NOW()
     RETURNING phone,appointment_id,proposed_service_id,adjusted_price,status`,
    [key(sender), appointmentId, proposedServiceId, adjustedPrice, status]
  );
  return result.rows[0];
}
async function clearServiceChangeIntent(sender) {
  await ensureServiceChangeSchema();
  await pool.query(`DELETE FROM admin_appointment_service_change_intents WHERE phone=$1`, [key(sender)]);
}

async function currentAppointmentService(appointmentId, db = pool) {
  const result = await db.query(
    `SELECT aps.id,aps.service_id,aps.position,aps.service_name_snapshot,aps.price_snapshot,aps.duration_minutes_snapshot
       FROM appointment_services aps WHERE aps.appointment_id=$1 ORDER BY aps.position,aps.id`,
    [appointmentId]
  );
  if (result.rowCount !== 1) return { status: 'multi_service', rows: result.rows };
  return { status: 'single', row: result.rows[0] };
}

async function eligibleReplacementServices(appointmentId, db = pool) {
  const result = await db.query(
    `SELECT s.id,s.name,s.price,s.variable_price,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes
       FROM services s
      WHERE s.status='active'
        AND NOT EXISTS (
          SELECT 1 FROM appointment_staff ast
           WHERE ast.appointment_id=$1 AND ast.staff_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id=ast.staff_id AND ss.service_id=s.id)
        )
      ORDER BY s.name,s.id`,
    [appointmentId]
  );
  return result.rows;
}

function serviceChangeListInteractive(appointment, services, page = 1) {
  const safePage = Math.max(Number(page) || 1, 1);
  const start = (safePage - 1) * SERVICE_PAGE_SIZE;
  const slice = services.slice(start, start + SERVICE_PAGE_SIZE);
  const rows = slice.map((service) => ({
    id: `finalize_service_pick_${service.id}`,
    title: compactListTitle(service.name || 'Service'),
    description: fullLabelDescription(service.name || 'Service', `${service.variable_price ? 'Variable price' : money(service.price)} · ${Number(service.duration_minutes || 0) + Number(service.processing_time_minutes || 0) + Number(service.extra_time_minutes || 0)} min`),
  }));
  if (safePage > 1) rows.push({ id: `finalize_service_page_${safePage - 1}`, title: '← Previous', description: 'Show previous services' });
  if (start + SERVICE_PAGE_SIZE < services.length) rows.push({ id: `finalize_service_page_${safePage + 1}`, title: 'Next →', description: 'Show more services' });
  rows.push({ id: 'finalize_service_back', title: '← Back', description: 'Return to visit outcomes' });
  return {
    type: 'list',
    body: `${appointmentDetails(appointment)}\n\nChoose the *actual service performed*.`,
    buttonText: 'Choose service',
    sectionTitle: 'Actual service',
    rows,
  };
}

function serviceChangeReviewInteractive(appointment, oldService, newService, adjustedPrice = null) {
  const proposed = adjustedPrice !== null
    ? Number(adjustedPrice)
    : (newService.variable_price || newService.price == null ? Number(appointment.total_price || 0) : Number(newService.price));
  const priceNote = newService.variable_price || newService.price == null
    ? `Current charge retained: *${money(proposed)}*. Use *Adjust price* if the final charge differed.`
    : `Proposed final charge: *${money(proposed)}*.`;
  return {
    type: 'button',
    body: `${appointmentDetails(appointment)}\n\nOriginally booked: *${oldService.service_name_snapshot}*\nActually performed: *${newService.name}*\n${priceNote}\n\nConfirming will finalize the visit as *Completed* and preserve the original service in the audit trail.`,
    buttons: [
      { id: adjustedPrice === null ? 'finalize_service_confirm' : 'finalize_service_price_confirm', title: 'Confirm change' },
      { id: 'finalize_service_adjust_price', title: 'Adjust price' },
      { id: 'finalize_service_back', title: '← Back' },
    ],
  };
}

function serviceChangePriceEntryInteractive(appointment, oldService, newService, prefix = '') {
  return {
    type: 'button',
    body: `${prefix ? `${prefix}\n\n` : ''}${appointmentDetails(appointment)}\n\nOriginally booked: *${oldService.service_name_snapshot}*\nActually performed: *${newService.name}*\n\nSend the final amount charged in rand. *R0 is allowed* here and will record a No charge financial outcome with R0 practitioner earnings.`,
    buttons: [{ id: 'finalize_service_back', title: '← Back' }],
  };
}

async function loadReplacementService(appointmentId, serviceId, db = pool) {
  const result = await db.query(
    `SELECT s.id,s.name,s.price,s.variable_price,s.duration_minutes,s.processing_time_minutes,s.extra_time_minutes
       FROM services s
      WHERE s.id=$2 AND s.status='active'
        AND NOT EXISTS (
          SELECT 1 FROM appointment_staff ast
           WHERE ast.appointment_id=$1 AND ast.staff_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id=ast.staff_id AND ss.service_id=s.id)
        )`,
    [appointmentId, serviceId]
  );
  return result.rows[0] || null;
}

async function finalizeAppointment(admin, appointmentId, targetStatus, {
  windowStart = HISTORICAL_WINDOW_START,
  windowEnd = HISTORICAL_WINDOW_END,
  expectedRevision = null,
  workspace = false,
  allowBusinessBackup = false,
  connectionPool = pool,
} = {}) {
  if (!FINAL_STATUSES.has(targetStatus)) return { status: 'invalid_status' };
  const db = await connectionPool.connect();
  try {
    await db.query('BEGIN');
    const appointment = await loadAuthorizedPendingAppointment(admin, appointmentId, db, true, {
      windowStart,
      windowEnd,
      allowStartedNoShow: workspace && targetStatus === 'no_show',
    });
    if (!appointment) { await db.query('ROLLBACK'); return { status: 'stale_or_forbidden' }; }
    if (expectedRevision && new Date(appointment.updated_at).toISOString() !== String(expectedRevision)) {
      await db.query('ROLLBACK');
      return { status: 'stale_revision' };
    }
    if (!(await canCertifyAppointment(admin, appointment.id, db, { workspace, allowBusinessBackup }))) { await db.query('ROLLBACK'); return { status: 'certification_forbidden' }; }
    const isNoCharge = targetStatus === 'no_charge';
    const canonicalStatus = isNoCharge ? 'completed' : targetStatus;
    const financialClassification = isNoCharge ? 'no_charge' : 'standard';
    await db.query(
      `UPDATE appointments SET status=$1,financial_classification=$2,
       pre_adjustment_total_price=CASE WHEN $2='no_charge' THEN COALESCE(pre_adjustment_total_price,total_price) ELSE pre_adjustment_total_price END,
       total_price=CASE WHEN $2='no_charge' THEN 0 ELSE total_price END,updated_at=NOW() WHERE id=$3`,
      [canonicalStatus, financialClassification, appointment.id]
    );
    await db.query(
      `INSERT INTO appointment_status_history (appointment_id,from_status,to_status,changed_by,reason) VALUES ($1,$2,$3,$4,$5)`,
      [appointment.id, appointment.status, canonicalStatus, `admin:${admin.id}:${admin.display_name}`, workspace
        ? 'Explicit Workspace attendance certification'
        : isNoCharge
          ? 'Explicit WhatsApp practitioner attendance certification — no-charge visit; client charge R0; practitioner earnings R0'
          : 'Explicit WhatsApp practitioner attendance certification']
    );
    await db.query(`UPDATE appointment_lifecycle SET status=$1,updated_at=NOW() WHERE appointment_id=$2`, [canonicalStatus, appointment.id]);
    await db.query(
      `INSERT INTO crm_audit_events (actor_admin_id,action,entity_type,entity_id,metadata) VALUES ($1,'admin.appointment_finalized','appointment',$2,$3::jsonb)`,
      [admin.id, String(appointment.id), JSON.stringify({ fromStatus: appointment.status, toStatus: canonicalStatus, outcome: targetStatus, startsAt: appointment.starts_at, explicitAdminDecision: true, certificationAuthority: authorityDescription(admin, { workspace, allowBusinessBackup }), surface: workspace ? 'workspace_dashboard' : 'whatsapp', financialClassification, previousTotalPrice: appointment.total_price, clientCharge: isNoCharge ? 0 : appointment.total_price, practitionerEarningsOverride: isNoCharge ? 0 : null })]
    );
    await db.query('COMMIT');
    return { status: 'updated', appointment, targetStatus, canonicalStatus, financialClassification };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

async function finalizePriceAdjustedAppointment(admin, appointmentId, adjustedPrice) {
  if (!canUseDiscretionaryFinalization(admin)) return { status: 'price_authority_forbidden' };
  if (!Number.isFinite(Number(adjustedPrice)) || Number(adjustedPrice) <= 0) return { status: 'invalid_price' };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const appointment = await loadAuthorizedPendingAppointment(admin, appointmentId, db, true);
    if (!appointment) { await db.query('ROLLBACK'); return { status: 'stale_or_forbidden' }; }
    if (!(await canCertifyAppointment(admin, appointment.id, db))) { await db.query('ROLLBACK'); return { status: 'certification_forbidden' }; }
    await db.query(
      `UPDATE appointments SET status='completed',financial_classification='price_adjusted',
       pre_adjustment_total_price=COALESCE(pre_adjustment_total_price,total_price),total_price=$1,updated_at=NOW() WHERE id=$2`,
      [adjustedPrice, appointment.id]
    );
    await db.query(
      `INSERT INTO appointment_status_history (appointment_id,from_status,to_status,changed_by,reason) VALUES ($1,$2,'completed',$3,$4)`,
      [appointment.id, appointment.status, `admin:${admin.id}:${admin.display_name}`, `Explicit WhatsApp price adjustment — ${money(appointment.total_price)} to ${money(adjustedPrice)}; attendance certified completed`]
    );
    await db.query(`UPDATE appointment_lifecycle SET status='completed',updated_at=NOW() WHERE appointment_id=$1`, [appointment.id]);
    await db.query(
      `INSERT INTO crm_audit_events (actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'admin.appointment_price_adjusted_finalized','appointment',$2,$3::jsonb)`,
      [admin.id, String(appointment.id), JSON.stringify({ fromStatus: appointment.status, toStatus: 'completed', startsAt: appointment.starts_at, explicitAdminDecision: true, certificationAuthority: authorityDescription(admin), priceAuthority: `${cleanName(admin.display_name)}_discretion`, financialClassification: 'price_adjusted', previousTotalPrice: appointment.total_price, adjustedTotalPrice: Number(adjustedPrice), clientCharge: Number(adjustedPrice), practitionerEarningsBasis: Number(adjustedPrice) })]
    );
    await db.query('COMMIT');
    return { status: 'updated', appointment, adjustedPrice: Number(adjustedPrice) };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

async function finalizeServiceChangedAppointment(admin, appointmentId, serviceId, adjustedPrice = null) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const appointment = await loadAuthorizedPendingAppointment(admin, appointmentId, db, true);
    if (!appointment) { await db.query('ROLLBACK'); return { status: 'stale_or_forbidden' }; }
    if (!(await canCertifyAppointment(admin, appointment.id, db))) { await db.query('ROLLBACK'); return { status: 'certification_forbidden' }; }
    const current = await currentAppointmentService(appointment.id, db);
    if (current.status !== 'single') { await db.query('ROLLBACK'); return { status: 'multi_service' }; }
    const replacement = await loadReplacementService(appointment.id, serviceId, db);
    if (!replacement) { await db.query('ROLLBACK'); return { status: 'service_unavailable' }; }

    const explicitPrice = adjustedPrice !== null && adjustedPrice !== undefined ? Number(adjustedPrice) : null;
    if (explicitPrice !== null && (!Number.isFinite(explicitPrice) || explicitPrice < 0)) { await db.query('ROLLBACK'); return { status: 'invalid_price' }; }
    const finalPrice = explicitPrice !== null
      ? explicitPrice
      : (replacement.variable_price || replacement.price == null ? Number(appointment.total_price || 0) : Number(replacement.price));
    const noCharge = finalPrice === 0;
    const financialClassification = noCharge ? 'no_charge' : (explicitPrice !== null ? 'price_adjusted' : 'standard');
    const duration = Number(replacement.duration_minutes || 0) + Number(replacement.processing_time_minutes || 0) + Number(replacement.extra_time_minutes || 0);

    await db.query(
      `UPDATE appointment_services SET service_id=$1,service_name_snapshot=$2,price_snapshot=$3,duration_minutes_snapshot=$4 WHERE id=$5`,
      [replacement.id, replacement.name, replacement.price, duration, current.row.id]
    );
    await db.query(
      `UPDATE appointments SET title=$1,status='completed',financial_classification=$2,
       pre_adjustment_total_price=CASE WHEN $2 IN ('no_charge','price_adjusted') THEN COALESCE(pre_adjustment_total_price,total_price) ELSE pre_adjustment_total_price END,
       total_price=$3,updated_at=NOW() WHERE id=$4`,
      [replacement.name, financialClassification, finalPrice, appointment.id]
    );
    await db.query(
      `INSERT INTO appointment_status_history (appointment_id,from_status,to_status,changed_by,reason) VALUES ($1,$2,'completed',$3,$4)`,
      [appointment.id, appointment.status, `admin:${admin.id}:${admin.display_name}`, `Explicit WhatsApp service change — ${current.row.service_name_snapshot} to ${replacement.name}; attendance certified completed; final charge ${money(finalPrice)}`]
    );
    await db.query(`UPDATE appointment_lifecycle SET status='completed',updated_at=NOW() WHERE appointment_id=$1`, [appointment.id]);
    await db.query(
      `INSERT INTO crm_audit_events (actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'admin.appointment_service_changed_finalized','appointment',$2,$3::jsonb)`,
      [admin.id, String(appointment.id), JSON.stringify({ fromStatus: appointment.status, toStatus: 'completed', explicitAdminDecision: true, certificationAuthority: authorityDescription(admin), originalService: { id: current.row.service_id, name: current.row.service_name_snapshot, priceSnapshot: current.row.price_snapshot, durationMinutesSnapshot: current.row.duration_minutes_snapshot }, actualService: { id: replacement.id, name: replacement.name, cataloguePrice: replacement.price, durationMinutes: duration }, previousTotalPrice: appointment.total_price, finalTotalPrice: finalPrice, financialClassification, serviceChanged: true, priceAdjusted: explicitPrice !== null, practitionerEarningsOverride: noCharge ? 0 : null })]
    );
    await db.query('COMMIT');
    return { status: 'updated', appointment, replacement, original: current.row, finalPrice, financialClassification };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

async function startPastVisitReschedule(sender, appointmentId) {
  await processAdminBookingUpdateMessage(sender, 'Manage booking');
  const selected = await processAdminBookingUpdateMessage(sender, `manage_booking_select_${appointmentId}`);
  if (!selected.handled) return selected;
  return processAdminBookingUpdateMessage(sender, '3');
}
async function startPastVisitCancellation(sender, appointmentId) {
  return processAdminAppointmentCancellationMessage(sender, `Cancel appointment ${appointmentId}`);
}

async function processAdminAppointmentFinalizationMessage(sender, text) {
  const raw = String(text || '').trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
  const isEntry = ['finalize past appointments', 'finalise past appointments', 'review final statuses'].includes(normalized);
  const pageMatch = raw.match(/^finalize_appts_page_(\d+)$/i);
  const selectionMatch = raw.match(/^finalize_appt_(\d+)$/i);
  const decisionMatch = raw.match(/^finalize_(completed|no_show|no_charge)_(\d+)$/i);
  const cancellationMatch = raw.match(/^finalize_cancelled_(\d+)$/i);
  const rescheduleMatch = raw.match(/^finalize_reschedule_(\d+)$/i);
  const priceAdjustmentMatch = raw.match(/^finalize_price_adjust_(\d+)$/i);
  const serviceChangeMatch = raw.match(/^finalize_service_change_(\d+)$/i);
  const servicePickMatch = raw.match(/^finalize_service_pick_(\d+)$/i);
  const servicePageMatch = raw.match(/^finalize_service_page_(\d+)$/i);
  const isPriceConfirm = normalized === 'finalize_price_confirm';
  const isPriceBack = normalized === 'finalize_price_back';
  const isServiceConfirm = normalized === 'finalize_service_confirm';
  const isServiceAdjustPrice = normalized === 'finalize_service_adjust_price';
  const isServicePriceConfirm = normalized === 'finalize_service_price_confirm';
  const isServiceBack = normalized === 'finalize_service_back';
  const isBack = normalized === 'finalize_back';
  const recognizedFinalizationAction = Boolean(isEntry || pageMatch || selectionMatch || decisionMatch || cancellationMatch || rescheduleMatch || priceAdjustmentMatch || serviceChangeMatch || servicePickMatch || servicePageMatch || isPriceConfirm || isPriceBack || isServiceConfirm || isServiceAdjustPrice || isServicePriceConfirm || isServiceBack || isBack);
  const pendingCancellation = recognizedFinalizationAction ? false : await hasPendingCancellationIntent(sender);
  const pendingPriceAdjustment = recognizedFinalizationAction || pendingCancellation ? false : await hasPendingPriceAdjustmentIntent(sender);
  const pendingServiceChange = recognizedFinalizationAction || pendingCancellation || pendingPriceAdjustment ? false : await hasPendingServiceChangeIntent(sender);
  if (!recognizedFinalizationAction && !pendingCancellation && !pendingPriceAdjustment && !pendingServiceChange) return { handled: false };

  const admin = await getAdmin(sender);
  if (!admin) return { handled: false };
  if (!has(admin, 'appointment:view')) return { handled: true, admin, reply: 'Your admin account does not currently have permission to view appointment finalization.' };

  if (pendingCancellation) {
    const cancellation = await processAdminAppointmentCancellationMessage(sender, raw);
    if (cancellation.cancelledAppointmentId) return { handled: true, admin, interactive: await refreshedQueueInteractive(admin, cancellation.reply) };
    return { ...cancellation, admin };
  }

  if (serviceChangeMatch) {
    if (!has(admin, 'booking:update')) return { handled: true, admin, reply: 'Your admin account can review this appointment but cannot change its finalized service.' };
    const appointment = await loadAuthorizedPendingAppointment(admin, Number(serviceChangeMatch[1]));
    if (!appointment) return { handled: true, admin, reply: 'That appointment changed or is outside the approved 1–15 Aug historical window or your authorized scope, so no service change was started.' };
    if (!(await canCertifyAppointment(admin, appointment.id))) return { handled: true, admin, reply: 'You can review this appointment, but its outcome cannot be certified from this account.' };
    const current = await currentAppointmentService(appointment.id);
    if (current.status !== 'single') return { handled: true, admin, reply: 'Service change currently supports single-service visits only. This appointment has multiple service rows, so nothing was changed.' };
    const services = await eligibleReplacementServices(appointment.id);
    await saveServiceChangeIntent(sender, appointment.id, null, null, 'selecting_service');
    return { handled: true, admin, interactive: serviceChangeListInteractive(appointment, services, 1) };
  }

  if (pendingServiceChange || servicePickMatch || servicePageMatch || isServiceConfirm || isServiceAdjustPrice || isServicePriceConfirm || isServiceBack) {
    const intent = await getServiceChangeIntent(sender);
    if (!intent) return { handled: true, admin, interactive: pendingListInteractive(await pendingPastAppointments(admin, 1), admin) };
    const appointment = await loadAuthorizedPendingAppointment(admin, Number(intent.appointment_id));
    if (!appointment) { await clearServiceChangeIntent(sender); return { handled: true, admin, reply: 'That appointment is no longer awaiting finalization, so the service-change request was cleared.' }; }
    if (!has(admin, 'booking:update') || !(await canCertifyAppointment(admin, appointment.id))) {
      await clearServiceChangeIntent(sender);
      return { handled: true, admin, reply: 'This appointment is no longer within your service-change certification authority, so the request was cleared.' };
    }
    const oldServiceState = await currentAppointmentService(appointment.id);
    if (oldServiceState.status !== 'single') { await clearServiceChangeIntent(sender); return { handled: true, admin, reply: 'This appointment no longer has a single canonical service row, so the service-change request was cleared.' }; }
    const oldService = oldServiceState.row;
    if (isServiceBack) {
      await clearServiceChangeIntent(sender);
      return { handled: true, admin, interactive: decisionInteractive(appointment, admin) };
    }
    if (intent.status === 'selecting_service') {
      const services = await eligibleReplacementServices(appointment.id);
      if (servicePageMatch) return { handled: true, admin, interactive: serviceChangeListInteractive(appointment, services, Number(servicePageMatch[1])) };
      if (!servicePickMatch) return { handled: true, admin, interactive: serviceChangeListInteractive(appointment, services, 1) };
      const replacement = await loadReplacementService(appointment.id, Number(servicePickMatch[1]));
      if (!replacement) return { handled: true, admin, interactive: serviceChangeListInteractive(appointment, services, 1) };
      await saveServiceChangeIntent(sender, appointment.id, replacement.id, null, 'awaiting_service_confirmation');
      return { handled: true, admin, interactive: serviceChangeReviewInteractive(appointment, oldService, replacement) };
    }
    const replacement = await loadReplacementService(appointment.id, Number(intent.proposed_service_id));
    if (!replacement) { await clearServiceChangeIntent(sender); return { handled: true, admin, reply: 'The selected replacement service is no longer active or eligible, so the request was cleared.' }; }
    if (intent.status === 'awaiting_service_confirmation') {
      if (isServiceAdjustPrice) {
        await saveServiceChangeIntent(sender, appointment.id, replacement.id, null, 'collecting_price');
        return { handled: true, admin, interactive: serviceChangePriceEntryInteractive(appointment, oldService, replacement) };
      }
      if (!isServiceConfirm) return { handled: true, admin, interactive: serviceChangeReviewInteractive(appointment, oldService, replacement) };
      const result = await finalizeServiceChangedAppointment(admin, appointment.id, replacement.id, null);
      await clearServiceChangeIntent(sender);
      if (result.status !== 'updated') return { handled: true, admin, reply: 'The appointment changed before confirmation, so no service change was written.' };
      return { handled: true, admin, interactive: await refreshedQueueInteractive(admin, `✅ Appointment #${appointment.id} finalized *Completed* with service changed to *${replacement.name}*. Final charge: *${money(result.finalPrice)}*. It has been removed from the finalization queue.`) };
    }
    if (intent.status === 'collecting_price') {
      const adjustedPrice = parseAdjustedPrice(raw);
      if (adjustedPrice === null) return { handled: true, admin, interactive: serviceChangePriceEntryInteractive(appointment, oldService, replacement, 'Please send a valid rand amount with no more than two decimal places.') };
      await saveServiceChangeIntent(sender, appointment.id, replacement.id, adjustedPrice, 'awaiting_price_confirmation');
      return { handled: true, admin, interactive: serviceChangeReviewInteractive(appointment, oldService, replacement, adjustedPrice) };
    }
    if (intent.status === 'awaiting_price_confirmation') {
      if (isServiceAdjustPrice) {
        await saveServiceChangeIntent(sender, appointment.id, replacement.id, intent.adjusted_price, 'collecting_price');
        return { handled: true, admin, interactive: serviceChangePriceEntryInteractive(appointment, oldService, replacement) };
      }
      if (!isServicePriceConfirm) return { handled: true, admin, interactive: serviceChangeReviewInteractive(appointment, oldService, replacement, Number(intent.adjusted_price)) };
      const result = await finalizeServiceChangedAppointment(admin, appointment.id, replacement.id, Number(intent.adjusted_price));
      await clearServiceChangeIntent(sender);
      if (result.status !== 'updated') return { handled: true, admin, reply: 'The appointment changed before confirmation, so no service or price change was written.' };
      const noChargeSuffix = result.finalPrice === 0 ? ' Client charge and practitioner earnings are R0.' : '';
      return { handled: true, admin, interactive: await refreshedQueueInteractive(admin, `✅ Appointment #${appointment.id} finalized *Completed* with service changed to *${replacement.name}* at *${money(result.finalPrice)}*.${noChargeSuffix} It has been removed from the finalization queue.`) };
    }
  }

  if (priceAdjustmentMatch) {
    if (!canUseDiscretionaryFinalization(admin)) return { handled: true, admin, reply: 'Adjust price is available only to the assigned practitioner through their own linked Admin account.' };
    if (!has(admin, 'booking:update')) return { handled: true, admin, reply: 'Your admin account cannot adjust appointment prices.' };
    const appointment = await loadAuthorizedPendingAppointment(admin, Number(priceAdjustmentMatch[1]));
    if (!appointment) return { handled: true, admin, reply: 'That appointment changed or is outside the approved 1–15 Aug historical window or your authorized scope, so no price adjustment was started.' };
    if (!(await canCertifyAppointment(admin, appointment.id))) return { handled: true, admin, reply: 'You can review this appointment, but its outcome cannot be certified from this account.' };
    await savePriceAdjustmentIntent(sender, appointment.id, null, 'collecting_price');
    return { handled: true, admin, interactive: priceEntryInteractive(appointment) };
  }

  if (pendingPriceAdjustment || isPriceConfirm || isPriceBack) {
    const intent = await getPriceAdjustmentIntent(sender);
    if (!intent) return { handled: true, admin, interactive: pendingListInteractive(await pendingPastAppointments(admin, 1), admin) };
    if (!canUseDiscretionaryFinalization(admin) || !has(admin, 'booking:update')) {
      await clearPriceAdjustmentIntent(sender);
      return { handled: true, admin, reply: 'Adjust price is available only to the assigned practitioner through their own linked Admin account.' };
    }
    const appointment = await loadAuthorizedPendingAppointment(admin, Number(intent.appointment_id));
    if (!appointment) { await clearPriceAdjustmentIntent(sender); return { handled: true, admin, reply: 'That appointment is no longer awaiting finalization, so the price-adjustment request was cleared.' }; }
    if (!(await canCertifyAppointment(admin, appointment.id))) { await clearPriceAdjustmentIntent(sender); return { handled: true, admin, reply: 'This appointment is no longer within your certification authority, so the price-adjustment request was cleared.' }; }
    if (isPriceBack) { await clearPriceAdjustmentIntent(sender); return { handled: true, admin, interactive: decisionInteractive(appointment, admin) }; }
    if (intent.status === 'collecting_price') {
      const adjustedPrice = parseAdjustedPrice(raw);
      if (adjustedPrice === null) return { handled: true, admin, interactive: priceEntryInteractive(appointment, 'Please send a valid rand amount with no more than two decimal places.') };
      if (adjustedPrice === 0) return { handled: true, admin, interactive: priceEntryInteractive(appointment, 'For R0, choose No charge so the financial outcome remains explicit.') };
      await savePriceAdjustmentIntent(sender, appointment.id, adjustedPrice, 'awaiting_confirmation');
      return { handled: true, admin, interactive: priceConfirmationInteractive(appointment, adjustedPrice) };
    }
    if (intent.status === 'awaiting_confirmation') {
      if (!isPriceConfirm) return { handled: true, admin, interactive: priceConfirmationInteractive(appointment, Number(intent.adjusted_price)) };
      const result = await finalizePriceAdjustedAppointment(admin, appointment.id, Number(intent.adjusted_price));
      await clearPriceAdjustmentIntent(sender);
      if (result.status === 'certification_forbidden' || result.status === 'price_authority_forbidden') return { handled: true, admin, reply: 'The price adjustment was not written because certification or price authority changed.' };
      if (result.status !== 'updated') return { handled: true, admin, reply: 'The appointment changed before confirmation, so no price adjustment was written.' };
      return { handled: true, admin, interactive: await refreshedQueueInteractive(admin, `✅ Appointment #${appointment.id} finalized *Completed* at an adjusted price of *${money(result.adjustedPrice)}*. It has been removed from the finalization queue.`) };
    }
  }

  if (isEntry || pageMatch || isBack) {
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    return { handled: true, admin, interactive: pendingListInteractive(await pendingPastAppointments(admin, page), admin) };
  }

  if (selectionMatch) {
    const appointment = await loadAuthorizedPendingAppointment(admin, Number(selectionMatch[1]));
    if (!appointment) return { handled: true, admin, reply: 'That appointment is no longer awaiting final status in the approved 1–15 Aug historical window or your authorized scope.' };
    const canCertify = has(admin, 'booking:update') && await canCertifyAppointment(admin, appointment.id);
    return { handled: true, admin, interactive: canCertify ? decisionInteractive(appointment, admin) : reviewOnlyInteractive(appointment) };
  }

  if (cancellationMatch) {
    if (!has(admin, 'booking:update')) return { handled: true, admin, reply: 'Your admin account can review this appointment but cannot cancel it.' };
    const appointmentId = Number(cancellationMatch[1]);
    const appointment = await loadAuthorizedPendingAppointment(admin, appointmentId);
    if (!appointment) return { handled: true, admin, reply: 'That appointment changed or is outside the approved 1–15 Aug historical window or your authorized scope, so no cancellation was started.' };
    if (!(await canCertifyAppointment(admin, appointment.id))) return { handled: true, admin, reply: 'You can review this appointment, but its outcome must be handled by the responsible practitioner or authorized supervisor.' };
    return startPastVisitCancellation(sender, appointmentId);
  }

  if (rescheduleMatch) {
    if (!has(admin, 'booking:update')) return { handled: true, admin, reply: 'Your admin account can review this appointment but cannot reschedule it.' };
    const appointmentId = Number(rescheduleMatch[1]);
    const appointment = await loadAuthorizedPendingAppointment(admin, appointmentId);
    if (!appointment) return { handled: true, admin, reply: 'That appointment changed or is outside the approved 1–15 Aug historical window or your authorized scope, so no reschedule was started.' };
    if (!(await canCertifyAppointment(admin, appointment.id))) return { handled: true, admin, reply: 'You can review this appointment, but its outcome must be handled by the responsible practitioner or authorized supervisor.' };
    return startPastVisitReschedule(sender, appointmentId);
  }

  if (!decisionMatch) return { handled: false };
  if (!has(admin, 'booking:update')) return { handled: true, admin, reply: 'Your admin account can review this appointment but cannot certify attendance.' };
  const targetStatus = decisionMatch[1].toLowerCase();
  const appointmentId = Number(decisionMatch[2]);
  const result = await finalizeAppointment(admin, appointmentId, targetStatus);
  if (result.status === 'certification_forbidden') return { handled: true, admin, reply: 'You can review this appointment, but attendance must be certified by its responsible practitioner or authorized supervisor.' };
  if (result.status !== 'updated') return { handled: true, admin, reply: 'That appointment changed or is outside the approved 1–15 Aug historical window or your authorized scope, so no status update was made.' };
  const label = targetStatus === 'completed' ? 'Completed' : targetStatus === 'no_show' ? 'No-show' : 'No charge';
  const suffix = targetStatus === 'no_charge' ? ' Client charge and practitioner earnings are R0.' : '';
  return { handled: true, admin, interactive: await refreshedQueueInteractive(admin, `✅ Appointment #${appointmentId} marked *${label}*.${suffix} It has been removed from the finalization queue.`) };
}

module.exports = {
  FINAL_STATUSES, PAGE_SIZE, SERVICE_PAGE_SIZE, HISTORICAL_WINDOW_START, HISTORICAL_WINDOW_END,
  pendingPastAppointments, pendingListInteractive, refreshedQueueInteractive, decisionInteractive, reviewOnlyInteractive,
  loadAuthorizedPendingAppointment, finalizeAppointment, finalizePriceAdjustedAppointment, finalizeServiceChangedAppointment,
  priceEntryInteractive, priceConfirmationInteractive, parseAdjustedPrice,
  getPriceAdjustmentIntent, hasPendingPriceAdjustmentIntent, clearPriceAdjustmentIntent,
  getServiceChangeIntent, hasPendingServiceChangeIntent, clearServiceChangeIntent, ensureServiceChangeSchema,
  eligibleReplacementServices, serviceChangeListInteractive, serviceChangeReviewInteractive, serviceChangePriceEntryInteractive,
  startPastVisitReschedule, startPastVisitCancellation,
  processAdminAppointmentFinalizationMessage,
};
