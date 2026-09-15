const { pool } = require('../db/pool');
const { checkAssistantBookingHours: checkClinicHours } = require('./assistantBookingHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');
const { pendingBookingProposalConflicts } = require('./bookingRequestHolds');
const { sendWhatsAppTemplate } = require('./whatsapp');
const {
  IDENTITY_MODELS,
  identityAuditMetadata,
} = require('./whatsappCrmV2IdentityCompat');
const {
  resolveFinalBookingIdentity,
  identityFromAppointment,
} = require('./whatsappBookingIdentity');
const { normalizeMobile } = require('./crmV2ClientService');
const logger = require('../lib/logger');

const TIME_ZONE = 'Africa/Johannesburg';
const APPROVE_PREFIX = 'reschedule_approval_approve_';
const DECLINE_PREFIX = 'reschedule_approval_decline_';
const APPROVAL_TEMPLATE = 'shiloh_reschedule_approval_request_v1';
const DECLINED_TEMPLATE = 'shiloh_reschedule_declined_v1';

function featureEnabled() {
  return process.env.WHATSAPP_RESCHEDULE_APPROVAL_ENABLED === 'true';
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function canonicalRequestPhone(value = '') {
  return normalizeMobile(value) || normalizePhone(value);
}

function fmtDateTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function parseClock(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  let match = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute > 59) return null;
    if (match[3]) {
      if (hour < 1 || hour > 12) return null;
      if (match[3] === 'pm' && hour !== 12) hour += 12;
      if (match[3] === 'am' && hour === 12) hour = 0;
    }
    if (hour > 23) return null;
    return { hour, minute };
  }
  match = raw.match(/^(\d{1,2})\s*(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    if (hour < 1 || hour > 12) return null;
    if (match[2] === 'pm' && hour !== 12) hour += 12;
    if (match[2] === 'am' && hour === 12) hour = 0;
    return { hour, minute: 0 };
  }
  if (/^\d{1,2}$/.test(raw)) {
    const hour = Number(raw);
    return hour <= 23 ? { hour, minute: 0 } : null;
  }
  return null;
}

function localDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const clock = parseClock(time);
  if (!clock) return null;
  const parsed = new Date(`${date}T${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}:00+02:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isClientConfirmation(text = '') {
  return /^(yes|y|confirm|confirmed|correct|proceed|continue|ok|okay)$/i.test(String(text).trim());
}

function decisionFromText(text = '') {
  const raw = String(text || '').trim();
  let match = raw.match(/^reschedule_approval_approve_(\d+)$/i);
  if (match) return { requestId: Number(match[1]), decision: 'approved' };
  match = raw.match(/^reschedule_approval_decline_(\d+)$/i);
  if (match) return { requestId: Number(match[1]), decision: 'declined' };
  return null;
}

async function pendingRescheduleConflicts({ db = pool, staffId, startsAt, endsAt, excludeRequestId = null }) {
  const result = await db.query(`
    SELECT 'reschedule_hold'::text AS conflict_type,
           request.id,
           request.proposed_starts_at AS starts_at,
           request.proposed_ends_at AS ends_at,
           'Pending client reschedule approval'::text AS label
      FROM appointment_reschedule_requests request
     WHERE request.approver_staff_id=$1
       AND request.status='pending'
       AND request.proposed_starts_at<$3
       AND request.proposed_ends_at>$2
       AND ($4::bigint IS NULL OR request.id<>$4)
     ORDER BY request.proposed_starts_at,request.id
  `, [staffId, startsAt, endsAt, excludeRequestId]);
  return result.rows;
}

function appointmentContextQuery({ lock = false } = {}) {
  return `
    SELECT a.id,a.client_id,a.crm_v2_client_id,a.location_id,a.starts_at,a.ends_at,a.status,a.source,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN 'crm_v2' ELSE 'legacy' END AS identity_model,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           ast.staff_id,COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           aps.service_id,COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
           (SELECT COUNT(*)::int FROM appointment_services x WHERE x.appointment_id=a.id) AS service_count
      FROM appointments a
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      LEFT JOIN staff st ON st.id=ast.staff_id
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      LEFT JOIN services s ON s.id=aps.service_id
     WHERE a.id=$2
       AND a.status<>'cancelled'
       AND num_nonnulls(a.client_id,a.crm_v2_client_id)=1
       AND (
         (a.client_id IS NOT NULL AND a.crm_v2_client_id IS NULL AND EXISTS (
           SELECT 1
             FROM client_contacts cc
            WHERE cc.client_id=a.client_id
              AND cc.normalized_value=$1
              AND LOWER(cc.contact_type) IN ('whatsapp','mobile','phone','telephone')
         ))
         OR (a.client_id IS NULL AND a.crm_v2_client_id IS NOT NULL AND v2.normalized_mobile=$1)
       )
     LIMIT 1
     ${lock ? 'FOR UPDATE OF a,ast,aps' : ''}
  `;
}

async function loadAppointmentForRequest(phone, appointmentId, db = pool, lock = false) {
  const result = await db.query(appointmentContextQuery({ lock }), [canonicalRequestPhone(phone), Number(appointmentId)]);
  return result.rows[0] || null;
}

async function resolveApproverContact(staffId, db = pool) {
  const result = await db.query(`
    SELECT id,staff_id,display_name,normalized_whatsapp
      FROM staff_admin_accounts
     WHERE staff_id=$1
       AND active=TRUE
       AND normalized_whatsapp IS NOT NULL
     ORDER BY id
  `, [staffId]);
  if (result.rowCount !== 1) {
    return { ok: false, reason: result.rowCount ? 'approver_identity_ambiguous' : 'approver_whatsapp_unavailable' };
  }
  return { ok: true, admin: result.rows[0] };
}

async function resolveAdminByWhatsApp(sender, db = pool) {
  const result = await db.query(`
    SELECT id,staff_id,display_name,normalized_whatsapp
      FROM staff_admin_accounts
     WHERE normalized_whatsapp=$1 AND active=TRUE
     ORDER BY id
  `, [normalizePhone(sender)]);
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function canonicalConflicts({ db = pool, appointmentId, staffId, startsAt, endsAt }) {
  const result = await db.query(`
    SELECT ap.id,ap.starts_at,ap.ends_at
      FROM appointments ap
      JOIN appointment_staff ast ON ast.appointment_id=ap.id
     WHERE ast.staff_id=$1
       AND ap.id<>$2
       AND ap.status<>'cancelled'
       AND ap.starts_at<$4
       AND ap.ends_at>$3
     LIMIT 1
  `, [staffId, appointmentId, startsAt, endsAt]);
  return result.rows;
}

async function validateCandidate({ db = pool, appointment, proposedStartsAt, proposedEndsAt, excludeRequestId = null }) {
  if (!appointment || Number(appointment.staff_count) !== 1 || !appointment.staff_id) {
    return { ok: false, reason: 'complex_practitioner_setup' };
  }
  if (Number(appointment.service_count) !== 1 || !appointment.service_id) {
    return { ok: false, reason: 'complex_service_setup' };
  }
  if (proposedStartsAt.getTime() <= Date.now()) return { ok: false, reason: 'past_time' };

  const clinic = await checkClinicHours({ db, locationId: appointment.location_id, startsAt: proposedStartsAt, endsAt: proposedEndsAt });
  if (!clinic.covered) return { ok: false, reason: 'clinic_hours' };

  const schedule = await checkAuthoritativeSchedule({
    db,
    staffId: Number(appointment.staff_id),
    locationId: appointment.location_id,
    startsAt: proposedStartsAt,
    endsAt: proposedEndsAt,
  });
  if (schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException) || !schedule.covered) {
    return { ok: false, reason: 'staff_schedule' };
  }

  const conflicts = await canonicalConflicts({
    db,
    appointmentId: appointment.id,
    staffId: appointment.staff_id,
    startsAt: proposedStartsAt,
    endsAt: proposedEndsAt,
  });
  if (conflicts.length) return { ok: false, reason: 'crm_conflict' };

  const holds = await pendingRescheduleConflicts({
    db,
    staffId: appointment.staff_id,
    startsAt: proposedStartsAt,
    endsAt: proposedEndsAt,
    excludeRequestId,
  });
  if (holds.length) return { ok: false, reason: 'reschedule_hold_conflict' };
  const bookingProposalHolds = await pendingBookingProposalConflicts({
    db,
    staffId: appointment.staff_id,
    startsAt: proposedStartsAt,
    endsAt: proposedEndsAt,
    excludeAppointmentId: appointment.id,
  });
  if (bookingProposalHolds.length) return { ok: false, reason: 'booking_proposal_hold_conflict' };
  return { ok: true };
}

function requestFailureReply(reason, staffName = 'the practitioner') {
  const copy = {
    past_time: 'That requested time has already passed.',
    clinic_hours: 'That requested time is outside Shiloh’s clinic hours.',
    staff_schedule: `${staffName} is not available at that requested time.`,
    crm_conflict: 'That requested time is no longer available.',
    reschedule_hold_conflict: 'That requested time is already being held for another pending change.',
    booking_proposal_hold_conflict: 'That requested time is already being held for a client booking proposal.',
    complex_practitioner_setup: 'This appointment has a complex practitioner setup, so the clinic team needs to help reschedule it safely.',
    complex_service_setup: 'This appointment has a complex service setup, so the clinic team needs to help reschedule it safely.',
    approver_whatsapp_unavailable: `I can’t safely send ${staffName} the required approval request right now.`,
    approver_identity_ambiguous: `I can’t safely resolve one authorized WhatsApp approver for ${staffName}.`,
  };
  return `${copy[reason] || 'I couldn’t safely create that reschedule request.'}\n\nYour current appointment is unchanged.`;
}

async function sendApprovalRequest(request, appointment, approver) {
  const configured = String(process.env.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE || '').trim();
  if (configured !== APPROVAL_TEMPLATE) throw new Error('Reschedule approval request template is not configured to the frozen contract');
  await sendWhatsAppTemplate(
    approver.normalized_whatsapp,
    APPROVAL_TEMPLATE,
    [
      appointment.client_name,
      appointment.service_name,
      fmtDateTime(appointment.starts_at),
      fmtDateTime(request.proposed_starts_at),
      String(appointment.id),
    ],
    process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    [`${APPROVE_PREFIX}${request.id}`, `${DECLINE_PREFIX}${request.id}`]
  );
}

async function markNotificationFailed(requestId, appointmentId, error) {
  await pool.query(`
    UPDATE appointment_reschedule_requests
       SET status='notification_failed',decision_note=$2,updated_at=NOW()
     WHERE id=$1 AND status='pending'
  `, [requestId, String(error.message || error).slice(0, 1000)]);
  await pool.query(`
    INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
    VALUES ('client.reschedule_approval.notification_failed','appointment',$1,$2::jsonb)
  `, [appointmentId, JSON.stringify({ requestId: Number(requestId), error: String(error.message || error).slice(0, 500) })]);
}

async function resolveRescheduleRequestIdentity({ db, phone, appointment }) {
  const identity = identityFromAppointment(appointment);
  if (!identity) return { status: 'identity_contract_invalid', identity: null, client: null };

  if (identity.identityModel === IDENTITY_MODELS.LEGACY) {
    return {
      status: 'ready',
      identity,
      client: { display_name: appointment.client_name },
      clientId: identity.legacyClientId,
      crmV2ClientId: null,
      clientName: appointment.client_name,
      clientPhone: canonicalRequestPhone(phone),
      audit: identityAuditMetadata(identity, { resolution: 'legacy_reschedule_exact_mobile' }),
    };
  }

  const authority = await resolveFinalBookingIdentity({ db, phone, identity });
  if (authority.status !== 'ready') return authority;
  return {
    ...authority,
    clientId: null,
    crmV2ClientId: identity.crmV2ClientId,
    clientName: authority.client.name || authority.client.display_name,
    clientPhone: authority.client.normalizedMobile || authority.client.normalized_value,
  };
}

async function insertPendingRescheduleRequest(db, {
  appointment,
  authority,
  requestedByPhone,
  proposedStartsAt,
  proposedEndsAt,
}) {
  return db.query(`
    INSERT INTO appointment_reschedule_requests
      (appointment_id,client_id,crm_v2_client_id,service_id,approver_staff_id,requested_by_phone,
       original_starts_at,original_ends_at,proposed_starts_at,proposed_ends_at,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
    ON CONFLICT (appointment_id) WHERE status='pending' DO NOTHING
    RETURNING *
  `, [
    appointment.id,
    authority.clientId,
    authority.crmV2ClientId,
    appointment.service_id,
    appointment.staff_id,
    requestedByPhone,
    appointment.starts_at,
    appointment.ends_at,
    proposedStartsAt,
    proposedEndsAt,
  ]);
}

async function createPendingRescheduleRequest(phone, intent) {
  if (!featureEnabled()) return { status: 'feature_disabled' };
  const appointment = await loadAppointmentForRequest(phone, intent?.appointment_id);
  if (!appointment) {
    return { status: 'appointment_not_found', reply: 'That booking is no longer available to change. Your current appointments were not modified.' };
  }

  const proposedStartsAt = localDateTime(intent?.preferred_date, intent?.preferred_time);
  if (!proposedStartsAt) return { status: 'invalid_time', reply: 'I couldn’t safely resolve that requested date and time. Your current appointment is unchanged.' };
  const duration = new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime();
  if (!(duration > 0)) return { status: 'invalid_duration', reply: 'This appointment does not have a valid duration, so the clinic team needs to help reschedule it safely. Your current appointment is unchanged.' };
  const proposedEndsAt = new Date(proposedStartsAt.getTime() + duration);

  const approver = await resolveApproverContact(appointment.staff_id);
  if (!approver.ok) return { status: approver.reason, reply: requestFailureReply(approver.reason, appointment.staff_name) };

  const initial = await validateCandidate({ appointment, proposedStartsAt, proposedEndsAt });
  if (!initial.ok) return { status: initial.reason, reply: requestFailureReply(initial.reason, appointment.staff_name) };
  const db = await pool.connect();
  let request;
  let notificationAppointment = appointment;
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [Number(appointment.staff_id)]);
    const locked = await loadAppointmentForRequest(phone, appointment.id, db, true);
    if (!locked) {
      await db.query('ROLLBACK');
      return { status: 'appointment_changed', reply: 'That appointment changed while I was checking it. Your current booking was not moved; please start the reschedule again.' };
    }
    if (
      new Date(locked.starts_at).getTime() !== new Date(appointment.starts_at).getTime()
      || new Date(locked.ends_at).getTime() !== new Date(appointment.ends_at).getTime()
      || Number(locked.staff_id) !== Number(appointment.staff_id)
      || Number(locked.service_id || 0) !== Number(appointment.service_id || 0)
    ) {
      await db.query('ROLLBACK');
      return { status: 'appointment_changed', reply: 'That appointment changed while I was checking it. Your current booking was not moved; please start the reschedule again.' };
    }

    const final = await validateCandidate({ db, appointment: locked, proposedStartsAt, proposedEndsAt });
    if (!final.ok) {
      await db.query('ROLLBACK');
      return { status: final.reason, reply: requestFailureReply(final.reason, locked.staff_name) };
    }
    const authority = await resolveRescheduleRequestIdentity({ db, phone, appointment: locked });
    if (authority.status !== 'ready') {
      await db.query('ROLLBACK');
      return {
        status: 'client_identity_changed',
        reply: 'The exact canonical client identity changed while I was checking this request. Your current appointment is unchanged; please contact the clinic team.',
      };
    }
    notificationAppointment = { ...locked, client_name: authority.clientName };
    const inserted = await insertPendingRescheduleRequest(db, {
      appointment: locked,
      authority,
      requestedByPhone: authority.clientPhone || canonicalRequestPhone(phone),
      proposedStartsAt,
      proposedEndsAt,
    });
    if (!inserted.rowCount) {
      await db.query('ROLLBACK');
      return { status: 'already_pending', reply: 'A reschedule request is already awaiting approval for this appointment. Your current appointment remains confirmed until that request is decided.' };
    }
    request = inserted.rows[0];
    await db.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('client.reschedule_approval.requested','appointment',$1,$2::jsonb)
    `, [locked.id, JSON.stringify({
      requestId: Number(request.id),
      proposedStartsAt: proposedStartsAt.toISOString(),
      approverStaffId: Number(locked.staff_id),
      ...authority.audit,
    })]);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }

  try {
    await sendApprovalRequest(request, notificationAppointment, approver.admin);
    await pool.query(`UPDATE appointment_reschedule_requests SET approver_notified_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='pending'`, [request.id]);
    await pool.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('client.reschedule_approval.approver_notified','appointment',$1,$2::jsonb)
    `, [appointment.id, JSON.stringify({ requestId: Number(request.id), approverStaffId: Number(appointment.staff_id), approverAdminId: Number(approver.admin.id) })]);
  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id, requestId: Number(request.id) }, 'Client reschedule approval notification failed');
    await markNotificationFailed(request.id, appointment.id, error);
    return { status: 'notification_failed', reply: `I couldn’t safely send ${appointment.staff_name} the required approval request, so no change request is being held. Your current appointment remains unchanged.` };
  }

  return {
    status: 'pending_approval',
    requestId: Number(request.id),
    reply: [
      '*Reschedule request sent 🌿*',
      '',
      `We’ve asked ${appointment.staff_name} to approve your requested new time.`,
      '',
      `*Current:* ${fmtDateTime(appointment.starts_at)}`,
      `*Requested:* ${fmtDateTime(proposedStartsAt)}`,
      '',
      'Your current appointment remains confirmed and unchanged until the requested change is approved.',
    ].join('\n'),
  };
}

async function loadRequestContext(requestId, db = pool, lock = false) {
  const result = await db.query(`
    SELECT request.id,request.appointment_id,request.client_id,request.crm_v2_client_id,
           request.service_id AS requested_service_id,request.approver_staff_id,request.requested_by_phone,
           request.original_starts_at,request.original_ends_at,request.proposed_starts_at,request.proposed_ends_at,
           request.status AS request_status,request.requested_at,request.approver_notified_at,
           a.client_id AS appointment_client_id,a.crm_v2_client_id AS appointment_crm_v2_client_id,
           a.location_id,a.starts_at AS current_starts_at,a.ends_at AS current_ends_at,a.status AS appointment_status,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN 'crm_v2' ELSE 'legacy' END AS identity_model,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           ast.staff_id AS current_staff_id,aps.service_id AS current_service_id,
           (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
           (SELECT COUNT(*)::int FROM appointment_services x WHERE x.appointment_id=a.id) AS service_count,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN v2.normalized_mobile ELSE
             (SELECT normalized_value FROM client_contacts cc WHERE cc.client_id=a.client_id AND LOWER(cc.contact_type) IN ('whatsapp','mobile','phone','telephone') AND cc.normalized_value IS NOT NULL ORDER BY cc.is_primary DESC,cc.id LIMIT 1)
           END AS client_phone,
           v2.id AS crm_v2_authority_id
      FROM appointment_reschedule_requests request
      JOIN appointments a ON a.id=request.appointment_id
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      LEFT JOIN staff st ON st.id=ast.staff_id
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      LEFT JOIN services s ON s.id=aps.service_id
     WHERE request.id=$1
     LIMIT 1
     ${lock ? 'FOR UPDATE OF request,a,ast,aps' : ''}
  `, [requestId]);
  return result.rows[0] || null;
}

function canonicalStillMatchesRequest(context) {
  return Boolean(
    context
    && context.appointment_status !== 'cancelled'
    && context.request_status === 'pending'
    && Number(context.client_id != null) + Number(context.crm_v2_client_id != null) === 1
    && Number(context.appointment_client_id != null) + Number(context.appointment_crm_v2_client_id != null) === 1
    && (context.client_id == null || String(context.client_id) === String(context.appointment_client_id))
    && (context.crm_v2_client_id == null || String(context.crm_v2_client_id) === String(context.appointment_crm_v2_client_id))
    && (context.crm_v2_client_id == null || String(context.crm_v2_authority_id) === String(context.crm_v2_client_id))
    && (context.crm_v2_client_id == null || canonicalRequestPhone(context.requested_by_phone) === context.client_phone)
    && Number(context.staff_count) === 1
    && Number(context.service_count) === 1
    && Number(context.current_staff_id) === Number(context.approver_staff_id)
    && Number(context.current_service_id || 0) === Number(context.requested_service_id || 0)
    && new Date(context.current_starts_at).getTime() === new Date(context.original_starts_at).getTime()
    && new Date(context.current_ends_at).getTime() === new Date(context.original_ends_at).getTime()
  );
}

async function revalidateDecisionIdentity(db, context) {
  if (context?.crm_v2_client_id == null) {
    return {
      status: 'ready',
      clientName: context?.client_name || null,
      clientPhone: context?.client_phone || null,
      audit: identityAuditMetadata(
        identityFromAppointment({ client_id: context?.appointment_client_id, crm_v2_client_id: null }),
        { resolution: 'legacy_reschedule_decision_identity' }
      ),
    };
  }
  const identity = identityFromAppointment({
    client_id: context.appointment_client_id,
    crm_v2_client_id: context.appointment_crm_v2_client_id,
  });
  if (!identity || identity.identityModel !== IDENTITY_MODELS.CRM_V2) return { status: 'identity_contract_invalid' };
  const authority = await resolveFinalBookingIdentity({ db, phone: context.requested_by_phone, identity });
  if (authority.status !== 'ready') return authority;
  return {
    ...authority,
    clientName: authority.client.name || authority.client.display_name,
    clientPhone: authority.client.normalizedMobile || authority.client.normalized_value,
  };
}

async function supersedeRequest(db, context, adminId, note) {
  await db.query(`
    UPDATE appointment_reschedule_requests
       SET status='superseded',decided_at=NOW(),decided_by_admin_id=$2,decision_note=$3,updated_at=NOW()
     WHERE id=$1 AND status='pending'
  `, [context.id, adminId || null, note]);
}

async function supersedePendingRescheduleForAppointment(appointmentId, reason = 'canonical appointment changed') {
  if (!appointmentId) return { superseded: 0 };
  const result = await pool.query(`
    UPDATE appointment_reschedule_requests
       SET status='superseded',decided_at=NOW(),decision_note=$2,updated_at=NOW()
     WHERE appointment_id=$1 AND status='pending'
     RETURNING id
  `, [Number(appointmentId), String(reason).slice(0, 500)]);
  if (result.rowCount) {
    await pool.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('client.reschedule_approval.superseded','appointment',$1,$2::jsonb)
    `, [Number(appointmentId), JSON.stringify({ reason, requestIds: result.rows.map((row) => Number(row.id)) })]);
  }
  return { superseded: result.rowCount };
}

async function sendDeclinedOutcome(context) {
  if (!context.client_phone) return { sent: false, reason: 'client_phone_unavailable' };
  const configured = String(process.env.WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE || '').trim();
  if (configured !== DECLINED_TEMPLATE) return { sent: false, reason: 'template_not_configured' };
  try {
    await sendWhatsAppTemplate(
      context.client_phone,
      DECLINED_TEMPLATE,
      [
        context.client_name,
        context.service_name,
        fmtDateTime(context.proposed_starts_at),
        fmtDateTime(context.original_starts_at),
        String(context.appointment_id),
      ],
      process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
      ['client_reschedule_booking']
    );
    await pool.query(`UPDATE appointment_reschedule_requests SET client_notified_at=NOW(),updated_at=NOW() WHERE id=$1`, [context.id]);
    return { sent: true };
  } catch (error) {
    logger.error({ err: error, requestId: Number(context.id), appointmentId: Number(context.appointment_id) }, 'Client reschedule decline notification failed');
    return { sent: false, reason: 'send_failed' };
  }
}

async function queueApprovedCustomerUpdate(appointmentId) {
  const { queueCustomerChangeNotification } = require('./customerChangeNotification');
  return queueCustomerChangeNotification(appointmentId, 'time');
}

async function approveRequest(admin, requestId) {
  const db = await pool.connect();
  let context = null;
  try {
    await db.query('BEGIN');
    context = await loadRequestContext(requestId, db, true);
    if (!context) { await db.query('ROLLBACK'); return { handled: true, reply: 'That reschedule approval request no longer exists.' }; }
    if (Number(admin.staff_id) !== Number(context.approver_staff_id)) { await db.query('ROLLBACK'); return { handled: true, reply: 'You are not authorized to decide this reschedule request, so no change was made.' }; }
    if (context.request_status !== 'pending') { await db.query('ROLLBACK'); return { handled: true, reply: `This reschedule request has already been ${context.request_status}.` }; }
    if (!canonicalStillMatchesRequest(context)) {
      await supersedeRequest(db, context, admin.id, 'canonical appointment changed before approval');
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: 'The original appointment changed after this request was made, so this approval request was closed without applying another change.' };
    }

    await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [Number(context.current_staff_id)]);
    const decisionAuthority = await revalidateDecisionIdentity(db, context);
    if (decisionAuthority.status !== 'ready') {
      await supersedeRequest(db, context, admin.id, 'canonical client identity changed before approval');
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: 'The canonical client identity changed after this request was made, so the approval request was closed without moving the appointment.' };
    }
    context.client_name = decisionAuthority.clientName;
    context.client_phone = decisionAuthority.clientPhone;
    const appointment = {
      id: context.appointment_id,
      client_id: context.appointment_client_id,
      crm_v2_client_id: context.appointment_crm_v2_client_id,
      location_id: context.location_id,
      starts_at: context.current_starts_at,
      ends_at: context.current_ends_at,
      status: context.appointment_status,
      client_name: context.client_name,
      staff_id: context.current_staff_id,
      staff_name: context.staff_name,
      service_id: context.current_service_id,
      service_name: context.service_name,
      staff_count: context.staff_count,
      service_count: context.service_count,
    };
    const proposedStartsAt = new Date(context.proposed_starts_at);
    const proposedEndsAt = new Date(context.proposed_ends_at);
    const candidate = await validateCandidate({ db, appointment, proposedStartsAt, proposedEndsAt, excludeRequestId: context.id });
    if (!candidate.ok) {
      await supersedeRequest(db, context, admin.id, `availability changed: ${candidate.reason}`);
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: `That requested time is no longer safely available (${candidate.reason}). The original appointment remains unchanged.` };
    }
    const moved = await db.query(`
      UPDATE appointments SET starts_at=$1,ends_at=$2,updated_at=NOW()
       WHERE id=$3
         AND client_id IS NOT DISTINCT FROM $4::bigint
         AND crm_v2_client_id IS NOT DISTINCT FROM $5::bigint
       RETURNING client_id,crm_v2_client_id
    `, [proposedStartsAt, proposedEndsAt, context.appointment_id, context.client_id, context.crm_v2_client_id]);
    if (!moved.rowCount) {
      await supersedeRequest(db, context, admin.id, 'canonical appointment identity changed before approval mutation');
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: 'The appointment identity changed before approval could be applied, so the request was closed without moving the appointment.' };
    }
    await db.query(`UPDATE appointment_lifecycle SET appointment_at=$1,appointment_ends_at=$2,reminder_sent_at=NULL,updated_at=NOW() WHERE appointment_id=$3`, [proposedStartsAt, proposedEndsAt, context.appointment_id]);

    await db.query(`UPDATE appointment_reschedule_requests SET status='approved',decided_at=NOW(),decided_by_admin_id=$2,updated_at=NOW() WHERE id=$1 AND status='pending'`, [context.id, admin.id]);
    await db.query(`INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason) VALUES($1,$2,$2,$3,'Client reschedule approved by practitioner')`, [context.appointment_id, context.appointment_status, `staff_admin:${admin.id}`]);
    const timeAudit = await db.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('appointment.time_updated','appointment',$1,$2::jsonb)
      RETURNING id
    `, [context.appointment_id, JSON.stringify({
      source: 'client_reschedule_approval',
      requestId: Number(context.id),
      requestedByPhone: context.requested_by_phone,
      approvedByAdminId: Number(admin.id),
      fromStart: context.original_starts_at,
      toStart: proposedStartsAt.toISOString(),
      identityModel: context.identity_model,
      clientId: moved.rows[0].client_id,
      crmV2ClientId: moved.rows[0].crm_v2_client_id,
      identityResolution: decisionAuthority.audit?.identityResolution || null,
    })]);
    await db.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('client.reschedule_approval.approved','appointment',$1,$2::jsonb)
    `, [context.appointment_id, JSON.stringify({ requestId: Number(context.id), timeAuditEventId: Number(timeAudit.rows[0].id), approvedByAdminId: Number(admin.id), approvedByName: admin.display_name })]);
    await db.query('COMMIT');

    try {
      await queueApprovedCustomerUpdate(context.appointment_id);
    } catch (notificationError) {
      logger.error({ err: notificationError, appointmentId: Number(context.appointment_id), requestId: Number(context.id) }, 'Approved client reschedule customer notification queue failed');
    }
    return { handled: true, status: 'approved', reply: `Approved by ${admin.display_name}. Appointment #${context.appointment_id} has been moved to ${fmtDateTime(proposedStartsAt)} and the client update has been queued.` };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function declineRequest(admin, requestId) {
  const db = await pool.connect();
  let context;
  try {
    await db.query('BEGIN');
    context = await loadRequestContext(requestId, db, true);
    if (!context) { await db.query('ROLLBACK'); return { handled: true, reply: 'That reschedule approval request no longer exists.' }; }
    if (Number(admin.staff_id) !== Number(context.approver_staff_id)) { await db.query('ROLLBACK'); return { handled: true, reply: 'You are not authorized to decide this reschedule request, so no change was made.' }; }
    if (context.request_status !== 'pending') { await db.query('ROLLBACK'); return { handled: true, reply: `This reschedule request has already been ${context.request_status}.` }; }
    if (!canonicalStillMatchesRequest(context)) {
      await supersedeRequest(db, context, admin.id, 'canonical appointment changed before decline');
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: 'The original appointment changed after this request was made, so this stale reschedule request was closed without sending an outdated client message.' };
    }
    const decisionAuthority = await revalidateDecisionIdentity(db, context);
    if (decisionAuthority.status !== 'ready') {
      await supersedeRequest(db, context, admin.id, 'canonical client identity changed before decline');
      await db.query('COMMIT');
      return { handled: true, status: 'superseded', reply: 'The canonical client identity changed after this request was made, so this stale reschedule request was closed without sending an outdated client message.' };
    }
    context.client_name = decisionAuthority.clientName;
    context.client_phone = decisionAuthority.clientPhone;
    await db.query(`UPDATE appointment_reschedule_requests SET status='declined',decided_at=NOW(),decided_by_admin_id=$2,updated_at=NOW() WHERE id=$1 AND status='pending'`, [context.id, admin.id]);
    await db.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('client.reschedule_approval.declined','appointment',$1,$2::jsonb)
    `, [context.appointment_id, JSON.stringify({
      requestId: Number(context.id),
      declinedByAdminId: Number(admin.id),
      declinedByName: admin.display_name,
      identityModel: context.identity_model,
      clientId: context.client_id,
      crmV2ClientId: context.crm_v2_client_id,
      identityResolution: decisionAuthority.audit?.identityResolution || null,
    })]);
    await db.query('COMMIT');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }

  const delivery = await sendDeclinedOutcome(context);
  return {
    handled: true,
    status: 'declined',
    reply: delivery.sent
      ? `Declined by ${admin.display_name}. The client's original appointment is unchanged and the client has been notified.`
      : `Declined by ${admin.display_name}. The client's original appointment is unchanged. Client notification status: ${delivery.reason}.`,
  };
}

async function processRescheduleApprovalDecision(sender, text) {
  const decision = decisionFromText(text);
  if (!decision) return { handled: false };
  const admin = await resolveAdminByWhatsApp(sender);
  if (!admin) return { handled: true, reply: 'I can’t resolve this WhatsApp number to exactly one active staff admin identity, so no reschedule decision was recorded.' };
  const context = await loadRequestContext(decision.requestId);
  if (!context) return { handled: true, reply: 'That reschedule approval request no longer exists.' };
  if (Number(admin.staff_id) !== Number(context.approver_staff_id)) return { handled: true, reply: 'You are not authorized to decide this reschedule request, so no change was made.' };
  try {
    return decision.decision === 'approved'
      ? await approveRequest(admin, decision.requestId)
      : await declineRequest(admin, decision.requestId);
  } catch (error) {
    logger.error({ err: error, requestId: decision.requestId, decision: decision.decision }, 'Client reschedule approval decision failed');
    return { handled: true, reply: 'I couldn’t safely complete that reschedule decision. The canonical appointment was not intentionally changed; please review the request again or contact the clinic team.' };
  }
}

module.exports = {
  APPROVE_PREFIX,
  DECLINE_PREFIX,
  APPROVAL_TEMPLATE,
  DECLINED_TEMPLATE,
  featureEnabled,
  isClientConfirmation,
  decisionFromText,
  localDateTime,
  pendingRescheduleConflicts,
  appointmentContextQuery,
  loadAppointmentForRequest,
  resolveRescheduleRequestIdentity,
  insertPendingRescheduleRequest,
  createPendingRescheduleRequest,
  processRescheduleApprovalDecision,
  loadRequestContext,
  canonicalStillMatchesRequest,
  revalidateDecisionIdentity,
  supersedePendingRescheduleForAppointment,
};
