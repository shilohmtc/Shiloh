'use strict';

const { pool } = require('../db/pool');
const { groupGuestStorageReady } = require('./groupGuestStorageReadiness');
const { GUEST_BOOKINGS_ENABLED } = require('./groupGuestFeature');
const { resolveGuestBookingNotice } = require('./guestBookingNoticeRouting');
const { createMyShilohPushService, defaultPushService } = require('./myShilohPush');

function createGuestBookingReminderService({ db = pool, now = () => new Date(),
  wake = id => defaultPushService.wakeClient(id), reminderHours = 24 } = {}) {
  if (!Number.isFinite(Number(reminderHours)) || Number(reminderHours) <= 0) throw new Error('Valid reminder hours are required');
  async function releaseClaim(claim) {
    if (!claim) return;
    await db.query(`UPDATE appointment_lifecycle SET reminder_sent_at=NULL,updated_at=NOW()
      WHERE id=$1 AND reminder_sent_at=$2::timestamptz AND delivery_recipient_role='organiser'`, [claim.id, claim.at]);
  }
  async function queueNext({ excludeIds = [] } = {}) {
    const tx = await db.connect();
    const clock = new Date(now());
    if (!Number.isFinite(clock.getTime())) { tx.release(); throw new Error('Valid reminder clock is required'); }
    let claim = null, outcome, released = false;
    try {
      await tx.query('BEGIN');
      const row = (await tx.query(`SELECT al.id,a.id AS appointment_id,a.starts_at,a.ends_at,
          c.id AS crm_v2_client_id,c.normalized_mobile,c.name
        FROM appointment_lifecycle al
        JOIN appointments a ON a.id=al.appointment_id AND a.crm_v2_client_id=al.crm_v2_client_id AND a.client_id IS NULL
        JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
        JOIN appointment_group_members gm ON gm.appointment_id=a.id AND gm.group_id=al.organiser_group_id
        JOIN appointment_groups g ON g.id=gm.group_id
        JOIN appointment_group_booking_contacts bc ON bc.appointment_group_id=g.id
        JOIN crm_v2_clients organiser ON organiser.id=bc.organiser_crm_v2_client_id
        WHERE al.delivery_recipient_role='organiser' AND al.phone IS NULL AND al.client_id IS NULL
          AND al.status IN ('confirmed','confirmed_by_client')
          AND (al.reminder_sent_at IS NULL OR al.appointment_at IS DISTINCT FROM a.starts_at)
          AND a.status IN ('scheduled','confirmed') AND g.status IN ('scheduled','confirmed')
          AND a.starts_at>$1::timestamptz AND a.starts_at<=$1::timestamptz+($2*INTERVAL '1 hour')
          AND c.status='active' AND NOT(al.id=ANY($3::bigint[]))
          AND (c.normalized_mobile IS NOT NULL OR EXISTS(SELECT 1 FROM my_shiloh_push_subscriptions s
            WHERE s.crm_v2_client_id=organiser.id AND s.enabled=TRUE AND s.revoked_at IS NULL))
        ORDER BY a.starts_at,al.id FOR UPDATE OF al,a,c,g,bc,organiser SKIP LOCKED LIMIT 1`,
      [clock.toISOString(), Number(reminderHours), excludeIds])).rows[0];
      if (!row) { await tx.query('COMMIT'); return { state: 'idle' }; }
      const route = await resolveGuestBookingNotice(tx, { appointmentId: row.appointment_id, purpose: 'appointment_reminder', now: clock });
      if (route.state === 'direct_client_required') {
        await tx.query(`UPDATE appointment_lifecycle al SET phone=$2,delivery_recipient_role='client',organiser_group_id=NULL,
          client_name_snapshot=$3,appointment_at=a.starts_at,appointment_ends_at=a.ends_at,reminder_sent_at=NULL,updated_at=NOW()
          FROM appointments a WHERE al.id=$1 AND a.id=al.appointment_id`, [row.id, row.normalized_mobile, row.name]);
        await tx.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
          VALUES('booking.guest_delivery_became_direct','appointment',$1,$2::jsonb)`, [row.appointment_id,
          JSON.stringify({ lifecycleId: Number(row.id), crmV2ClientId: Number(row.crm_v2_client_id) })]);
        await tx.query('COMMIT');
        return { state: 'direct_pending', lifecycleId: Number(row.id) };
      }
      if (route.state !== 'ready') { await tx.query('COMMIT'); return { state: 'review_required', lifecycleId: Number(row.id) }; }
      const notice = route.notification;
      const result = await createMyShilohPushService({ db: tx, now: () => clock }).queueNotification({
        ...notice, retryExisting: true, deferWake: true,
      });
      if (!result.queued || !result.deferred) throw new Error('Guest reminder obligation unavailable');
      await tx.query(`UPDATE my_shiloh_push_notifications n SET expires_at=LEAST(n.expires_at,a.starts_at)
        FROM appointments a WHERE n.id=$1 AND a.id=$2 AND n.crm_v2_client_id=$3 AND n.event_key=$4`,
      [result.notificationId, row.appointment_id, notice.crmV2ClientId, notice.eventKey]);
      await tx.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
        SELECT 'booking.guest_reminder_queued','appointment',$1,$2::jsonb WHERE NOT EXISTS(
          SELECT 1 FROM crm_audit_events WHERE action='booking.guest_reminder_queued'
            AND entity_type='appointment' AND entity_id=$1 AND metadata->>'eventKey'=$3)`, [row.appointment_id,
        JSON.stringify({ eventKey: notice.eventKey, notificationId: result.notificationId,
          organiserClientId: notice.crmV2ClientId, channel: 'my_shiloh', deferred: true }), notice.eventKey]);
      await tx.query(`UPDATE appointment_lifecycle al SET reminder_sent_at=$2::timestamptz,
        appointment_at=a.starts_at,appointment_ends_at=a.ends_at,updated_at=NOW()
        FROM appointments a WHERE al.id=$1 AND a.id=al.appointment_id`, [row.id, clock.toISOString()]);
      claim = { id: row.id, at: clock.toISOString() };
      outcome = { state: 'queued', lifecycleId: Number(row.id), appointmentId: Number(row.appointment_id), notice, notificationId: result.notificationId };
      await tx.query('COMMIT');
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch (_) {}
      tx.release(error);
      released = true;
      // Even a lost COMMIT response must leave a durable obligation retryable;
      // never send before its outcome is known or create another event key.
      try { await releaseClaim(claim); } catch (_) {}
      throw error;
    } finally { if (!released) tx.release(); }

    const current = await resolveGuestBookingNotice(db, { appointmentId: outcome.appointmentId, purpose: 'appointment_reminder', now: now() });
    if (current.state !== 'ready' || current.notification.eventKey !== outcome.notice.eventKey) {
      await releaseClaim(claim);
      return { state: 'context_changed', lifecycleId: outcome.lifecycleId };
    }
    let delivery;
    try { delivery = await wake(outcome.notice.crmV2ClientId); }
    catch (_error) { delivery = { accepted: 0 }; }
    if (!(Number(delivery?.accepted) > 0)) {
      await releaseClaim(claim);
      return { state: 'retry_pending', lifecycleId: outcome.lifecycleId, notificationId: outcome.notificationId };
    }
    return { state: 'wake_accepted', lifecycleId: outcome.lifecycleId, notificationId: outcome.notificationId };
  }
  return { queueNext };
}

async function processGuestReminders({ enabled = GUEST_BOOKINGS_ENABLED, db = pool,
  reminderHours = 24, now, wake } = {}) {
  if (!enabled || !(await groupGuestStorageReady(db))) return { enabled: false, results: [] };
  const worker = createGuestBookingReminderService({ db, reminderHours, ...(now ? { now } : {}), ...(wake ? { wake } : {}) });
  const results = [], excludeIds = [];
  for (let i = 0; i < 20; i += 1) {
    const result = await worker.queueNext({ excludeIds });
    if (result.state === 'idle') break;
    results.push(result);
    excludeIds.push(result.lifecycleId);
  }
  return { enabled: true, results };
}

module.exports = { createGuestBookingReminderService, processGuestReminders };
