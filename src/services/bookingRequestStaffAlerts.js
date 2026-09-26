const { pool } = require('../db/pool');
const { sendWhatsAppTemplate } = require('./whatsapp');
const { TEMPLATE_NAME: STAFF_ALERT_TEMPLATE } = require('./workspaceBookingRequestAlertTemplateProvisioning');
const { configuredMetaTemplateName } = require('./metaTemplateAdapter');
const logger = require('../lib/logger');

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const GLOBAL_COORDINATION_ROLES = ['owner', 'business_admin', 'booking_operator'];
const ALERT_CONTRACT_ID = 'workspace_booking_request_alert';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formatRequestTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'requested time';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function configuredAlertTemplate(environment = process.env) {
  const template = configuredMetaTemplateName(ALERT_CONTRACT_ID, environment);
  if (!template) {
    const error = new Error('Workspace booking-request alert template is not configured.');
    error.code = 'WORKSPACE_BOOKING_REQUEST_ALERT_TEMPLATE_UNCONFIGURED';
    throw error;
  }
  if (template !== STAFF_ALERT_TEMPLATE) {
    const error = new Error('Workspace booking-request alert template selector does not match the canonical contract.');
    error.code = 'WORKSPACE_BOOKING_REQUEST_ALERT_TEMPLATE_MISMATCH';
    throw error;
  }
  return template;
}

async function requestAlertContext(db, appointmentId) {
  const id = positiveId(appointmentId);
  if (!id) return null;
  const result = await db.query(`
    SELECT aba.appointment_id,aba.status,aba.requested_staff_id,aba.requested_starts_at,
           COALESCE(st.display_name,'Shiloh practitioner') AS staff_name,
           t.id AS team_id,t.display_name AS team_name
      FROM appointment_booking_approvals aba
      LEFT JOIN staff st ON st.id=aba.requested_staff_id
      LEFT JOIN staff_operational_team_members tm ON tm.staff_id=aba.requested_staff_id AND tm.active=TRUE
      LEFT JOIN staff_operational_teams t ON t.id=tm.team_id AND t.active=TRUE
     WHERE aba.appointment_id=$1
     LIMIT 1`, [id]);
  return result.rows?.[0] || null;
}

async function alertRecipients(db, context) {
  if (!context) return [];
  const result = await db.query(`
    SELECT DISTINCT a.id AS admin_id,a.normalized_whatsapp,a.display_name,
           CASE
             WHEN brcs.admin_id IS NOT NULL THEN brcs.scope_kind
             WHEN a.business_role=ANY($2::text[]) AND a.calendar_scope='all_business' THEN 'global'
             ELSE 'self'
           END AS effective_scope,
           brcs.team_id,
           CASE
             WHEN brcs.admin_id IS NOT NULL AND brcs.scope_kind='team' THEN (
               SELECT COUNT(DISTINCT pending.appointment_id)::int
                 FROM appointment_booking_approvals pending
                 JOIN staff_operational_team_members pending_tm
                   ON pending_tm.staff_id=pending.requested_staff_id
                  AND pending_tm.active=TRUE
                WHERE pending.status IN ('pending','awaiting_client_confirmation')
                  AND pending_tm.team_id=brcs.team_id
             )
             ELSE (
               SELECT COUNT(*)::int
                 FROM appointment_booking_approvals pending
                WHERE pending.status IN ('pending','awaiting_client_confirmation')
             )
           END AS pending_count
      FROM staff_admin_accounts a
      LEFT JOIN booking_request_coordination_scopes brcs ON brcs.admin_id=a.id AND brcs.active=TRUE
     WHERE a.active=TRUE
       AND a.normalized_whatsapp IS NOT NULL
       AND BTRIM(a.normalized_whatsapp)<>''
       AND a.business_role=ANY($2::text[])
       AND a.calendar_scope='all_business'
       AND (
         (brcs.admin_id IS NOT NULL AND brcs.receive_alerts=TRUE AND (
            brcs.scope_kind='global' OR (brcs.scope_kind='team' AND brcs.team_id=$1)
          ))
         OR
         (brcs.admin_id IS NULL AND a.business_role=ANY($2::text[]) AND a.calendar_scope='all_business')
       )
     ORDER BY a.id`, [positiveId(context.team_id), GLOBAL_COORDINATION_ROLES]);
  return result.rows || [];
}

async function ensureAlertRows(db, appointmentId, recipients) {
  for (const recipient of recipients) {
    await db.query(`
      INSERT INTO booking_request_staff_alerts(appointment_id,admin_id,alert_kind,status)
      VALUES($1,$2,'initial','pending')
      ON CONFLICT (appointment_id,admin_id,alert_kind) DO NOTHING`,
    [positiveId(appointmentId), positiveId(recipient.admin_id)]);
  }
}

async function claimAlert(db, appointmentId, adminId, now = new Date()) {
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS);
  const result = await db.query(`
    UPDATE booking_request_staff_alerts
       SET status='sending',attempt_count=attempt_count+1,last_attempt_at=$3,updated_at=NOW(),last_error_code=NULL
     WHERE appointment_id=$1 AND admin_id=$2 AND alert_kind='initial'
       AND attempt_count<$4
       AND (
         status='pending'
         OR (status='failed' AND (last_attempt_at IS NULL OR last_attempt_at<=$5))
       )
    RETURNING appointment_id,admin_id,attempt_count`,
  [positiveId(appointmentId), positiveId(adminId), now, MAX_ATTEMPTS, retryBefore]);
  return result.rows?.[0] || null;
}

function providerMessageId(result) {
  return result?.messages?.[0]?.id || null;
}

async function markSent(db, appointmentId, adminId, result) {
  await db.query(`
    UPDATE booking_request_staff_alerts
       SET status='sent',sent_at=NOW(),provider_message_id=$3,last_error_code=NULL,updated_at=NOW()
     WHERE appointment_id=$1 AND admin_id=$2 AND alert_kind='initial'`,
  [positiveId(appointmentId), positiveId(adminId), providerMessageId(result)]);
}

async function markFailed(db, appointmentId, adminId, error) {
  const code = String(error?.code || error?.response?.data?.error?.code || 'delivery_failed').slice(0, 120);
  await db.query(`
    UPDATE booking_request_staff_alerts
       SET status='failed',last_error_code=$3,updated_at=NOW()
     WHERE appointment_id=$1 AND admin_id=$2 AND alert_kind='initial'`,
  [positiveId(appointmentId), positiveId(adminId), code]);
}

function alertBody(context) {
  const owner = context.team_name || context.staff_name || 'Shiloh team';
  return [
    '*New booking request needs attention 🌿*',
    '',
    `Owner: ${owner}`,
    `Requested: ${formatRequestTime(context.requested_starts_at)}`,
    `Booking #${context.appointment_id}`,
    '',
    'Open Shiloh Workspace to review and resolve it. WhatsApp is only the alert doorway.',
  ].join('\n');
}

async function defaultSendAlert(recipient) {
  const recipientName = String(recipient.display_name || 'Shiloh team').trim() || 'Shiloh team';
  const pendingCount = Math.max(1, Number(recipient.pending_count) || 1);
  const template = configuredAlertTemplate();
  return sendWhatsAppTemplate(
    recipient.normalized_whatsapp,
    template,
    [recipientName, String(pendingCount)],
    'en',
    ['staff_open_workspace'],
  );
}

async function dispatchBookingRequestAlerts({
  db = pool,
  appointmentId,
  now = new Date(),
  sendAlert = defaultSendAlert,
} = {}) {
  const context = await requestAlertContext(db, appointmentId);
  if (!context || !['pending', 'awaiting_client_confirmation'].includes(context.status)) {
    return { appointmentId: positiveId(appointmentId), recipients: 0, sent: 0, failed: 0, skipped: true };
  }
  const recipients = await alertRecipients(db, context);
  await ensureAlertRows(db, context.appointment_id, recipients);
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const claim = await claimAlert(db, context.appointment_id, recipient.admin_id, now);
    if (!claim) continue;
    try {
      const result = await sendAlert(recipient, context);
      await markSent(db, context.appointment_id, recipient.admin_id, result);
      sent += 1;
    } catch (error) {
      failed += 1;
      await markFailed(db, context.appointment_id, recipient.admin_id, error);
      logger.error({ err: error, appointmentId: context.appointment_id, adminId: recipient.admin_id }, 'Booking-request staff alert delivery failed');
    }
  }
  return { appointmentId: Number(context.appointment_id), recipients: recipients.length, sent, failed, skipped: false };
}

module.exports = {
  MAX_ATTEMPTS,
  RETRY_AFTER_MS,
  GLOBAL_COORDINATION_ROLES,
  ALERT_CONTRACT_ID,
  STAFF_ALERT_TEMPLATE,
  formatRequestTime,
  configuredAlertTemplate,
  requestAlertContext,
  alertRecipients,
  ensureAlertRows,
  claimAlert,
  alertBody,
  defaultSendAlert,
  dispatchBookingRequestAlerts,
};
