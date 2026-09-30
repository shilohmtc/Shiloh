const { pool } = require('../db/pool');
const { verifyMigrationFile } = require('./migrations');
const { ensureClientRescheduleApprovalSchema } = require('./clientRescheduleApprovalSchema');
const { queueClientNotification, createMyShilohPushService } = require('./myShilohPush');
const { appointmentDetails } = require('./sh05ChannelIndependence');
const { resolveClientFacingName } = require('./clientFacingNameAuthority');
const logger = require('../lib/logger');

const MIGRATION = '065_client_reschedule_approved_confirmation.sql';
const RETRY_MS = 5 * 60 * 1000;
const CLAIM_STALE_MINUTES = 5;
let schemaReady = null;
let scheduler = null;

function fmtDate(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function fmtTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

async function ensureApprovedRescheduleNotificationSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await ensureClientRescheduleApprovalSchema();
    const migration = await verifyMigrationFile(MIGRATION);
    const verification = await pool.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='appointment_reschedule_requests'
             AND column_name='client_notification_attempt_count'
        ) AS attempt_column,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='appointment_reschedule_requests'
             AND column_name='client_notification_claimed_at'
        ) AS claim_column,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='appointment_reschedule_requests'
             AND column_name='client_notification_suppressed_at'
        ) AS suppression_column,
        EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname='public'
             AND indexname='idx_appointment_reschedule_requests_approved_unnotified'
        ) AS retry_index
    `);
    const row = verification.rows[0] || {};
    if (!row.attempt_column || !row.claim_column || !row.suppression_column || !row.retry_index) {
      throw new Error('Approved reschedule notification schema verification failed');
    }
    return {
      initialized: true,
      migration: MIGRATION,
      applied: false,
      checksumVerified: migration.checksumMatches === true,
      appliedAt: migration.appliedAt || null,
      attemptColumn: row.attempt_column === true,
      claimColumn: row.claim_column === true,
      suppressionColumn: row.suppression_column === true,
      retryIndex: row.retry_index === true,
      notificationChannel: 'my_shiloh',
    };
  })();
  try {
    return await schemaReady;
  } catch (error) {
    schemaReady = null;
    throw error;
  }
}

async function latestApprovedRescheduleAudit(appointmentId) {
  const result = await pool.query(`
    SELECT id,
           metadata->>'source' AS source,
           CASE
             WHEN COALESCE(metadata->>'requestId','') ~ '^\\d+$'
             THEN (metadata->>'requestId')::bigint
             ELSE NULL
           END AS request_id
      FROM crm_audit_events
     WHERE entity_type='appointment'
       AND entity_id=$1
       AND action='appointment.time_updated'
     ORDER BY id DESC
     LIMIT 1
  `, [String(appointmentId)]);
  const row = result.rows[0] || null;
  if (row?.source !== 'client_reschedule_approval' || !row?.request_id) return null;
  return { auditEventId: Number(row.id), requestId: Number(row.request_id) };
}

async function loadApprovedRequestContext(requestId) {
  const result = await pool.query(`
    SELECT request.id,request.appointment_id,request.status AS request_status,
           request.client_id AS request_client_id,request.crm_v2_client_id AS request_crm_v2_client_id,
           request.requested_by_phone,
           request.proposed_starts_at,request.proposed_ends_at,
           request.client_notified_at,request.client_notification_claimed_at,
           request.client_notification_suppressed_at,
           appointment.client_id AS appointment_client_id,
           appointment.crm_v2_client_id AS appointment_crm_v2_client_id,
           appointment.source_client_name,
           appointment.starts_at AS current_starts_at,
           appointment.ends_at AS current_ends_at,
           appointment.status AS appointment_status,
           COALESCE((SELECT string_agg(COALESCE(service.name,item.service_name_snapshot), ' + ' ORDER BY item.position)
                       FROM appointment_services item
                       LEFT JOIN services service ON service.id=item.service_id
                      WHERE item.appointment_id=appointment.id),appointment.title,'Shiloh appointment') AS service_name,
           COALESCE((SELECT string_agg(COALESCE(staff.display_name,item.staff_name_snapshot), ' + ' ORDER BY item.position)
                       FROM appointment_staff item
                       LEFT JOIN staff ON staff.id=item.staff_id
                      WHERE item.appointment_id=appointment.id),'Shiloh practitioner') AS staff_name,
           CASE WHEN appointment.crm_v2_client_id IS NOT NULL THEN v2.normalized_mobile ELSE
             (SELECT normalized_value
                FROM client_contacts contact
               WHERE contact.client_id=appointment.client_id
                 AND LOWER(contact.contact_type) IN ('whatsapp','mobile','phone','telephone')
                 AND contact.normalized_value IS NOT NULL
               ORDER BY contact.is_primary DESC,contact.verified_at DESC NULLS LAST,contact.id
               LIMIT 1)
           END AS client_phone,
           v2.id AS crm_v2_authority_id,
           v2.name AS crm_v2_client_name
      FROM appointment_reschedule_requests request
      JOIN appointments appointment ON appointment.id=request.appointment_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=appointment.crm_v2_client_id AND v2.status='active'
     WHERE request.id=$1
     LIMIT 1
  `, [Number(requestId)]);
  const context = result.rows[0] || null;
  if (!context) return null;
  const nameResolution = context.appointment_client_id ? await resolveClientFacingName(context.appointment_client_id) : null;
  return {
    ...context,
    client_name: context.appointment_crm_v2_client_id
      ? (context.crm_v2_client_name || context.source_client_name || null)
      : (nameResolution?.name || null),
    name_authority_id: nameResolution?.authorityId || null,
  };
}

function sameCanonicalId(left, right) {
  return left == null && right == null
    ? true
    : left != null && right != null && String(left) === String(right);
}

function canonicalIdentityContinuity(context) {
  if (!context) return false;
  const requestXor = Number(context.request_client_id != null) + Number(context.request_crm_v2_client_id != null) === 1;
  const appointmentXor = Number(context.appointment_client_id != null) + Number(context.appointment_crm_v2_client_id != null) === 1;
  if (!requestXor || !appointmentXor) return false;
  if (!sameCanonicalId(context.request_client_id, context.appointment_client_id)) return false;
  if (!sameCanonicalId(context.request_crm_v2_client_id, context.appointment_crm_v2_client_id)) return false;
  if (context.request_crm_v2_client_id != null) {
    return String(context.crm_v2_authority_id) === String(context.request_crm_v2_client_id)
      && context.requested_by_phone === context.client_phone;
  }
  return true;
}

function canonicalOutcomeState(context) {
  if (!context) return { deliverable: false, suppress: false, reason: 'request_not_found' };
  if (context.request_status !== 'approved') return { deliverable: false, suppress: false, reason: `request_${context.request_status}` };
  if (context.client_notified_at) return { deliverable: false, suppress: false, reason: 'already_sent' };
  if (context.client_notification_suppressed_at) return { deliverable: false, suppress: false, reason: 'already_suppressed' };
  if (!canonicalIdentityContinuity(context)) return { deliverable: false, suppress: true, reason: 'canonical_client_identity_changed_after_approval' };
  if (context.appointment_status === 'cancelled') return { deliverable: false, suppress: true, reason: 'appointment_cancelled_after_approval' };
  if (new Date(context.current_ends_at).getTime() <= Date.now()) return { deliverable: false, suppress: true, reason: 'appointment_already_ended' };
  if (
    new Date(context.current_starts_at).getTime() !== new Date(context.proposed_starts_at).getTime()
    || new Date(context.current_ends_at).getTime() !== new Date(context.proposed_ends_at).getTime()
  ) {
    return { deliverable: false, suppress: true, reason: 'canonical_appointment_changed_after_approval' };
  }
  if (!context.client_phone && !context.request_crm_v2_client_id) return { deliverable: false, suppress: false, reason: 'client_phone_not_found' };
  return { deliverable: true, suppress: false, reason: null };
}

async function markApprovedRescheduleNotificationRetryableError(requestId, reason) {
  await pool.query(`
    UPDATE appointment_reschedule_requests
       SET client_notification_claimed_at=NULL,
           client_notification_last_error=$2,
           updated_at=NOW()
     WHERE id=$1
       AND status='approved'
       AND client_notified_at IS NULL
       AND client_notification_suppressed_at IS NULL
  `, [Number(requestId), String(reason).slice(0, 1000)]);
  return { sent: false, reason };
}

async function suppressApprovedRescheduleNotification(requestId, reason) {
  const result = await pool.query(`
    UPDATE appointment_reschedule_requests
       SET client_notification_suppressed_at=COALESCE(client_notification_suppressed_at,NOW()),
           client_notification_suppression_reason=$2,
           client_notification_claimed_at=NULL,
           updated_at=NOW()
     WHERE id=$1
       AND status='approved'
       AND client_notified_at IS NULL
       AND client_notification_suppressed_at IS NULL
     RETURNING appointment_id
  `, [Number(requestId), String(reason).slice(0, 500)]);
  if (result.rowCount) {
    await pool.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('customer.reschedule_confirmation_suppressed','appointment',$1,$2::jsonb)
    `, [String(result.rows[0].appointment_id), JSON.stringify({ requestId: Number(requestId), reason })]);
    logger.info({ requestId: Number(requestId), appointmentId: Number(result.rows[0].appointment_id), reason }, 'Approved reschedule customer confirmation suppressed');
  }
  return { suppressed: result.rowCount > 0, reason };
}

async function claimApprovedRescheduleNotification(requestId) {
  const result = await pool.query(`
    UPDATE appointment_reschedule_requests
       SET client_notification_claimed_at=NOW(),
           client_notification_attempt_count=client_notification_attempt_count+1,
           client_notification_last_error=NULL,
           updated_at=NOW()
     WHERE id=$1
       AND status='approved'
       AND client_notified_at IS NULL
       AND client_notification_suppressed_at IS NULL
       AND (
         client_notification_claimed_at IS NULL
         OR client_notification_claimed_at <= NOW() - INTERVAL '${CLAIM_STALE_MINUTES} minutes'
       )
     RETURNING id
  `, [Number(requestId)]);
  return result.rowCount > 0;
}

async function deliverApprovedRescheduleAppNotification(context, {
  notifyClient = queueClientNotification,
  wakeClient = createMyShilohPushService().wakeClient,
} = {}) {
  const clientId = Number(context.request_crm_v2_client_id);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return { sent: false, reason: 'my_shiloh_client_unavailable' };
  const notification = appointmentDetails({ appointmentId: context.appointment_id,
    crmV2ClientId: clientId, startsAt: context.current_starts_at, endsAt: context.current_ends_at,
    changeKind: 'reschedule', auditEventId: context.id });
  const result = await notifyClient(notification);
  // A retry wakes the same durable event rather than creating another notice.
  const delivery = result?.duplicate === true ? await wakeClient(clientId) : result;
  if (Number(delivery?.accepted) <= 0 || !Number.isFinite(Number(delivery?.accepted))) {
    return { sent: false, reason: 'my_shiloh_push_not_accepted' };
  }
  if (result?.queued !== true && result?.duplicate !== true) return { sent: false, reason: 'my_shiloh_notification_unavailable' };
  return { sent: true, channel: 'my_shiloh', notificationId: result.notificationId || null };
}

async function attemptApprovedRescheduleConfirmation(requestId, auditEventId = null) {
  await ensureApprovedRescheduleNotificationSchema();
  let context = await loadApprovedRequestContext(requestId);
  const state = canonicalOutcomeState(context);
  if (!state.deliverable) {
    if (state.suppress) return suppressApprovedRescheduleNotification(requestId, state.reason);
    if (state.reason === 'client_phone_not_found') return markApprovedRescheduleNotificationRetryableError(requestId, state.reason);
    return { sent: false, reason: state.reason };
  }

  const claimed = await claimApprovedRescheduleNotification(requestId);
  if (!claimed) return { sent: false, reason: 'already_claimed_or_completed' };

  context = await loadApprovedRequestContext(requestId);
  const afterClaim = canonicalOutcomeState(context);
  if (!afterClaim.deliverable) {
    if (afterClaim.suppress) return suppressApprovedRescheduleNotification(requestId, afterClaim.reason);
    if (afterClaim.reason === 'client_phone_not_found') return markApprovedRescheduleNotificationRetryableError(requestId, afterClaim.reason);
    await pool.query(`UPDATE appointment_reschedule_requests SET client_notification_claimed_at=NULL,updated_at=NOW() WHERE id=$1`, [Number(requestId)]);
    return { sent: false, reason: afterClaim.reason };
  }

  try {
    const delivery = await deliverApprovedRescheduleAppNotification(context);
    if (!delivery.sent) return markApprovedRescheduleNotificationRetryableError(requestId, delivery.reason);
    await pool.query(`
      UPDATE appointment_reschedule_requests
         SET client_notified_at=NOW(),
             client_notification_claimed_at=NULL,
             client_notification_last_error=NULL,
             updated_at=NOW()
       WHERE id=$1
         AND status='approved'
         AND client_notified_at IS NULL
    `, [Number(requestId)]);
    await pool.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES ('customer.reschedule_confirmation_sent','appointment',$1,$2::jsonb)
    `, [String(context.appointment_id), JSON.stringify({
      requestId: Number(requestId),
      sourceAuditEventId: auditEventId == null ? null : Number(auditEventId),
      channel: 'my_shiloh',
      notificationId: delivery.notificationId,
      idempotentDelivery: true,
      nameAuthorityId: context.name_authority_id || null,
      identityModel: context.request_crm_v2_client_id != null ? 'crm_v2' : 'legacy',
      clientId: context.request_client_id,
      crmV2ClientId: context.request_crm_v2_client_id,
    })]);
    logger.info({ appointmentId: Number(context.appointment_id), requestId: Number(requestId), channel: 'my_shiloh' }, 'Approved reschedule customer confirmation sent');
    return delivery;
  } catch (error) {
    const message = String(error.response?.data?.error?.message || error.message || error).slice(0, 1000);
    await markApprovedRescheduleNotificationRetryableError(requestId, message);
    logger.error({ err: error, appointmentId: Number(context.appointment_id), requestId: Number(requestId) }, 'Approved reschedule customer confirmation failed; retained for retry');
    return { sent: false, reason: 'send_failed' };
  }
}

async function queueApprovedRescheduleConfirmation(appointmentId, audit = null) {
  await ensureApprovedRescheduleNotificationSchema();
  const source = audit || await latestApprovedRescheduleAudit(appointmentId);
  if (!source?.requestId) return { queued: false, reason: 'approved_reschedule_audit_not_found' };
  const attempted = await attemptApprovedRescheduleConfirmation(source.requestId, source.auditEventId);
  return {
    queued: true,
    requestId: Number(source.requestId),
    auditEventId: Number(source.auditEventId),
    attempted,
  };
}

async function flushApprovedRescheduleConfirmations() {
  await ensureApprovedRescheduleNotificationSchema();
  const result = await pool.query(`
    SELECT id
      FROM appointment_reschedule_requests
     WHERE status='approved'
       AND client_notified_at IS NULL
       AND client_notification_suppressed_at IS NULL
       AND (
         client_notification_claimed_at IS NULL
         OR client_notification_claimed_at <= NOW() - INTERVAL '${CLAIM_STALE_MINUTES} minutes'
       )
       AND updated_at <= NOW() - INTERVAL '5 minutes'
     ORDER BY updated_at,id
     LIMIT 25
  `);
  for (const row of result.rows) {
    try {
      await attemptApprovedRescheduleConfirmation(row.id);
    } catch (error) {
      logger.error({ err: error, requestId: Number(row.id) }, 'Approved reschedule confirmation retry failed');
    }
  }
  return { attempted: result.rowCount };
}

function startApprovedRescheduleConfirmationScheduler() {
  if (scheduler) return;
  setImmediate(async () => {
    try {
      const state = await ensureApprovedRescheduleNotificationSchema();
      logger.info(state, 'Approved reschedule notification schema verified');
      await flushApprovedRescheduleConfirmations();
    } catch (error) {
      logger.error({ err: error }, 'Approved reschedule notification initialization failed');
    }
  });
  scheduler = setInterval(() => {
    flushApprovedRescheduleConfirmations().catch((error) => logger.error({ err: error }, 'Approved reschedule confirmation retry scan failed'));
  }, RETRY_MS);
  scheduler.unref?.();
  logger.info({ retryMinutes: RETRY_MS / 60000 }, 'Approved reschedule confirmation scheduler started');
}

module.exports = {
  MIGRATION,
  RETRY_MS,
  fmtDate,
  fmtTime,
  ensureApprovedRescheduleNotificationSchema,
  latestApprovedRescheduleAudit,
  loadApprovedRequestContext,
  canonicalIdentityContinuity,
  canonicalOutcomeState,
  markApprovedRescheduleNotificationRetryableError,
  suppressApprovedRescheduleNotification,
  deliverApprovedRescheduleAppNotification,
  attemptApprovedRescheduleConfirmation,
  queueApprovedRescheduleConfirmation,
  flushApprovedRescheduleConfirmations,
  startApprovedRescheduleConfirmationScheduler,
};
