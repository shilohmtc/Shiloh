'use strict';

const { resolveGuestBookingNotice } = require('./guestBookingNoticeRouting');

// A booking notice is not a grant of access to a guest's profile. Revalidate
// recipient and booking context when the organiser actually reads the outbox.
async function guestBookingNoticeVisible(db, row, { recipientClientId, now = new Date() } = {}) {
  const key = String(row.event_key || '');
  if (!key.startsWith('guest-booking:')) return true;
  const purpose = /^guest-booking:(booking_confirmation|appointment_reminder|booking_changed|booking_cancelled):[a-f0-9]{64}$/.exec(key)?.[1];
  if (!purpose) return false;
  try {
    // Ordinary notification history keeps its established expiry-independent
    // query. Only the new guest context needs this bounded eligibility read.
    const expiresAt = row.expires_at || (await db.query(`SELECT expires_at FROM my_shiloh_push_notifications
      WHERE id=$1 AND crm_v2_client_id=$2 AND event_key=$3`, [row.id, recipientClientId, key])).rows[0]?.expires_at;
    const expiry = new Date(expiresAt), clock = new Date(now);
    if (!expiresAt || !Number.isFinite(expiry.getTime()) || !Number.isFinite(clock.getTime()) || expiry <= clock) return false;
    const audits = (await db.query(`SELECT entity_type,entity_id,metadata FROM crm_audit_events
      WHERE action=$1 AND metadata->>'eventKey'=$2 AND metadata->>'notificationId'=$3 LIMIT 2`, [
      purpose === 'booking_confirmation' ? 'booking.group_organiser_confirmation_queued'
        : purpose === 'appointment_reminder' ? 'booking.guest_reminder_queued' : 'booking.guest_change_queued',
      key, String(row.id),
    ])).rows;
    if (audits.length !== 1) return false;
    const audit = audits[0];
    let appointmentIds;
    if (purpose === 'booking_confirmation') {
      if (audit.entity_type !== 'appointment_group') return false;
      appointmentIds = (await db.query(`SELECT appointment_id FROM appointment_group_members
        WHERE group_id=$1 ORDER BY guest_position`, [audit.entity_id])).rows.map(r => r.appointment_id);
      if (appointmentIds.length < 3 || appointmentIds.length > 10) return false;
    } else {
      if (audit.entity_type !== 'appointment') return false;
      appointmentIds = [audit.entity_id];
    }
    let matched = false;
    for (const appointmentId of appointmentIds) {
      if (['booking_changed', 'booking_cancelled'].includes(purpose)
        && (audit.metadata.purpose !== purpose || !audit.metadata.sourceAuditEventId)) return false;
      const route = await resolveGuestBookingNotice(db, { appointmentId, purpose, now,
        ...(['booking_changed', 'booking_cancelled'].includes(purpose) ? { auditEventId: audit.metadata.sourceAuditEventId } : {}),
      });
      if (purpose === 'booking_confirmation' && route.state === 'direct_client_required') continue;
      const notice = route.notification;
      if (route.state !== 'ready' || notice.crmV2ClientId !== Number(recipientClientId)
        || notice.eventKey !== key || notice.category !== row.category || notice.title !== row.title
        || notice.body !== row.body || notice.targetPath !== row.target_path) return false;
      matched = true;
    }
    return matched;
  } catch (_error) { return false; }
}

module.exports = { guestBookingNoticeVisible };
