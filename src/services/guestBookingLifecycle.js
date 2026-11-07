'use strict';

const { resolveGuestBookingNotice } = require('./guestBookingNoticeRouting');

function positiveId(value) {
  return ['string', 'number'].includes(typeof value)
    && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
}

function unavailable() {
  const error = new Error('The guest booking contact changed. Review the booking again.');
  error.code = 'GROUP_GUEST_LIFECYCLE_CHANGED';
  error.httpStatus = 409;
  return error;
}

// Internal only: the authorized group creator owns the transaction, schema gate,
// contact review and eventual outbox obligation. This never commits or sends.
async function enrolGuestLifecycle(db, { appointmentId, groupId, contactRevision, now = new Date() } = {}) {
  if (![appointmentId, groupId, contactRevision].every(positiveId)) throw unavailable();
  const locked = await db.query(`
    SELECT a.id,a.crm_v2_client_id,a.starts_at,a.ends_at,c.name,
           bc.revision AS contact_revision
      FROM appointments a
      JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
      JOIN appointment_group_members gm ON gm.appointment_id=a.id
      JOIN appointment_groups g ON g.id=gm.group_id
      JOIN appointment_group_booking_contacts bc ON bc.appointment_group_id=g.id
      JOIN crm_v2_clients organiser ON organiser.id=bc.organiser_crm_v2_client_id
     WHERE a.id=$1 AND g.id=$2
     FOR UPDATE OF a,c,g,bc,organiser`, [Number(appointmentId), Number(groupId)]);
  const row = locked.rows[0];
  if (locked.rows.length !== 1 || Number(row.contact_revision) !== Number(contactRevision)) throw unavailable();
  const route = await resolveGuestBookingNotice(db, { appointmentId, purpose: 'booking_confirmation', now });
  const startsAt = new Date(row.starts_at), endsAt = new Date(row.ends_at);
  if (route.state !== 'ready' || !row.starts_at || !row.ends_at || !Number.isFinite(startsAt.getTime())
    || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw unavailable();

  const inserted = await db.query(`
    INSERT INTO appointment_lifecycle
      (appointment_id,client_id,crm_v2_client_id,client_name_snapshot,phone,
       service_text,appointment_at,appointment_ends_at,source,delivery_recipient_role,organiser_group_id)
    SELECT $1,NULL,$2,$3,NULL,'Group appointment',a.starts_at,a.ends_at,'shiloh_calendar_group','organiser',$4
      FROM appointments a WHERE a.id=$1
    ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO NOTHING
    RETURNING id`, [Number(appointmentId), row.crm_v2_client_id, row.name,
    Number(groupId)]);
  if (inserted.rows.length) return { enrolled: true, duplicate: false, lifecycleId: Number(inserted.rows[0].id) };

  // An exact retry must not overwrite a changed recipient, reschedule a visit,
  // reset a reminder claim or convert an existing direct-contact lifecycle.
  const existing = (await db.query(`SELECT al.*,(al.appointment_at=a.starts_at AND al.appointment_ends_at=a.ends_at) AS canonical_time_matches
    FROM appointment_lifecycle al JOIN appointments a ON a.id=al.appointment_id
    WHERE al.appointment_id=$1 FOR UPDATE OF al`, [Number(appointmentId)])).rows[0];
  if (!existing || existing.delivery_recipient_role !== 'organiser' || existing.phone != null
    || existing.client_id != null || Number(existing.crm_v2_client_id) !== Number(row.crm_v2_client_id)
    || Number(existing.organiser_group_id) !== Number(groupId)
    || existing.client_name_snapshot !== row.name || existing.source !== 'shiloh_calendar_group'
    || !['confirmed', 'confirmed_by_client'].includes(existing.status)
    || existing.canonical_time_matches !== true) throw unavailable();
  return { enrolled: true, duplicate: true, lifecycleId: Number(existing.id) };
}

module.exports = { enrolGuestLifecycle };
