const { pool } = require('../db/pool');
const { sendWhatsAppTemplate } = require('./whatsapp');
const { metaSignInOnly } = require('./metaSignInOnly');
const { resolveClientFacingName } = require('./clientFacingNameAuthority');
const { getClientLifecycleTemplateStatus } = require('./clientLifecycleTemplateProvisioning');
const logger = require('../lib/logger');
const { queueBookingChangeMyShilohNotification } = require('./sh05ChannelIndependence');

const ACTION_BY_KIND = Object.freeze({
  service: 'appointment.service_updated',
  practitioner: 'appointment.staff_updated',
  time: 'appointment.time_updated',
  price: 'appointment.price_updated',
  cancellation: 'admin.appointment_cancelled',
});
const ACTION_ALIASES_BY_KIND = Object.freeze({
  time: Object.freeze(['calendar.appointment_rescheduled']),
  cancellation: Object.freeze(['calendar.appointment_cancelled']),
});
const UPDATE_KINDS = new Set(['service', 'practitioner', 'time', 'price']);
const RETRY_MS = 5 * 60 * 1000;
const MAX_PRE_SEND_ATTEMPTS = 3;
let tableReady = false;
let scheduler = null;
let templateStatusCache = null;
let templateStatusCachedAt = 0;

function bookingChangeRetryEnabled(env = process.env) {
  return env.SHILOH_BOOKING_CHANGE_RETRY_ENABLED === 'true';
}

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

function priceLabel(value) {
  if (value == null) return 'Confirmed by Shiloh';
  const amount = Number(value);
  return Number.isFinite(amount) ? `R${amount.toFixed(2)}` : 'Confirmed by Shiloh';
}

async function ensureCustomerChangeNotificationTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_change_notifications (
      audit_event_id BIGINT PRIMARY KEY REFERENCES crm_audit_events(id) ON DELETE CASCADE,
      appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      change_kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','failed','suppressed')) DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      suppression_reason TEXT,
      suppressed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    ALTER TABLE customer_change_notifications
      ADD COLUMN IF NOT EXISTS suppression_reason TEXT;
    ALTER TABLE customer_change_notifications
      ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ;
    DO $$
    DECLARE
      status_constraint TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid)
        INTO status_constraint
        FROM pg_constraint
       WHERE conrelid = 'customer_change_notifications'::regclass
         AND conname = 'customer_change_notifications_status_check';
      IF status_constraint IS NULL OR POSITION('suppressed' IN status_constraint) = 0 THEN
        ALTER TABLE customer_change_notifications
          DROP CONSTRAINT IF EXISTS customer_change_notifications_status_check;
        ALTER TABLE customer_change_notifications
          ADD CONSTRAINT customer_change_notifications_status_check
          CHECK (status IN ('pending','sending','sent','failed','suppressed'));
      END IF;
    END $$;
  `);
  tableReady = true;
}

async function latestAuditEvent(appointmentId, changeKind) {
  const action = ACTION_BY_KIND[changeKind];
  if (!action) return null;
  const actions = [action, ...(ACTION_ALIASES_BY_KIND[changeKind] || [])];
  const result = await pool.query(
    `SELECT id,action,created_at
       FROM crm_audit_events
      WHERE entity_type='appointment' AND entity_id=$1 AND action=ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1`,
    [String(appointmentId), actions]
  );
  return result.rows[0] || null;
}

async function loadAppointmentSnapshot(appointmentId) {
  const result = await pool.query(`
    SELECT a.id,a.client_id,a.crm_v2_client_id,a.source_client_name,a.starts_at,a.ends_at,a.status,a.total_price,
           COALESCE((SELECT string_agg(COALESCE(s.name,aps.service_name_snapshot), ' + ' ORDER BY aps.position)
                       FROM appointment_services aps
                       LEFT JOIN services s ON s.id=aps.service_id
                      WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
           COALESCE((SELECT string_agg(COALESCE(st.display_name,ast.staff_name_snapshot), ' + ' ORDER BY ast.position)
                       FROM appointment_staff ast
                       LEFT JOIN staff st ON st.id=ast.staff_id
                      WHERE ast.appointment_id=a.id),'Shiloh practitioner') AS staff_name,
           CASE WHEN a.crm_v2_client_id IS NOT NULL THEN v2.normalized_mobile ELSE
             (SELECT normalized_value
                FROM client_contacts cc
               WHERE cc.client_id=a.client_id
                 AND LOWER(cc.contact_type) IN ('whatsapp','mobile','phone','telephone')
                 AND cc.normalized_value IS NOT NULL
               ORDER BY cc.is_primary DESC,cc.verified_at DESC NULLS LAST,cc.id
               LIMIT 1)
           END AS client_phone,
           v2.name AS crm_v2_client_name
      FROM appointments a
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
     WHERE a.id=$1`, [appointmentId]);
  const appointment = result.rows[0] || null;
  if (!appointment) return null;
  const nameResolution = appointment.client_id ? await resolveClientFacingName(appointment.client_id) : null;
  return {
    ...appointment,
    client_name: appointment.crm_v2_client_id
      ? (appointment.crm_v2_client_name || appointment.source_client_name || null)
      : (nameResolution?.name || null),
    name_authority_id: nameResolution?.authorityId || null,
  };
}

async function getTemplateStatus(force = false) {
  const now = Date.now();
  if (!force && templateStatusCache && now - templateStatusCachedAt < 60_000) return templateStatusCache;
  templateStatusCache = await getClientLifecycleTemplateStatus();
  templateStatusCachedAt = now;
  return templateStatusCache;
}

function approvedTemplate(status, key) {
  if (!status?.ok) return null;
  const item = status.templates.find((entry) => entry.key === key);
  if (!item?.provider || item.provider.status !== 'APPROVED') return null;
  return item.provider.name || item.templateName;
}

async function suppressEndedBookingUpdate(item) {
  if (!item || !UPDATE_KINDS.has(item.change_kind)) return false;
  const result = await pool.query(`
    UPDATE customer_change_notifications notification
       SET status='suppressed',
           suppression_reason='appointment_already_ended',
           suppressed_at=COALESCE(notification.suppressed_at,NOW()),
           updated_at=NOW()
      FROM appointments appointment
     WHERE notification.audit_event_id=$1
       AND appointment.id=notification.appointment_id
       AND notification.status IN ('pending','failed')
       AND appointment.ends_at <= NOW()
     RETURNING notification.audit_event_id`, [item.audit_event_id]);
  if (!result.rowCount) return false;
  logger.info({
    appointmentId: item.appointment_id,
    auditEventId: Number(item.audit_event_id),
    changeKind: item.change_kind,
    reason: 'appointment_already_ended',
  }, 'Customer booking-change confirmation suppressed');
  return true;
}

async function queueCustomerChangeNotification(appointmentId, changeKind) {
  if (!ACTION_BY_KIND[changeKind]) return { queued: false, reason: 'unsupported_change_kind' };
  await ensureCustomerChangeNotificationTable();
  const audit = await latestAuditEvent(appointmentId, changeKind);
  if (!audit) return { queued: false, reason: 'audit_event_not_found' };
  const inserted = await pool.query(`
    INSERT INTO customer_change_notifications (audit_event_id,appointment_id,change_kind,status)
    VALUES ($1,$2,$3,'pending')
    ON CONFLICT (audit_event_id) DO NOTHING
    RETURNING audit_event_id`, [audit.id, appointmentId, changeKind]);
  if (!inserted.rowCount) return { queued: false, reason: 'already_queued', auditEventId: audit.id };
  const attempted = await attemptCustomerChangeNotification(audit.id);
  return { queued: true, auditEventId: audit.id, attempted };
}

async function attemptCustomerChangeNotification(auditEventId, { env = process.env } = {}) {
  await ensureCustomerChangeNotificationTable();
  const queued = await pool.query(`
    SELECT audit_event_id,appointment_id,change_kind,status,attempt_count,suppression_reason,suppressed_at
      FROM customer_change_notifications
     WHERE audit_event_id=$1`, [auditEventId]);
  const item = queued.rows[0];
  if (!item) return { sent: false, reason: 'not_queued' };
  if (item.status === 'sent') return { sent: false, reason: 'already_sent' };
  if (item.status === 'suppressed') return { sent: false, reason: 'already_suppressed' };
  if (item.status === 'sending') return { sent: false, reason: 'provider_outcome_uncertain' };
  if (await suppressEndedBookingUpdate(item)) {
    return { sent: false, reason: 'appointment_already_ended', suppressed: true };
  }

  // The in-app notification is independent of WhatsApp template approval and delivery.
  const appointment = await loadAppointmentSnapshot(item.appointment_id);
  if (!appointment) {
    await pool.query(`UPDATE customer_change_notifications SET status='failed',attempt_count=attempt_count+1,last_error='appointment_not_found',updated_at=NOW() WHERE audit_event_id=$1 AND status IN ('pending','failed')`, [auditEventId]);
    return { sent: false, reason: 'appointment_not_found' };
  }
  if (await suppressEndedBookingUpdate(item)) {
    return { sent: false, reason: 'appointment_already_ended', suppressed: true };
  }
  const appDetails = {
    appointmentId: appointment.id,
    crmV2ClientId: appointment.crm_v2_client_id,
    clientName: appointment.client_name,
    serviceName: appointment.service_name,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    changeKind: item.change_kind,
    auditEventId,
  };
  const appOnlyEligible = env.SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED === 'true'
    && appointment.client_id == null
    && Number.isSafeInteger(Number(appointment.crm_v2_client_id))
    && Number(appointment.crm_v2_client_id) > 0
    && Boolean(appointment.crm_v2_client_name);
  if (appOnlyEligible) {
    // Claim before the push wake. If recording acceptance fails, the sending
    // state prevents a later retry from also sending a WhatsApp template.
    const appClaim = await pool.query(`
      UPDATE customer_change_notifications
         SET status='sending',last_error=NULL,updated_at=NOW()
       WHERE audit_event_id=$1 AND status IN ('pending','failed')
         AND (change_kind='cancellation' OR EXISTS (
           SELECT 1 FROM appointments a WHERE a.id=appointment_id AND a.ends_at>NOW()
         ))
       RETURNING audit_event_id`, [auditEventId]);
    if (!appClaim.rowCount) {
      if (await suppressEndedBookingUpdate(item)) return { sent: false, reason: 'appointment_already_ended', suppressed: true };
      return { sent: false, reason: 'already_sending_or_sent' };
    }
    let appDelivery;
    try {
      appDelivery = await queueBookingChangeMyShilohNotification(appDetails);
    } catch (error) {
      logger.error({ err: error, auditEventId: Number(auditEventId) }, 'Booking change app wake failed');
    }
    if (appDelivery?.queued === true && Number(appDelivery.accepted) > 0) {
      // A failed write deliberately leaves the claim in sending for review.
      const recorded = await pool.query(`UPDATE customer_change_notifications SET status='sent',sent_at=NOW(),updated_at=NOW(),last_error=NULL WHERE audit_event_id=$1 AND status='sending' RETURNING audit_event_id`, [auditEventId]);
      if (!recorded.rowCount) return { sent: false, reason: 'app_outcome_uncertain' };
      try {
        await pool.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES($1,'appointment',$2,$3::jsonb)`, [
          item.change_kind === 'cancellation' ? 'customer.cancellation_confirmation_sent' : 'customer.booking_update_confirmation_sent',
          String(appointment.id),
          JSON.stringify({ sourceAuditEventId: Number(auditEventId), changeKind: item.change_kind, channel: 'my_shiloh', notificationId: appDelivery.notificationId || null, idempotentDelivery: true }),
        ]);
      } catch (error) {
        logger.error({ err: error, auditEventId: Number(auditEventId) }, 'Booking change app delivery recorded but audit write failed');
      }
      return { sent: true, channel: 'my_shiloh', notificationId: appDelivery.notificationId || null };
    }
    // No accepted wake: preserve the normal approved-template fallback.
    const released = await pool.query(`UPDATE customer_change_notifications SET status='pending',last_error='app_wake_unaccepted',updated_at=NOW() WHERE audit_event_id=$1 AND status='sending' RETURNING audit_event_id`, [auditEventId]);
    if (!released.rowCount) return { sent: false, reason: 'app_outcome_uncertain' };
  } else {
    await queueBookingChangeMyShilohNotification(appDetails);
  }

  // An intentional transport pause is known before any provider request. Keep
  // the row pending so it can be reviewed or resumed, rather than claiming it
  // as a possibly accepted send that Reception must treat as uncertain.
  if (metaSignInOnly(env) || (UPDATE_KINDS.has(item.change_kind) && env.WHATSAPP_BOOKING_UPDATE_ENABLED !== 'true')) {
    const reason = metaSignInOnly(env) ? 'meta_signin_only' : 'booking_update_delivery_disabled';
    await pool.query(`UPDATE customer_change_notifications SET status='pending',last_error=$2,updated_at=NOW() WHERE audit_event_id=$1 AND status IN ('pending','failed')`, [auditEventId, reason]);
    return { sent: false, reason };
  }

  let templateStatus;
  try {
    templateStatus = await getTemplateStatus();
  } catch (error) {
    await pool.query(`UPDATE customer_change_notifications SET status='failed',attempt_count=attempt_count+1,last_error=$2,updated_at=NOW() WHERE audit_event_id=$1 AND status IN ('pending','failed')`, [auditEventId, String(error.message || error).slice(0, 1000)]);
    return { sent: false, reason: 'provider_status_error' };
  }

  const preferredTemplateKey = item.change_kind === 'cancellation' ? 'cancellation_confirmation_v2' : 'booking_update';
  const fallbackTemplateKey = item.change_kind === 'cancellation' ? 'cancellation_confirmation' : null;
  const preferredTemplateName = approvedTemplate(templateStatus, preferredTemplateKey);
  const fallbackTemplateName = fallbackTemplateKey ? approvedTemplate(templateStatus, fallbackTemplateKey) : null;
  const templateKey = preferredTemplateName ? preferredTemplateKey : fallbackTemplateName ? fallbackTemplateKey : preferredTemplateKey;
  const templateName = preferredTemplateName || fallbackTemplateName;
  if (!templateName) {
    await pool.query(`UPDATE customer_change_notifications SET status='pending',last_error=$2,updated_at=NOW() WHERE audit_event_id=$1 AND status IN ('pending','failed')`, [auditEventId, `${preferredTemplateKey}_not_approved`]);
    return { sent: false, reason: 'template_not_approved', templateKey: preferredTemplateKey };
  }

  if (await suppressEndedBookingUpdate(item)) {
    return { sent: false, reason: 'appointment_already_ended', suppressed: true };
  }
  if (!appointment.client_phone) {
    await pool.query(`UPDATE customer_change_notifications SET status='failed',attempt_count=attempt_count+1,last_error='client_phone_not_found',updated_at=NOW() WHERE audit_event_id=$1 AND status IN ('pending','failed')`, [auditEventId]);
    return { sent: false, reason: 'client_phone_not_found' };
  }

  const claimed = await pool.query(`
    UPDATE customer_change_notifications
       SET status='sending',attempt_count=attempt_count+1,last_error=NULL,updated_at=NOW()
     WHERE audit_event_id=$1 AND status IN ('pending','failed')
     RETURNING audit_event_id`, [auditEventId]);
  if (!claimed.rowCount) return { sent: false, reason: 'already_sending_or_sent' };

  const date = fmtDate(appointment.starts_at);
  const start = fmtTime(appointment.starts_at);
  const timeRange = `${start}–${fmtTime(appointment.ends_at)}`;
  let params;
  if (item.change_kind === 'cancellation') {
    params = [appointment.client_name || 'there', appointment.service_name, date, start, String(appointment.id)];
  } else {
    params = [appointment.client_name || 'there', appointment.service_name, appointment.staff_name, date, timeRange, priceLabel(appointment.total_price), String(appointment.id)];
  }

  let provider;
  try {
    provider = await sendWhatsAppTemplate(
      appointment.client_phone,
      templateName,
      params,
      process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'
    );
  } catch (error) {
    // A timeout or provider error can occur after acceptance. Never automatically
    // send this audit event again without a verified provider outcome.
    await pool.query(`UPDATE customer_change_notifications SET last_error='provider_outcome_uncertain',updated_at=NOW() WHERE audit_event_id=$1 AND status='sending'`, [auditEventId]);
    logger.error({ err: error, appointmentId: appointment.id, auditEventId: Number(auditEventId), changeKind: item.change_kind }, 'Customer booking-change delivery needs human review');
    return { sent: false, reason: 'provider_outcome_uncertain' };
  }

  // If the database cannot record acceptance, leave the claim in sending for
  // Reception review rather than retrying a possibly delivered message.
  await pool.query(`UPDATE customer_change_notifications SET status='sent',sent_at=NOW(),updated_at=NOW(),last_error=NULL WHERE audit_event_id=$1 AND status='sending'`, [auditEventId]);
  try {
    await pool.query(`
      INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
      VALUES($1,'appointment',$2,$3::jsonb)`, [
      item.change_kind === 'cancellation' ? 'customer.cancellation_confirmation_sent' : 'customer.booking_update_confirmation_sent',
      String(appointment.id),
      JSON.stringify({ sourceAuditEventId: Number(auditEventId), changeKind: item.change_kind, templateName, providerMessageId: provider?.messages?.[0]?.id || null, idempotentDelivery: true, nameAuthorityId: appointment.name_authority_id || null }),
    ]);
  } catch (error) {
    logger.error({ err: error, appointmentId: appointment.id, auditEventId: Number(auditEventId) }, 'Customer booking-change sent but audit record failed');
  }
  logger.info({ appointmentId: appointment.id, auditEventId: Number(auditEventId), changeKind: item.change_kind, templateName }, 'Customer booking-change confirmation sent');
  return { sent: true, templateName };
}

async function flushCustomerChangeNotifications({ env = process.env } = {}) {
  await ensureCustomerChangeNotificationTable();
  const result = await pool.query(`
    SELECT audit_event_id
      FROM customer_change_notifications
     WHERE status IN ('pending','failed')
       AND attempt_count < $1
       AND ($2::boolean OR change_kind='cancellation')
       AND updated_at <= NOW() - INTERVAL '5 minutes'
     ORDER BY created_at
     LIMIT 25`, [MAX_PRE_SEND_ATTEMPTS, bookingChangeRetryEnabled(env)]);
  for (const row of result.rows) await attemptCustomerChangeNotification(row.audit_event_id, { env });
  return { attempted: result.rowCount };
}

function startCustomerChangeNotificationScheduler() {
  if (scheduler) return;
  setImmediate(async () => {
    await ensureCustomerChangeNotificationTable();
    await flushCustomerChangeNotifications();
  });
  scheduler = setInterval(() => {
    flushCustomerChangeNotifications().catch((error) => logger.error({ err: error }, 'Customer-change notification retry scan failed'));
  }, RETRY_MS);
  scheduler.unref?.();
  logger.info({
    retryMinutes: RETRY_MS / 60000,
    bookingChangeRetryEnabled: bookingChangeRetryEnabled(),
    policyConfigured: ['true', 'false'].includes(process.env.SHILOH_BOOKING_CHANGE_RETRY_ENABLED),
    appOnlyEnabled: process.env.SHILOH_BOOKING_CHANGE_APP_ONLY_ENABLED === 'true',
  }, 'Customer-change notification scheduler started');
}

module.exports = {
  ACTION_BY_KIND,
  ACTION_ALIASES_BY_KIND,
  UPDATE_KINDS,
  bookingChangeRetryEnabled,
  ensureCustomerChangeNotificationTable,
  latestAuditEvent,
  loadAppointmentSnapshot,
  suppressEndedBookingUpdate,
  queueCustomerChangeNotification,
  attemptCustomerChangeNotification,
  flushCustomerChangeNotifications,
  startCustomerChangeNotificationScheduler,
};
