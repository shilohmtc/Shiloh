'use strict';

const { pool } = require('../db/pool');
const logger = require('../lib/logger');
const { sendWhatsAppMessage, sendWhatsAppTemplate } = require('./whatsapp');
const { TEMPLATE_NAME } = require('./problemReportResolvedTemplateProvisioning');

const RETRY_MS = 5 * 60 * 1000;
let scheduler = null;

function resolutionMessage(report) {
  return `✅ *Problem resolved*\n\nYour report *${report.reference_code}* has been resolved.\n\n*Update:* ${report.resolution_note}\n\nIf the problem continues, reply *Still not working ${report.reference_code}* and we’ll reopen it. 🌿`;
}

async function claimNext(db = pool) {
  const result = await db.query(
    `/* problemReportNotifications:claim */
     WITH candidate AS (
       SELECT notification.id
         FROM problem_report_notifications notification
        WHERE notification.attempt_count < 288
          AND notification.next_attempt_at <= NOW()
          AND (notification.state IN ('pending','failed')
            OR (notification.state='sending' AND notification.claimed_at < NOW()-INTERVAL '10 minutes'))
        ORDER BY notification.next_attempt_at,notification.id
        LIMIT 1 FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE problem_report_notifications notification
          SET state='sending',claimed_at=NOW(),attempt_count=attempt_count+1,error_code=NULL
         FROM candidate WHERE notification.id=candidate.id
       RETURNING notification.*
     )
     SELECT claimed.*,report.reference_code,report.resolution_note,report.reporter_name_snapshot,
            COALESCE(staff.normalized_whatsapp,client.normalized_mobile) AS recipient
       FROM claimed
       JOIN problem_reports report ON report.id=claimed.problem_report_id
       LEFT JOIN staff_admin_accounts staff ON staff.id=report.reporter_staff_admin_id AND staff.active=TRUE
       LEFT JOIN crm_v2_clients client ON client.id=report.reporter_crm_v2_client_id AND client.status='active'`,
  );
  return result.rows[0] || null;
}

async function deliver(notification, { db = pool, sendMessage = sendWhatsAppMessage, sendTemplate = sendWhatsAppTemplate, env = process.env } = {}) {
  if (!notification?.recipient) throw new Error('problem_report_recipient_not_found');
  const templateName = String(env.WHATSAPP_PROBLEM_RESOLVED_TEMPLATE || TEMPLATE_NAME).trim();
  let provider;
  if (templateName) {
    provider = await sendTemplate(notification.recipient, templateName, [
      notification.reporter_name_snapshot || 'there',
      notification.reference_code,
      notification.resolution_note,
    ], env.WHATSAPP_TEMPLATE_LANGUAGE || 'en');
  } else {
    provider = await sendMessage(notification.recipient, resolutionMessage(notification));
  }
  const providerMessageId = provider?.messages?.[0]?.id || null;
  await db.query(
    `/* problemReportNotifications:sent */ UPDATE problem_report_notifications
       SET state='sent',claimed_at=NULL,sent_at=NOW(),provider_message_id=$2,error_code=NULL
     WHERE id=$1 AND state='sending'`,
    [Number(notification.id), providerMessageId],
  );
  logger.info({ notificationId: Number(notification.id), problemReportReference: notification.reference_code, template: templateName || null }, 'Problem report resolution notification sent');
  return { sent: true, providerMessageId };
}

async function markFailed(notification, error, db = pool) {
  const code = String(error?.response?.data?.error?.code || error?.code || error?.message || 'send_failed').slice(0, 160);
  await db.query(
    `/* problemReportNotifications:failed */ UPDATE problem_report_notifications
       SET state='failed',claimed_at=NULL,error_code=$2,
           next_attempt_at=NOW()+(INTERVAL '5 minutes' * LEAST(attempt_count,6))
     WHERE id=$1 AND state='sending'`,
    [Number(notification.id), code],
  );
  logger.error({ err: error, notificationId: Number(notification.id), problemReportReference: notification.reference_code }, 'Problem report resolution notification failed; retained for retry');
  return { sent: false, reason: code };
}

async function dispatchProblemReportNotifications({ db = pool, limit = 20, sendMessage, sendTemplate, env = process.env } = {}) {
  let attempted = 0;
  let sent = 0;
  while (attempted < Math.min(50, Math.max(1, Number(limit) || 20))) {
    const notification = await claimNext(db);
    if (!notification) break;
    attempted += 1;
    try {
      await deliver(notification, { db, sendMessage, sendTemplate, env });
      sent += 1;
    } catch (error) {
      await markFailed(notification, error, db);
    }
  }
  return { attempted, sent };
}

function startProblemReportNotificationScheduler() {
  if (scheduler) return scheduler;
  setTimeout(() => dispatchProblemReportNotifications().catch((error) => logger.error({ err: error }, 'Problem report notification initial scan failed')), 10000).unref?.();
  scheduler = setInterval(() => dispatchProblemReportNotifications().catch((error) => logger.error({ err: error }, 'Problem report notification retry scan failed')), RETRY_MS);
  scheduler.unref?.();
  logger.info({ retryMinutes: RETRY_MS / 60000, templateConfigured: Boolean(process.env.WHATSAPP_PROBLEM_RESOLVED_TEMPLATE) }, 'Problem report resolution notification scheduler started');
  return scheduler;
}

module.exports = { RETRY_MS, resolutionMessage, claimNext, deliver, markFailed, dispatchProblemReportNotifications, startProblemReportNotificationScheduler };
