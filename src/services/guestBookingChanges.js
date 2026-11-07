'use strict';

const { pool } = require('../db/pool');
const { GUEST_BOOKINGS_ENABLED } = require('./groupGuestFeature');
const { groupGuestStorageReady } = require('./groupGuestStorageReadiness');
const { isOrganiserContactGuest } = require('./crmV2GuestProfile');
const { guestBookingChangeAudit } = require('./guestBookingChangeAudit');
const { resolveGuestBookingNotice } = require('./guestBookingNoticeRouting');
const { createMyShilohPushService, defaultPushService } = require('./myShilohPush');

const handled = outcome => ({ handled: true, outcome });
function createGuestBookingChangeService({ db = pool, now = () => new Date(),
  wake = id => defaultPushService.wakeClient(id) } = {}) {
  async function releaseClaim(claim, reason) {
    await db.query(`UPDATE customer_change_notifications SET status='pending',last_error=$3,updated_at=NOW()
      WHERE audit_event_id=$1 AND status='sending' AND updated_at=$2::timestamptz`, [claim.id, claim.at, reason]);
  }
  async function attempt(auditEventId) {
    if (!['string', 'number'].includes(typeof auditEventId) || !/^[1-9][0-9]*$/.test(String(auditEventId))
      || !Number.isSafeInteger(Number(auditEventId))) return handled({ sent: false, reason: 'invalid_audit' });
    const tx = await db.connect(), clock = new Date(now());
    let claim = null, prepared = null, released = false;
    try {
      await tx.query('BEGIN');
      const item = (await tx.query('SELECT * FROM customer_change_notifications WHERE audit_event_id=$1 FOR UPDATE', [auditEventId])).rows[0];
      if (!item) { await tx.query('COMMIT'); return handled({ sent: false, reason: 'not_queued' }); }
      if (!['pending', 'failed'].includes(item.status)) {
        await tx.query('COMMIT');
        return handled({ sent: false, reason: item.status === 'sending' ? 'provider_outcome_uncertain' : `already_${item.status}` });
      }
      const appointment = (await tx.query('SELECT id,client_id,crm_v2_client_id,status,starts_at FROM appointments WHERE id=$1 FOR UPDATE', [item.appointment_id])).rows[0];
      if (!appointment?.crm_v2_client_id || appointment.client_id != null) { await tx.query('COMMIT'); return { handled: false }; }
      const client = (await tx.query(`SELECT id,status,normalized_mobile,profile_status,mobile_verified_at,
        to_jsonb(c)->>'contact_mode' AS contact_mode FROM crm_v2_clients c WHERE id=$1 FOR UPDATE`, [appointment.crm_v2_client_id])).rows[0];
      if (client?.normalized_mobile) { await tx.query('COMMIT'); return { handled: false }; }
      async function fail(reason, suppressed = false) {
        await tx.query(`UPDATE customer_change_notifications SET status=$2,last_error=$3,attempt_count=attempt_count+1,
          suppression_reason=CASE WHEN $2='suppressed' THEN $3 ELSE NULL END,
          suppressed_at=CASE WHEN $2='suppressed' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE audit_event_id=$1`,
        [auditEventId, suppressed ? 'suppressed' : 'failed', reason]);
        await tx.query('COMMIT');
        return handled({ sent: false, reason, ...(suppressed ? { suppressed: true } : {}) });
      }
      if (!client || client.status !== 'active' || !isOrganiserContactGuest(client)) return await fail('guest_contact_unavailable');
      const purpose = item.change_kind === 'cancellation' ? 'booking_cancelled' : 'booking_changed';
      const source = await guestBookingChangeAudit(tx, { auditEventId, appointmentId: appointment.id, purpose });
      if (!source || source.kind !== item.change_kind) return await fail('guest_change_audit_mismatch');
      if ((purpose === 'booking_changed' && !['scheduled', 'confirmed'].includes(appointment.status))
        || (purpose === 'booking_cancelled' && appointment.status !== 'cancelled')
        || new Date(appointment.starts_at) <= clock) return await fail('guest_booking_no_longer_current', true);
      await tx.query(`SELECT g.id FROM appointment_group_members gm
        JOIN appointment_groups g ON g.id=gm.group_id
        JOIN appointment_group_booking_contacts bc ON bc.appointment_group_id=g.id
        JOIN crm_v2_clients organiser ON organiser.id=bc.organiser_crm_v2_client_id
        WHERE gm.appointment_id=$1 FOR UPDATE OF g,bc,organiser`, [appointment.id]);
      const route = await resolveGuestBookingNotice(tx, { appointmentId: appointment.id, purpose, auditEventId, now: clock });
      if (route.state !== 'ready') return await fail('guest_booking_recipient_unavailable');
      const notice = route.notification;
      const result = await createMyShilohPushService({ db: tx, now: () => clock }).queueNotification({
        ...notice, retryExisting: true, deferWake: true,
      });
      if (!result.queued || !result.deferred) throw new Error('Guest booking-change obligation unavailable');
      await tx.query(`UPDATE my_shiloh_push_notifications n SET expires_at=LEAST(n.expires_at,a.starts_at)
        FROM appointments a WHERE n.id=$1 AND a.id=$2 AND n.crm_v2_client_id=$3 AND n.event_key=$4`,
      [result.notificationId, appointment.id, notice.crmV2ClientId, notice.eventKey]);
      await tx.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
        SELECT 'booking.guest_change_queued','appointment',$1,$2::jsonb WHERE NOT EXISTS(
          SELECT 1 FROM crm_audit_events WHERE action='booking.guest_change_queued' AND entity_type='appointment'
            AND entity_id=$1 AND metadata->>'eventKey'=$3)`, [appointment.id, JSON.stringify({
        eventKey: notice.eventKey, notificationId: result.notificationId, sourceAuditEventId: Number(auditEventId),
        purpose, changeKind: source.kind, organiserClientId: notice.crmV2ClientId, channel: 'my_shiloh', deferred: true,
      }), notice.eventKey]);
      const claimed = await tx.query(`UPDATE customer_change_notifications SET status='sending',last_error=NULL,updated_at=clock_timestamp()
        WHERE audit_event_id=$1 RETURNING updated_at::text AS claim_revision`, [auditEventId]);
      claim = { id: auditEventId, at: claimed.rows[0].claim_revision };
      prepared = { appointmentId: appointment.id, purpose, changeKind: source.kind, notice, notificationId: result.notificationId };
      await tx.query('COMMIT');
    } catch (error) {
      try { await tx.query('ROLLBACK'); } catch (_) {}
      tx.release(error); released = true;
      // No wake has been attempted. A lost COMMIT response can safely release
      // only this exact claim and retry the same audited outbox event.
      if (claim) { try { await releaseClaim(claim, 'guest_commit_unverified'); } catch (_) {} }
      throw error;
    } finally { if (!released) tx.release(); }

    const current = await resolveGuestBookingNotice(db, { appointmentId: prepared.appointmentId,
      purpose: prepared.purpose, auditEventId, now: now() });
    if (current.state !== 'ready' || current.notification.eventKey !== prepared.notice.eventKey) {
      await releaseClaim(claim, 'guest_context_changed');
      return handled({ sent: false, reason: 'guest_context_changed' });
    }
    let delivery;
    try { delivery = await wake(prepared.notice.crmV2ClientId); } catch (_error) { delivery = { accepted: 0 }; }
    if (!(Number(delivery?.accepted) > 0)) {
      await releaseClaim(claim, 'app_wake_unaccepted');
      return handled({ sent: false, reason: 'app_wake_unaccepted', notificationId: prepared.notificationId });
    }
    let evidence;
    try { evidence = await db.connect(); }
    catch (_error) { return handled({ sent: false, reason: 'app_outcome_uncertain', notificationId: prepared.notificationId }); }
    let evidenceReleased = false;
    try {
      await evidence.query('BEGIN');
      const saved = await evidence.query(`UPDATE customer_change_notifications SET status='sent',sent_at=NOW(),last_error=NULL,updated_at=NOW()
        WHERE audit_event_id=$1 AND status='sending' AND updated_at=$2::timestamptz RETURNING audit_event_id`, [auditEventId, claim.at]);
      if (!saved.rows.length) throw new Error('Guest booking-change acceptance could not be recorded');
      await evidence.query(`INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata) VALUES($1,'appointment',$2,$3::jsonb)`, [
        prepared.purpose === 'booking_cancelled' ? 'customer.cancellation_confirmation_sent' : 'customer.booking_update_confirmation_sent',
        prepared.appointmentId, JSON.stringify({ sourceAuditEventId: Number(auditEventId), changeKind: prepared.changeKind,
          channel: 'my_shiloh', notificationId: prepared.notificationId, recipientRole: 'organiser',
          organiserClientId: prepared.notice.crmV2ClientId, idempotentDelivery: true }),
      ]);
      await evidence.query('COMMIT');
      return handled({ sent: true, channel: 'my_shiloh', recipientRole: 'organiser', notificationId: prepared.notificationId });
    } catch (error) {
      try { await evidence.query('ROLLBACK'); } catch (_) {}
      evidence.release(error); evidenceReleased = true;
      return handled({ sent: false, reason: 'app_outcome_uncertain', notificationId: prepared.notificationId });
    } finally { if (!evidenceReleased) evidence.release(); }
  }
  return { attempt };
}

async function attemptGuestBookingChange(auditEventId, { enabled = GUEST_BOOKINGS_ENABLED, db = pool, ...options } = {}) {
  if (!enabled || !(await groupGuestStorageReady(db))) return { handled: false };
  return createGuestBookingChangeService({ db, ...options }).attempt(auditEventId);
}

module.exports = { createGuestBookingChangeService, attemptGuestBookingChange };
