const test = require('node:test');
const assert = require('node:assert/strict');
const { lifecycleDb } = require('./fixtures/guest-booking-lifecycle-db');
const { enrolGuestLifecycle: enrol } = require('../src/services/guestBookingLifecycle');
const { resolveGuestBookingNotice } = require('../src/services/guestBookingNoticeRouting');
const { createMyShilohPushService } = require('../src/services/myShilohPush');
const now = new Date('2026-11-06T00:00:00Z');
const input = { appointmentId: 1, groupId: 10, contactRevision: 1, now };


test('separate guest enrolments and one deferred organiser confirmation share the caller transaction and exact retries', async t => {
  const db = await lifecycleDb(t);
  const push = createMyShilohPushService({ db, env: {}, now: () => now });
  await db.exec('BEGIN');
  const first = await enrol(db, input);
  const route = await resolveGuestBookingNotice(db, { appointmentId: 1, purpose: 'booking_confirmation', now });
  const notice = await push.queueNotification({ ...route.notification, deferWake: true, retryExisting: true });
  assert.equal(notice.queued, true);
  assert.equal(notice.deferred, true);
  assert.equal((await enrol(db, { ...input, appointmentId: 3 })).duplicate, false);
  await db.exec('COMMIT');
  assert.deepEqual(await enrol(db, input), { enrolled: true, duplicate: true, lifecycleId: first.lifecycleId });
  const other = await resolveGuestBookingNotice(db, { appointmentId: 3, purpose: 'booking_confirmation', now });
  const retry = await push.queueNotification({ ...other.notification, deferWake: true, retryExisting: true });
  assert.equal(retry.notificationId, notice.notificationId);
  assert.equal(retry.duplicate, true);
  const rows = (await db.query('SELECT * FROM appointment_lifecycle ORDER BY appointment_id')).rows;
  assert.deepEqual(rows.map(r => Number(r.crm_v2_client_id)), [101, 103]);
  assert.ok(rows.every(r => r.phone === null && r.client_id === null && Number(r.organiser_group_id) === 10));
  assert.ok(rows.every(r => r.service_text === 'Group appointment' && r.delivery_recipient_role === 'organiser'));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 1);
  assert.equal((await db.query('SELECT normalized_mobile FROM crm_v2_clients WHERE id=101')).rows[0].normalized_mobile, null);
});

test('direct guest identities, changed contacts, invalid dates and malformed IDs never enrol through the organiser', async t => {
  const db = await lifecycleDb(t);
  const changed = { code: 'GROUP_GUEST_LIFECYCLE_CHANGED' };
  for (const patch of [{ appointmentId: 2 }, { contactRevision: 2 }, { groupId: 11 }, { appointmentId: '1junk' }]) {
    await assert.rejects(enrol(db, { ...input, ...patch }), changed);
  }
  await db.exec("UPDATE crm_v2_clients SET status='archived' WHERE id=201");
  await assert.rejects(enrol(db, input), changed);
  await db.exec("UPDATE crm_v2_clients SET status='active' WHERE id=201;UPDATE appointments SET ends_at=starts_at WHERE id=1");
  await assert.rejects(enrol(db, input), changed);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 0);
});

test('enrolment preserves native timestamp precision and rejects a submillisecond reschedule during replay', async t => {
  const db = await lifecycleDb(t);
  await db.exec("UPDATE appointments SET starts_at='2030-01-01T08:00:00.000123Z',ends_at='2030-01-01T09:00:00.000123Z' WHERE id=1");
  await enrol(db, input);
  assert.equal((await db.query(`SELECT al.appointment_at=a.starts_at AND al.appointment_ends_at=a.ends_at AS exact
    FROM appointment_lifecycle al JOIN appointments a ON a.id=al.appointment_id WHERE a.id=1`)).rows[0].exact, true);
  assert.equal((await enrol(db, input)).duplicate, true);
  await db.exec("UPDATE appointments SET starts_at=starts_at+INTERVAL '0.000001 seconds',ends_at=ends_at+INTERVAL '0.000001 seconds' WHERE id=1");
  await assert.rejects(enrol(db, input), { code: 'GROUP_GUEST_LIFECYCLE_CHANGED' });
});

test('retries preserve reminder claims and reject reschedules or existing direct lifecycle rows without rewriting them', async t => {
  const db = await lifecycleDb(t);
  await enrol(db, input);
  await db.exec("UPDATE appointment_lifecycle SET reminder_sent_at='2026-11-06T00:00Z'");
  assert.equal((await enrol(db, input)).duplicate, true);
  assert.equal(new Date((await db.query('SELECT reminder_sent_at FROM appointment_lifecycle')).rows[0].reminder_sent_at).toISOString(), now.toISOString());
  await db.exec("UPDATE appointments SET starts_at=starts_at+INTERVAL '1 minute',ends_at=ends_at+INTERVAL '1 minute' WHERE id=1");
  await assert.rejects(enrol(db, input), { code: 'GROUP_GUEST_LIFECYCLE_CHANGED' });
  await db.exec("UPDATE appointments SET starts_at=starts_at-INTERVAL '1 minute',ends_at=ends_at-INTERVAL '1 minute' WHERE id=1;UPDATE appointment_lifecycle SET delivery_recipient_role='client',phone='27810000999',organiser_group_id=NULL");
  await assert.rejects(enrol(db, input), { code: 'GROUP_GUEST_LIFECYCLE_CHANGED' });
  const row = (await db.query('SELECT * FROM appointment_lifecycle')).rows[0];
  assert.equal(row.phone, '27810000999');
  assert.equal(row.delivery_recipient_role, 'client');
});

test('a failed confirmation obligation rolls lifecycle enrolment back with the caller, without losing source appointments', async t => {
  const db = await lifecycleDb(t);
  const push = createMyShilohPushService({ db, env: {}, now: () => now });
  await db.exec("ALTER TABLE my_shiloh_push_notifications ADD CONSTRAINT reject_synthetic_notice CHECK (title <> 'Group booking confirmed');BEGIN");
  await enrol(db, input);
  const route = await resolveGuestBookingNotice(db, { appointmentId: 1, purpose: 'booking_confirmation', now });
  await assert.rejects(push.queueNotification({ ...route.notification, deferWake: true }));
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 3);
});
