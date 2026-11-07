'use strict';

const { createGroupBookingOrganiserService } = require('./groupBookingOrganiser');
const { resolveGuestBookingNotice } = require('./guestBookingNoticeRouting');
const { enrolGuestLifecycle } = require('./guestBookingLifecycle');
const { createMyShilohPushService } = require('./myShilohPush');

function failed() {
  return Object.assign(new Error('The group confirmation could not be secured. Nothing was created.'), {
    code: 'GROUP_ORGANISER_CONFIRMATION_FAILED', httpStatus: 409,
  });
}

// Internal, transaction-owned obligation. Ordinary participants retain their
// existing confirmation path. Nothing here commits, wakes a phone or sends.
function createGuestGroupConfirmationService({ organiser = createGroupBookingOrganiserService() } = {}) {
  async function queue(db, { groupId, adminId, reviewedOrganiser, now = new Date() } = {}) {
    await organiser.bind(db, { groupId, adminId, reviewedOrganiser });
    const contact = (await db.query(`SELECT revision FROM appointment_group_booking_contacts
      WHERE appointment_group_id=$1 FOR UPDATE`, [groupId])).rows[0];
    if (!contact) throw failed();
    const members = (await db.query(`SELECT a.id,gm.guest_position
      FROM appointment_group_members gm JOIN appointments a ON a.id=gm.appointment_id
      WHERE gm.group_id=$1 ORDER BY gm.guest_position,a.id FOR UPDATE OF a,gm`, [groupId])).rows;
    if (members.length < 3 || members.length > 10
      || new Set(members.map(r => String(r.id))).size !== members.length) throw failed();
    let notice = null;
    const guestIds = [];
    for (const member of members) {
      const route = await resolveGuestBookingNotice(db, { appointmentId: member.id, purpose: 'booking_confirmation', now });
      if (route.state === 'direct_client_required') continue;
      if (route.state !== 'ready') throw failed();
      if (notice && (notice.eventKey !== route.notification.eventKey
        || notice.crmV2ClientId !== route.notification.crmV2ClientId)) throw failed();
      notice = route.notification;
      await enrolGuestLifecycle(db, { appointmentId: member.id, groupId, contactRevision: contact.revision, now });
      guestIds.push(Number(member.id));
    }
    if (!notice || !guestIds.length) throw failed();
    const push = createMyShilohPushService({ db, now: () => now });
    const result = await push.queueNotification({ ...notice, retryExisting: true, deferWake: true });
    if (!result.queued || !result.deferred || !Number.isSafeInteger(result.notificationId)) throw failed();
    await db.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      SELECT $1,'booking.group_organiser_confirmation_queued','appointment_group',$2,$3::jsonb
      WHERE NOT EXISTS(SELECT 1 FROM crm_audit_events
        WHERE action='booking.group_organiser_confirmation_queued' AND entity_type='appointment_group'
          AND entity_id=$2 AND metadata->>'eventKey'=$4)`, [adminId, groupId, JSON.stringify({
      eventKey: notice.eventKey, notificationId: result.notificationId,
      organiserClientId: notice.crmV2ClientId, contactRevision: String(contact.revision),
      guestAppointmentIds: guestIds, channel: 'my_shiloh', deferred: true,
    }), notice.eventKey]);
    return { queued: true, duplicate: Boolean(result.duplicate), notificationId: result.notificationId,
      organiserClientId: notice.crmV2ClientId, guestAppointmentIds: guestIds };
  }
  return { queue };
}

module.exports = { createGuestGroupConfirmationService };
