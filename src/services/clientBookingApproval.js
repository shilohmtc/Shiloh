const { pool } = require('../db/pool');
const { normalizeMobile } = require('./crmV2ClientService');
const { checkAssistantBookingHours: checkClinicHours } = require('./assistantBookingHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');
const { pendingBookingProposalConflicts } = require('./bookingRequestHolds');
const { sendWhatsAppReplyButtons, sendWhatsAppTemplate } = require('./whatsapp');
const { sendCustomerBookingConfirmationForAppointment } = require('./customerBookingConfirmation');
const { ensureBookingApprovalInfrastructure } = require('./clientBookingApprovalSchema');
const logger = require('../lib/logger');

const CLIENT_ACCEPT_PREFIX = 'booking_proposal_accept_';
const CLIENT_ANOTHER_PREFIX = 'booking_proposal_another_';
const ACTIVE_REQUEST_STATES = new Set(['pending', 'awaiting_client_confirmation']);
const BUSINESS_WIDE_ROLES = new Set(['owner', 'business_admin', 'booking_operator']);
const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

class BookingRequestError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'BookingRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value, code = 'BOOKING_REQUEST_INVALID') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BookingRequestError(code, 'A valid canonical identifier is required.');
  return id;
}

function exactDate(value, code = 'BOOKING_REQUEST_INVALID_TIME') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new BookingRequestError(code, 'A valid appointment time is required.');
  return date;
}

function revisionOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canonicalIds(value) {
  return (Array.isArray(value) ? value : []).map(Number).filter(Number.isSafeInteger);
}

function sameIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = canonicalIds(left);
  const b = canonicalIds(right);
  return a.length > 0 && a.length === left.length && b.length === right.length
    && a.length === b.length && a.every((id, index) => id === b[index]);
}

function normalizePhone(value) {
  return normalizeMobile(value) || String(value || '').replace(/\D/g, '');
}

function fmtDateTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function clientActionId(prefix, appointmentId, version) {
  return `${prefix}${positiveId(appointmentId)}_${positiveId(version)}`;
}

function proposalReplyButtons(row, version) {
  return [
    { id: clientActionId(CLIENT_ACCEPT_PREFIX, row.appointment_id, version), title: 'Yes, book this' },
    { id: clientActionId(CLIENT_ANOTHER_PREFIX, row.appointment_id, version), title: 'Another option' },
  ];
}

function parseClientProposalAction(value = '') {
  const text = String(value || '').trim().toLowerCase();
  let match = text.match(/^booking_proposal_accept_(\d+)_(\d+)$/);
  if (match) return { appointmentId: Number(match[1]), proposalVersion: Number(match[2]), action: 'accept' };
  match = text.match(/^booking_proposal_another_(\d+)_(\d+)$/);
  if (match) return { appointmentId: Number(match[1]), proposalVersion: Number(match[2]), action: 'another' };
  return null;
}

function operatorCanResolve(principal, row) {
  if (!principal || !row) return false;
  const role = String(principal.business_role || principal.calendarAuthority?.businessRole || '').toLowerCase();
  const scope = String(principal.calendar_scope || principal.calendarAuthority?.calendarScope || '').toLowerCase();
  if (BUSINESS_WIDE_ROLES.has(role) && scope === 'all_business') {
    return role !== 'booking_operator' || principal.permissions?.['appointment:create'] === true;
  }
  if (principal.staff_id && Number(row.approver_staff_id) === Number(principal.staff_id)) return true;
  return false;
}

function hasBusinessWideAuthority(principal) {
  const role = String(principal?.business_role || principal?.calendarAuthority?.businessRole || '').toLowerCase();
  const scope = String(principal?.calendar_scope || principal?.calendarAuthority?.calendarScope || '').toLowerCase();
  return BUSINESS_WIDE_ROLES.has(role) && scope === 'all_business'
    && (role !== 'booking_operator' || principal.permissions?.['appointment:create'] === true);
}

function requestSnapshotMatches(row) {
  return Boolean(row
    && row.appointment_status !== 'cancelled'
    && sameIds(row.requested_staff_ids, row.current_staff_ids)
    && sameIds(row.requested_service_ids, row.current_service_ids)
    && String(row.requested_client_id || '') === String(row.current_client_id || '')
    && String(row.requested_crm_v2_client_id || '') === String(row.current_crm_v2_client_id || '')
    && Number(row.requested_location_id) === Number(row.current_location_id)
    && Number(row.requested_staff_id) === Number(row.current_staff_id)
    && Number(row.requested_service_id) === Number(row.current_service_id)
    && new Date(row.requested_starts_at).getTime() === new Date(row.current_starts_at).getTime()
    && new Date(row.requested_ends_at).getTime() === new Date(row.current_ends_at).getTime()
    && revisionOf(row.requested_revision) === revisionOf(row.current_revision));
}

function requestQuery({ lock = false } = {}) {
  return `
    SELECT aba.*,
           a.client_id AS current_client_id,a.crm_v2_client_id AS current_crm_v2_client_id,
           a.location_id AS current_location_id,a.starts_at AS current_starts_at,a.ends_at AS current_ends_at,
           a.status AS appointment_status,a.updated_at AS current_revision,
           ast.staff_id AS current_staff_id,aps.service_id AS current_service_id,
           staff_snapshot.ids AS current_staff_ids,service_snapshot.ids AS current_service_ids,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           COALESCE(l.name,'Shiloh') AS location_name,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN v2.normalized_mobile ELSE
             (SELECT normalized_value FROM client_contacts cc WHERE cc.client_id=a.client_id
               AND LOWER(cc.contact_type) IN ('whatsapp','mobile','phone','telephone')
               AND cc.normalized_value IS NOT NULL ORDER BY cc.is_primary DESC,cc.id LIMIT 1)
           END AS current_client_phone,
           (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
           (SELECT COUNT(*)::int FROM appointment_services x WHERE x.appointment_id=a.id) AS service_count
      FROM appointment_booking_approvals aba
      JOIN appointments a ON a.id=aba.appointment_id
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      JOIN LATERAL (SELECT array_agg(x.staff_id ORDER BY x.position,x.id) AS ids FROM appointment_staff x WHERE x.appointment_id=a.id) staff_snapshot ON TRUE
      JOIN LATERAL (SELECT array_agg(x.service_id ORDER BY x.position,x.id) AS ids FROM appointment_services x WHERE x.appointment_id=a.id) service_snapshot ON TRUE
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      LEFT JOIN staff st ON st.id=ast.staff_id
      LEFT JOIN services s ON s.id=aps.service_id
      LEFT JOIN locations l ON l.id=a.location_id
     WHERE aba.appointment_id=$1
     ${lock ? 'FOR UPDATE OF aba,a,ast,aps' : ''}`;
}

async function loadRequest(db, appointmentId, lock = false) {
  const result = await db.query(requestQuery({ lock }), [positiveId(appointmentId)]);
  return result.rows?.[0] || null;
}

async function createPendingBookingApproval(db, { appointmentId }) {
  await ensureBookingApprovalInfrastructure(db);
  const result = await db.query(`
    INSERT INTO appointment_booking_approvals (
      appointment_id,approver_staff_id,status,approval_mode,
      requested_client_id,requested_crm_v2_client_id,requested_client_phone,
      requested_location_id,requested_staff_id,requested_staff_ids,requested_service_id,requested_service_ids,
      requested_starts_at,requested_ends_at,requested_revision
    )
    SELECT a.id,ast.staff_id,'pending','standard',a.client_id,a.crm_v2_client_id,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN v2.normalized_mobile ELSE
             (SELECT normalized_value FROM client_contacts cc WHERE cc.client_id=a.client_id
               AND LOWER(cc.contact_type) IN ('whatsapp','mobile','phone','telephone')
               AND cc.normalized_value IS NOT NULL ORDER BY cc.is_primary DESC,cc.id LIMIT 1) END,
           a.location_id,ast.staff_id,staff_snapshot.ids,aps.service_id,service_snapshot.ids,a.starts_at,a.ends_at,a.updated_at
      FROM appointments a
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      JOIN LATERAL (SELECT array_agg(x.staff_id ORDER BY x.position,x.id) AS ids FROM appointment_staff x WHERE x.appointment_id=a.id) staff_snapshot ON TRUE
      JOIN LATERAL (SELECT array_agg(x.service_id ORDER BY x.position,x.id) AS ids FROM appointment_services x WHERE x.appointment_id=a.id) service_snapshot ON TRUE
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
     WHERE a.id=$1
    ON CONFLICT (appointment_id) DO UPDATE SET
      approver_staff_id=EXCLUDED.approver_staff_id,
      requested_client_id=EXCLUDED.requested_client_id,
      requested_crm_v2_client_id=EXCLUDED.requested_crm_v2_client_id,
      requested_client_phone=EXCLUDED.requested_client_phone,
      requested_location_id=EXCLUDED.requested_location_id,
      requested_staff_id=EXCLUDED.requested_staff_id,
      requested_staff_ids=EXCLUDED.requested_staff_ids,
      requested_service_id=EXCLUDED.requested_service_id,
      requested_service_ids=EXCLUDED.requested_service_ids,
      requested_starts_at=EXCLUDED.requested_starts_at,
      requested_ends_at=EXCLUDED.requested_ends_at,
      requested_revision=EXCLUDED.requested_revision,
      updated_at=NOW()
    WHERE appointment_booking_approvals.status='pending'
    RETURNING *`, [positiveId(appointmentId)]);
  return result.rows?.[0] || null;
}

async function listUnresolvedBookingRequests({ db = pool, principal, now = new Date() }) {
  const result = await db.query(`
    SELECT aba.appointment_id,aba.approver_staff_id,aba.approver_admin_id,aba.observer_staff_id,
           aba.status,aba.requested_at,aba.requested_starts_at,aba.requested_ends_at,
           aba.requested_revision,aba.proposed_starts_at,aba.proposed_ends_at,
           aba.proposed_staff_id,aba.proposal_version,aba.proposal_expires_at,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           COALESCE(pst.display_name,st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS proposed_staff_name
      FROM appointment_booking_approvals aba
      JOIN appointments a ON a.id=aba.appointment_id AND a.status<>'cancelled'
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      LEFT JOIN staff st ON st.id=ast.staff_id
      LEFT JOIN staff pst ON pst.id=aba.proposed_staff_id
      LEFT JOIN services s ON s.id=aps.service_id
     WHERE aba.status IN ('pending','awaiting_client_confirmation')
     ORDER BY aba.requested_at,aba.appointment_id`);
  return (result.rows || []).filter(row => operatorCanResolve(principal, row)).map(row => ({
    appointmentId: Number(row.appointment_id), status: row.status,
    effectiveStatus: row.status === 'awaiting_client_confirmation' && new Date(row.proposal_expires_at).getTime() <= now.getTime() ? 'pending' : row.status,
    clientName: row.client_name, serviceName: row.service_name, staffName: row.staff_name,
    requestedStartsAt: row.requested_starts_at, requestedEndsAt: row.requested_ends_at,
    requestedRevision: revisionOf(row.requested_revision),
    proposedStartsAt: row.proposed_starts_at, proposedEndsAt: row.proposed_ends_at,
    proposedStaffId: row.proposed_staff_id ? Number(row.proposed_staff_id) : null,
    proposedStaffName: row.proposed_staff_name, proposalVersion: Number(row.proposal_version || 0),
    proposalExpiresAt: row.proposal_expires_at,
  }));
}

async function canonicalWindowAvailable(db, {
  appointmentId, staffId, serviceId, locationId, startsAt, endsAt, excludeProposalAppointmentId = null,
}) {
  const resource = await db.query(`
    SELECT st.id AS staff_id,st.display_name,st.status AS staff_status,st.resource_type,
           s.id AS service_id,s.status AS service_status,l.id AS location_id,l.status AS location_status,
           EXISTS(SELECT 1 FROM staff_services ss WHERE ss.staff_id=st.id AND ss.service_id=s.id) AS eligible
      FROM staff st CROSS JOIN services s CROSS JOIN locations l
     WHERE st.id=$1 AND s.id=$2 AND l.id=$3`, [staffId, serviceId, locationId]);
  const canonical = resource.rows?.[0];
  if (!canonical || canonical.staff_status !== 'active' || canonical.resource_type !== 'practitioner'
      || canonical.service_status !== 'active' || canonical.location_status !== 'active' || canonical.eligible !== true) {
    return { ok: false, reason: 'canonical_resource_changed' };
  }
  const clinic = await checkClinicHours({ db, locationId, startsAt, endsAt });
  if (!clinic.covered) return { ok: false, reason: 'clinic_hours' };
  const schedule = await checkAuthoritativeSchedule({ db, staffId, locationId, startsAt, endsAt });
  if (!schedule.covered || schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException)) {
    return { ok: false, reason: 'staff_schedule' };
  }
  const conflicts = await db.query(`
    SELECT conflict_type,id FROM (
      SELECT 'appointment'::text conflict_type,a.id FROM appointments a
      JOIN appointment_staff ast ON ast.appointment_id=a.id
      WHERE ast.staff_id=$1 AND a.id<>$2 AND a.status<>'cancelled' AND a.starts_at<$4 AND a.ends_at>$3
      UNION ALL
      SELECT 'calendar_block',cb.id FROM calendar_blocks cb
      WHERE cb.staff_id=$1 AND cb.starts_at<$4 AND cb.ends_at>$3
      UNION ALL
      SELECT 'reschedule_hold',rr.id FROM appointment_reschedule_requests rr
      WHERE rr.approver_staff_id=$1 AND rr.status='pending' AND rr.proposed_starts_at<$4 AND rr.proposed_ends_at>$3
    ) x LIMIT 1`, [staffId, appointmentId, startsAt, endsAt]);
  if (conflicts.rowCount) return { ok: false, reason: conflicts.rows[0].conflict_type };
  const proposalConflicts = await pendingBookingProposalConflicts({
    db, staffId, startsAt, endsAt, excludeAppointmentId: excludeProposalAppointmentId,
  });
  if (proposalConflicts.length) return { ok: false, reason: 'booking_proposal_hold' };
  return { ok: true, canonical };
}

async function audit(db, principal, action, appointmentId, metadata = {}) {
  await db.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
                  VALUES($1,$2,'appointment',$3,$4::jsonb)`,
  [principal?.id || null, action, appointmentId, JSON.stringify({ surface: 'workspace_booking_requests', ...metadata })]);
}

async function inTransaction(dbPool, operation) {
  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    const result = await operation(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

async function lockStaffIds(db, staffIds) {
  const ids = [...new Set(canonicalIds(staffIds))].sort((a, b) => a - b);
  for (const staffId of ids) await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [staffId]);
  return ids;
}

async function validateAllWindows(db, { appointmentId, staffIds, serviceIds, locationId, startsAt, endsAt, excludeProposalAppointmentId }, validateWindow) {
  if (!canonicalIds(staffIds).length || !canonicalIds(serviceIds).length) return { ok: false, reason: 'canonical_assignment_missing' };
  let canonical = null;
  for (const staffId of canonicalIds(staffIds)) {
    for (const serviceId of canonicalIds(serviceIds)) {
      const available = await validateWindow(db, {
        appointmentId, staffId, serviceId, locationId, startsAt, endsAt, excludeProposalAppointmentId,
      });
      if (!available.ok) return available;
      canonical ||= available.canonical;
    }
  }
  return { ok: true, canonical };
}

function requireResolvable(principal, row, expectedRevision, allowedStates = ACTIVE_REQUEST_STATES) {
  if (!row) throw new BookingRequestError('BOOKING_REQUEST_NOT_FOUND', 'That booking request no longer exists.', 404);
  if (!operatorCanResolve(principal, row)) throw new BookingRequestError('BOOKING_REQUEST_FORBIDDEN', 'Current Workspace authority cannot resolve this booking request.', 403);
  if (!allowedStates.has(row.status)) throw new BookingRequestError('BOOKING_REQUEST_ALREADY_RESOLVED', 'That booking request has already been resolved.', 409);
  if (expectedRevision && revisionOf(expectedRevision) !== revisionOf(row.requested_revision)) {
    throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This request changed. Refresh Workspace before trying again.', 409);
  }
  if (!requestSnapshotMatches(row)) throw new BookingRequestError('BOOKING_REQUEST_CANONICAL_DRIFT', 'The canonical appointment changed after the client request. No resolution was recorded.', 409);
}

async function acceptRequestedAppointment({ dbPool = pool, principal, appointmentId, expectedRevision, now = new Date(), validateWindow = canonicalWindowAvailable, sendConfirmation = sendCustomerBookingConfirmationForAppointment }) {
  const id = positiveId(appointmentId);
  await inTransaction(dbPool, async db => {
    const row = await loadRequest(db, id, true);
    requireResolvable(principal, row, expectedRevision);
    if (row.status === 'awaiting_client_confirmation' && new Date(row.proposal_expires_at).getTime() > now.getTime()) {
      throw new BookingRequestError('BOOKING_REQUEST_AWAITING_CLIENT', 'This request is awaiting the client’s response to an active alternative.', 409);
    }
    await lockStaffIds(db, row.current_staff_ids);
    const available = await validateAllWindows(db, {
      appointmentId: id, staffIds: row.current_staff_ids, serviceIds: row.current_service_ids,
      locationId: Number(row.current_location_id), startsAt: row.current_starts_at, endsAt: row.current_ends_at,
      excludeProposalAppointmentId: id,
    }, validateWindow);
    if (!available.ok) throw new BookingRequestError('BOOKING_REQUEST_UNAVAILABLE', 'The requested appointment is no longer canonically available.', 409);
    const updated = await db.query(`UPDATE appointment_booking_approvals SET status='approved',decided_at=NOW(),
      decided_by_admin_id=$2,decision_note='workspace_accept_requested',updated_at=NOW()
      WHERE appointment_id=$1 AND (status='pending' OR
        (status='awaiting_client_confirmation' AND proposal_expires_at <= $3))
      RETURNING appointment_id`, [id, principal.id, now]);
    if (updated.rowCount !== 1) throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This request changed before it could be accepted.', 409);
    await audit(db, principal, 'client.booking_request.accepted_requested', id);
  });
  const confirmation = await sendConfirmation(id);
  return { ok: true, appointmentId: id, status: 'approved', confirmation };
}

async function defaultSendProposal(row, version) {
  const phone = normalizePhone(row.current_client_phone);
  if (!phone) throw new Error('Canonical client WhatsApp identity is unavailable');
  return sendWhatsAppReplyButtons(phone, [
    `Hi ${row.client_name}, Shiloh has another option for your booking request. 🌿`, '',
    `Service: ${row.service_name}`, `With: ${row.proposed_staff_name || row.staff_name}`,
    `Proposed time: ${fmtDateTime(row.proposed_starts_at)}`, '',
    'Please choose one response. The appointment is not confirmed until your acceptance is revalidated.',
  ].join('\n'), proposalReplyButtons(row, version));
}

async function proposeAlternative({
  dbPool = pool, principal, appointmentId, expectedRevision, startsAt, staffId = null, serviceId = null,
  now = new Date(), sendProposal = defaultSendProposal,
  validateWindow = canonicalWindowAvailable,
}) {
  const id = positiveId(appointmentId);
  const start = exactDate(startsAt);
  if (start.getTime() <= now.getTime()) throw new BookingRequestError('BOOKING_REQUEST_PAST_TIME', 'The proposed time must be in the future.');
  let deliveryRow;
  const version = await inTransaction(dbPool, async db => {
    const row = await loadRequest(db, id, true);
    requireResolvable(principal, row, expectedRevision);
    const targetStaffId = staffId == null ? Number(row.current_staff_id) : positiveId(staffId);
    const targetServiceId = serviceId == null ? Number(row.current_service_id) : positiveId(serviceId);
    const currentStaffIds = canonicalIds(row.current_staff_ids);
    const currentServiceIds = canonicalIds(row.current_service_ids);
    if (staffId != null && currentStaffIds.length !== 1) {
      throw new BookingRequestError('BOOKING_REQUEST_COMPLEX_PRACTITIONER_CHANGE', 'This multi-practitioner request can only receive an alternative time.', 400);
    }
    if (targetStaffId !== Number(row.current_staff_id) && !hasBusinessWideAuthority(principal)) {
      throw new BookingRequestError('BOOKING_REQUEST_TARGET_FORBIDDEN', 'Current Workspace authority cannot propose another practitioner.', 403);
    }
    if (targetServiceId !== Number(row.current_service_id)) {
      throw new BookingRequestError('BOOKING_REQUEST_SERVICE_CHANGE_UNSUPPORTED', 'Choose an alternative time or practitioner for the requested service.', 400);
    }
    const duration = new Date(row.requested_ends_at).getTime() - new Date(row.requested_starts_at).getTime();
    if (!(duration > 0)) throw new BookingRequestError('BOOKING_REQUEST_INVALID_DURATION', 'The requested appointment duration is invalid.');
    const end = new Date(start.getTime() + duration);
    const targetStaffIds = currentStaffIds.length === 1 ? [targetStaffId] : currentStaffIds;
    await lockStaffIds(db, targetStaffIds);
    const available = await validateAllWindows(db, {
      appointmentId: id, staffIds: targetStaffIds, serviceIds: currentServiceIds,
      locationId: Number(row.current_location_id), startsAt: start, endsAt: end,
      excludeProposalAppointmentId: id,
    }, validateWindow);
    if (!available.ok) throw new BookingRequestError('BOOKING_REQUEST_ALTERNATIVE_UNAVAILABLE', 'That alternative is not canonically available.', 409);
    const expiry = new Date(now.getTime() + PROPOSAL_TTL_MS);
    const updated = await db.query(`UPDATE appointment_booking_approvals SET
      status='awaiting_client_confirmation',proposed_location_id=$2,proposed_staff_id=$3,proposed_staff_ids=$4,proposed_service_id=$5,
      proposed_starts_at=$6,proposed_ends_at=$7,proposal_version=proposal_version+1,proposal_expires_at=$8,
      proposed_by_admin_id=$9,decision_note=NULL,updated_at=NOW()
      WHERE appointment_id=$1 AND status IN ('pending','awaiting_client_confirmation')
      RETURNING proposal_version`, [id, row.current_location_id, targetStaffId, targetStaffIds, targetServiceId, start, end, expiry, principal.id]);
    if (updated.rowCount !== 1) throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This request changed before the alternative could be proposed.', 409);
    await audit(db, principal, 'client.booking_request.alternative_proposed', id, {
      proposalVersion: Number(updated.rows[0].proposal_version), proposedStaffId: targetStaffId,
      proposedServiceId: targetServiceId, proposedStartsAt: start.toISOString(), proposalExpiresAt: expiry.toISOString(),
    });
    deliveryRow = { ...row, appointment_id: id, proposed_starts_at: start, proposed_ends_at: end,
      proposed_staff_name: targetStaffIds.length === 1 ? available.canonical.display_name : 'Shiloh team', current_client_phone: row.current_client_phone };
    return Number(updated.rows[0].proposal_version);
  });
  try {
    await sendProposal(deliveryRow, version);
    await dbPool.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      VALUES($1,'client.booking_request.alternative_sent','appointment',$2,$3::jsonb)`,
    [principal.id, id, JSON.stringify({ surface: 'workspace_booking_requests', proposalVersion: version })]);
  } catch (error) {
    await dbPool.query(`UPDATE appointment_booking_approvals SET status='pending',proposed_location_id=NULL,
      proposed_staff_id=NULL,proposed_staff_ids=NULL,proposed_service_id=NULL,proposed_starts_at=NULL,proposed_ends_at=NULL,
      proposal_expires_at=NULL,decision_note='proposal_delivery_failed',updated_at=NOW()
      WHERE appointment_id=$1 AND status='awaiting_client_confirmation' AND proposal_version=$2`, [id, version]);
    logger.error({ err: error, appointmentId: id, proposalVersion: version }, 'Booking alternative client delivery failed');
    throw new BookingRequestError('BOOKING_REQUEST_DELIVERY_FAILED', 'The alternative could not be delivered, so its hold was released and the request still needs attention.', 503);
  }
  return { ok: true, appointmentId: id, status: 'awaiting_client_confirmation', proposalVersion: version };
}

async function defaultSendCannotAccommodate(row) {
  const configured = String(process.env.WHATSAPP_BOOKING_DECLINED_TEMPLATE || '').trim();
  if (configured !== 'shiloh_booking_declined_v1') return { sent: false, reason: 'template_not_configured' };
  await sendWhatsAppTemplate(normalizePhone(row.current_client_phone), configured,
    [row.client_name, row.service_name, fmtDateTime(row.requested_starts_at), String(row.appointment_id)],
    process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en', ['client_booking_start']);
  return { sent: true };
}

async function cannotAccommodate({ dbPool = pool, principal, appointmentId, expectedRevision, sendOutcome = defaultSendCannotAccommodate }) {
  const id = positiveId(appointmentId);
  const row = await inTransaction(dbPool, async db => {
    const locked = await loadRequest(db, id, true);
    requireResolvable(principal, locked, expectedRevision);
    const updated = await db.query(`UPDATE appointment_booking_approvals SET status='declined',decided_at=NOW(),
      decided_by_admin_id=$2,decision_note='workspace_cannot_accommodate',proposal_expires_at=NULL,updated_at=NOW()
      WHERE appointment_id=$1 AND status IN ('pending','awaiting_client_confirmation') RETURNING appointment_id`, [id, principal.id]);
    if (updated.rowCount !== 1) throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This request changed before it could be resolved.', 409);
    const cancelled = await db.query(`UPDATE appointments SET status='cancelled',updated_at=NOW() WHERE id=$1 AND status<>'cancelled' RETURNING id`, [id]);
    if (cancelled.rowCount !== 1) throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This appointment changed before it could be cancelled.', 409);
    await db.query(`UPDATE appointment_lifecycle SET status='cancelled',updated_at=NOW()
      WHERE appointment_id=$1 AND status<>'cancelled'`, [id]);
    await db.query(`INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
      VALUES($1,$2,'cancelled',$3,'Booking request could not be accommodated in Workspace')`,
    [id, locked.appointment_status, `admin:${principal.id}`]);
    await audit(db, principal, 'client.booking_request.cannot_accommodate', id);
    return locked;
  });
  let delivery;
  try { delivery = await sendOutcome(row); }
  catch (error) { logger.error({ err: error, appointmentId: id }, 'Cannot-accommodate client delivery failed'); delivery = { sent: false, reason: 'send_failed' }; }
  return { ok: true, appointmentId: id, status: 'declined', delivery };
}

async function clientIdentityMatches(row, sender) {
  const phone = normalizePhone(sender);
  return Boolean(phone && phone === normalizePhone(row.requested_client_phone) && phone === normalizePhone(row.current_client_phone)
    && String(row.requested_client_id || '') === String(row.current_client_id || '')
    && String(row.requested_crm_v2_client_id || '') === String(row.current_crm_v2_client_id || ''));
}

function clearProposalSql(nextStatus = 'pending') {
  return `status='${nextStatus}',proposed_location_id=NULL,proposed_staff_id=NULL,proposed_service_id=NULL,
    proposed_staff_ids=NULL,
    proposed_starts_at=NULL,proposed_ends_at=NULL,proposal_expires_at=NULL,client_responded_at=NOW(),updated_at=NOW()`;
}

async function requestAnotherOption({ dbPool = pool, sender, appointmentId, proposalVersion }) {
  const id = positiveId(appointmentId);
  await inTransaction(dbPool, async db => {
    const row = await loadRequest(db, id, true);
    if (!row || row.status !== 'awaiting_client_confirmation' || Number(row.proposal_version) !== positiveId(proposalVersion)) {
      throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
    }
    if (!(await clientIdentityMatches(row, sender))) throw new BookingRequestError('BOOKING_PROPOSAL_IDENTITY', 'That response does not match the booking request.', 403);
    const updated = await db.query(`UPDATE appointment_booking_approvals SET ${clearProposalSql()} WHERE appointment_id=$1 AND status='awaiting_client_confirmation' AND proposal_version=$2 RETURNING appointment_id`, [id, proposalVersion]);
    if (updated.rowCount !== 1) throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
    await audit(db, null, 'client.booking_request.another_option_requested', id, { proposalVersion: Number(proposalVersion) });
  });
  return { handled: true, status: 'pending', reply: 'Thanks — I’ve asked the Shiloh team to review another option. Your request is not confirmed yet.' };
}

async function acceptProposedAlternative({ dbPool = pool, sender, appointmentId, proposalVersion, now = new Date(), validateWindow = canonicalWindowAvailable, sendConfirmation = sendCustomerBookingConfirmationForAppointment }) {
  const id = positiveId(appointmentId);
  const outcome = await inTransaction(dbPool, async db => {
    const row = await loadRequest(db, id, true);
    if (!row || row.status !== 'awaiting_client_confirmation' || Number(row.proposal_version) !== positiveId(proposalVersion)) {
      throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
    }
    if (!(await clientIdentityMatches(row, sender))) throw new BookingRequestError('BOOKING_PROPOSAL_IDENTITY', 'That response does not match the booking request.', 403);
    if (!requestSnapshotMatches(row)) throw new BookingRequestError('BOOKING_PROPOSAL_CANONICAL_DRIFT', 'The original request changed, so this option cannot be confirmed.', 409);
    if (new Date(row.proposal_expires_at).getTime() <= now.getTime()) {
      const expired = await db.query(`UPDATE appointment_booking_approvals SET ${clearProposalSql()} WHERE appointment_id=$1 AND status='awaiting_client_confirmation' AND proposal_version=$2 RETURNING appointment_id`, [id, proposalVersion]);
      if (expired.rowCount !== 1) throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
      await audit(db, null, 'client.booking_request.proposal_expired', id, { proposalVersion: Number(proposalVersion) });
      return { status: 'expired' };
    }
    const proposedStaffIds = canonicalIds(row.proposed_staff_ids);
    await lockStaffIds(db, proposedStaffIds);
    const available = await validateAllWindows(db, {
      appointmentId: id, staffIds: proposedStaffIds, serviceIds: row.current_service_ids, locationId: Number(row.proposed_location_id),
      startsAt: row.proposed_starts_at, endsAt: row.proposed_ends_at, excludeProposalAppointmentId: id,
    }, validateWindow);
    if (!available.ok) {
      const released = await db.query(`UPDATE appointment_booking_approvals SET ${clearProposalSql()} WHERE appointment_id=$1 AND status='awaiting_client_confirmation' AND proposal_version=$2 RETURNING appointment_id`, [id, proposalVersion]);
      if (released.rowCount !== 1) throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
      await audit(db, null, 'client.booking_request.proposal_unavailable', id, { proposalVersion: Number(proposalVersion), reason: available.reason });
      return { status: 'unavailable' };
    }
    const accepted = await db.query(`UPDATE appointment_booking_approvals SET status='approved',decided_at=NOW(),client_responded_at=NOW(),
      decision_note='client_accepted_workspace_alternative',proposal_expires_at=NULL,updated_at=NOW()
      WHERE appointment_id=$1 AND status='awaiting_client_confirmation' AND proposal_version=$2
      RETURNING appointment_id`, [id, proposalVersion]);
    if (accepted.rowCount !== 1) throw new BookingRequestError('BOOKING_PROPOSAL_STALE', 'That proposed option is no longer active.', 409);
    await db.query(`UPDATE appointments SET location_id=$2,starts_at=$3,ends_at=$4,updated_at=NOW() WHERE id=$1`,
      [id, row.proposed_location_id, row.proposed_starts_at, row.proposed_ends_at]);
    if (proposedStaffIds.length === 1 && Number(row.current_staff_id) !== proposedStaffIds[0]) {
      await db.query(`UPDATE appointment_staff SET staff_id=$2,staff_name_snapshot=$3 WHERE appointment_id=$1 AND position=1`,
        [id, proposedStaffIds[0], available.canonical.display_name]);
    }
    await db.query(`UPDATE appointment_lifecycle SET appointment_at=$2,appointment_ends_at=$3,
      therapist_text=(SELECT string_agg(staff_name_snapshot,' + ' ORDER BY position) FROM appointment_staff WHERE appointment_id=$1),
      reminder_sent_at=NULL,updated_at=NOW() WHERE appointment_id=$1`, [id, row.proposed_starts_at, row.proposed_ends_at]);
    await db.query(`INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
      VALUES($1,$2,$2,$3,'Client accepted Workspace-proposed booking alternative after canonical revalidation')`,
    [id, row.appointment_status, `client:${normalizePhone(sender)}`]);
    await audit(db, null, 'client.booking_request.alternative_accepted', id, { proposalVersion: Number(proposalVersion), staffIds: proposedStaffIds });
    return { status: 'approved' };
  });
  if (outcome.status === 'expired') return { handled: true, status: 'pending', reply: 'That option has expired, so it was not booked. The Shiloh team will review another option.' };
  if (outcome.status === 'unavailable') return { handled: true, status: 'pending', reply: 'That option is no longer available, so it was not booked. The Shiloh team will review another option.' };
  const confirmation = await sendConfirmation(id);
  return { handled: true, status: 'approved', confirmation, reply: confirmation.sent
    ? 'Your appointment is confirmed. I’ve sent the final booking details. 🌿'
    : 'Your appointment is confirmed after the final availability check. The Shiloh team can help if the confirmation message is delayed.' };
}

async function processClientBookingProposalMessage(sender, text, options = {}) {
  const action = parseClientProposalAction(text);
  if (!action) return { handled: false };
  try {
    return action.action === 'accept'
      ? await acceptProposedAlternative({ sender, ...action, ...options })
      : await requestAnotherOption({ sender, ...action, ...options });
  } catch (error) {
    if (error instanceof BookingRequestError) return { handled: true, status: 'rejected', reply: error.message };
    logger.error({ err: error, appointmentId: action.appointmentId }, 'Client booking proposal response failed');
    return { handled: true, status: 'failed', reply: 'I couldn’t safely process that booking response. No new appointment confirmation was made; please ask the Shiloh team to review it.' };
  }
}

module.exports = {
  CLIENT_ACCEPT_PREFIX,
  CLIENT_ANOTHER_PREFIX,
  PROPOSAL_TTL_MS,
  BookingRequestError,
  clientActionId,
  proposalReplyButtons,
  parseClientProposalAction,
  operatorCanResolve,
  requestSnapshotMatches,
  createPendingBookingApproval,
  listUnresolvedBookingRequests,
  canonicalWindowAvailable,
  acceptRequestedAppointment,
  proposeAlternative,
  cannotAccommodate,
  requestAnotherOption,
  acceptProposedAlternative,
  processClientBookingProposalMessage,
};
