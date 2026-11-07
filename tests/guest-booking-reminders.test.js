const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuestFixture } = require('./helpers/calendarGuestBookingFixture');
const { createGuestBookingReminderService, processGuestReminders } = require('../src/services/guestBookingReminders');
const { createMyShilohPushService } = require('../src/services/myShilohPush');
const { claimDueReminder } = require('../src/services/appointmentLifecycle');
const clock = new Date('2099-10-23T07:00:00Z');
const endpoint = 'https://push.example.test/synthetic-guest';
async function subscribe(f, clientId = 201) {
  await f.db.query("INSERT INTO my_shiloh_push_subscriptions(crm_v2_client_id,endpoint,p256dh,auth) VALUES($1,$2,'synthetic-key','synthetic-auth')", [clientId, endpoint]);
}

test('the scheduler performs no database work while disabled and refuses partial storage', async () => {
  let reads = 0;
  const db = { query: async () => { reads++; return { rows: [{ ready: false }] }; } };
  assert.deepEqual(await processGuestReminders({ enabled: false, db }), { enabled: false, results: [] });
  assert.equal(reads, 0);
  assert.deepEqual(await processGuestReminders({ enabled: true, db }), { enabled: false, results: [] });
  assert.equal(reads, 1);
  assert.deepEqual(await processGuestReminders({ db }), { enabled: false, results: [] });
  assert.equal(reads, 2, 'the enabled release still checks storage readiness');
});

test('PostgreSQL microseconds do not create false reschedules; a genuine submillisecond change gets its own current event', async t => {
  const f = await createGuestFixture(t); await subscribe(f);
  const appointmentId = f.created.appointmentIds[0], clock = new Date('2030-01-01T00:00:00Z');
  await f.db.query(`UPDATE appointments SET starts_at='2030-01-01T01:00:00.000123Z',
    ends_at='2030-01-01T02:00:00.000123Z',updated_at='2030-01-01T00:00:00.000123Z' WHERE id=$1`, [appointmentId]);
  await f.db.query("UPDATE appointment_groups SET starts_at='2030-01-01T01:00:00.000123Z'");
  let wakes = 0;
  const worker = createGuestBookingReminderService({ db: f.db, now: () => clock, wake: async () => { wakes++; return { accepted: 1 }; } });
  const first = await worker.queueNext();
  assert.equal(first.state, 'wake_accepted');
  assert.equal((await worker.queueNext()).state, 'idle');
  assert.equal(wakes, 1);
  assert.equal((await f.db.query(`SELECT al.appointment_at=a.starts_at AS exact FROM appointment_lifecycle al
    JOIN appointments a ON a.id=al.appointment_id WHERE a.id=$1`, [appointmentId])).rows[0].exact, true);
  await f.db.query("UPDATE appointments SET starts_at=starts_at+INTERVAL '0.000001 seconds',ends_at=ends_at+INTERVAL '0.000001 seconds',updated_at=updated_at+INTERVAL '0.000001 seconds' WHERE id=$1", [appointmentId]);
  const changed = await worker.queueNext();
  assert.equal(changed.state, 'wake_accepted');
  assert.notEqual(changed.notificationId, first.notificationId);
  assert.equal(wakes, 2);
  assert.equal((await worker.queueNext()).state, 'idle');
});

test('organiser reminders persist before wake, expire at the appointment and are hidden after rescheduling, with cursor progress', async t => {
  const f = await createGuestFixture(t);
  await subscribe(f);
  let transaction = false, wakes = 0;
  const db = { ...f.db, connect: async () => {
    const tx = await f.db.connect();
    return { release: (...args) => tx.release(...args), query: async (sql, args) => {
      const result = await tx.query(sql, args);
      if (sql === 'BEGIN') transaction = true;
      if (sql === 'COMMIT' || sql === 'ROLLBACK') transaction = false;
      return result;
    } };
  } };
  const worker = createGuestBookingReminderService({ db, now: () => clock, wake: async id => {
    assert.equal(id, 201); assert.equal(transaction, false); wakes++;
    assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM crm_audit_events WHERE action='booking.guest_reminder_queued'")).rows[0].n, 1);
    return { accepted: 1 };
  } });
  const result = await worker.queueNext();
  assert.equal(result.state, 'wake_accepted');
  const stored = (await f.db.query('SELECT * FROM my_shiloh_push_notifications WHERE id=$1', [result.notificationId])).rows[0];
  assert.equal(new Date(stored.expires_at).toISOString(), '2099-10-24T06:30:00.000Z');
  assert.match(stored.body, /Synthetic Guest A/);
  assert.doesNotMatch(stored.body, /treatment|forms|paid|sign.in/);
  const push = createMyShilohPushService({ db: f.db, env: {}, now: () => clock });
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications.map(n => n.id), [result.notificationId]);
  await f.db.query("UPDATE appointments SET starts_at=starts_at+INTERVAL '1 hour',ends_at=ends_at+INTERVAL '1 hour',updated_at=updated_at+INTERVAL '1 second' WHERE id=$1", [f.created.appointmentIds[0]]);
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications, []);
  assert.deepEqual((await push.pending({ crmV2ClientId: 201, endpoint })).notifications, []);
  assert.equal(Number((await f.db.query('SELECT last_notification_id FROM my_shiloh_push_subscriptions')).rows[0].last_notification_id), result.notificationId);
  const otherId = (await f.db.query('SELECT id FROM appointment_lifecycle WHERE id<>$1', [result.lifecycleId])).rows[0].id;
  const laterClock = new Date(clock.getTime() + 3600000);
  const moved = await createGuestBookingReminderService({ db: f.db, now: () => laterClock,
    wake: async () => ({ accepted: 1 }) }).queueNext({ excludeIds: [otherId] });
  assert.equal(moved.state, 'wake_accepted');
  assert.notEqual(moved.notificationId, result.notificationId);
  assert.equal(new Date((await f.db.query('SELECT appointment_at FROM appointment_lifecycle WHERE id=$1', [result.lifecycleId])).rows[0].appointment_at).toISOString(), '2099-10-24T07:30:00.000Z');
  assert.deepEqual((await push.pending({ crmV2ClientId: 201, endpoint })).notifications.map(n => n.id), [moved.notificationId]);
  const ended = createMyShilohPushService({ db: f.db, env: {}, now: () => new Date('2099-10-24T07:30:00Z') });
  assert.deepEqual((await ended.listForClient({ crmV2ClientId: 201 })).notifications, []);
  assert.equal(wakes, 1);
});

test('confirmation history needs its matching audit, current group context and recipient; ordinary history retains its existing semantics', async t => {
  const f = await createGuestFixture(t);
  const push = createMyShilohPushService({ db: f.db, env: {} });
  const originalId = f.created.guestObligation.notificationId;
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications.map(n => n.id), [originalId]);
  await push.queueNotification({ crmV2ClientId: 201, eventKey: 'guest-booking:booking_confirmation:' + 'a'.repeat(64),
    category: 'appointment', title: 'Unaudited guest notice', body: 'Must stay hidden.', deferWake: true });
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications.map(n => n.id), [originalId]);
  await f.db.query('UPDATE appointment_services SET service_id=90 WHERE appointment_id=$1', [f.created.appointmentIds[2]]);
  await f.db.query("INSERT INTO service_visibility_policies(service_id,visibility_scope,owner_staff_id) VALUES(90,'tenant_private',11)");
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications, []);
  await f.db.query('DELETE FROM service_visibility_policies');
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(202,'Synthetic Other Organiser','27810000202','test')");
  await f.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(202,'clinic','test')");
  await f.db.query('UPDATE appointment_group_booking_contacts SET organiser_crm_v2_client_id=202,revision=revision+1');
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications, []);
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 202 })).notifications, []);
  const ordinary = await push.queueNotification({ crmV2ClientId: 201, eventKey: 'synthetic-ordinary', category: 'system',
    title: 'Ordinary history', body: 'Retained.', deferWake: true });
  await f.db.query("UPDATE my_shiloh_push_notifications SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [ordinary.notificationId]);
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications.map(n => n.id), [ordinary.notificationId]);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 3);
});

test('unaccepted wakes remain retryable with the original audited notice, and outcome/contact changes suppress old notices', async t => {
  const f = await createGuestFixture(t); await subscribe(f);
  let wakes = 0;
  const worker = createGuestBookingReminderService({ db: f.db, now: () => clock, wake: async () => ({ accepted: ++wakes > 1 ? 1 : 0 }) });
  const first = await worker.queueNext();
  assert.equal(first.state, 'retry_pending');
  assert.equal((await f.db.query('SELECT reminder_sent_at FROM appointment_lifecycle WHERE id=$1', [first.lifecycleId])).rows[0].reminder_sent_at, null);
  const retry = await worker.queueNext();
  assert.equal(retry.state, 'wake_accepted');
  assert.equal(retry.notificationId, first.notificationId);
  assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM crm_audit_events WHERE action='booking.guest_reminder_queued'")).rows[0].n, 1);
  const push = createMyShilohPushService({ db: f.db, env: {}, now: () => clock });
  await f.db.query("UPDATE appointments SET status='no_show' WHERE id=$1", [f.created.appointmentIds[0]]);
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications, []);
  await f.db.query("UPDATE appointments SET status='scheduled' WHERE id=$1", [f.created.appointmentIds[0]]);
  await f.db.query('UPDATE appointment_group_booking_contacts SET revision=revision+1');
  assert.deepEqual((await push.listForClient({ crmV2ClientId: 201 })).notifications, []);
});

test('audit failure and a lost commit response never wake before verified persistence and recover without duplicate reminders', async t => {
  const f = await createGuestFixture(t); await subscribe(f);
  let wakes = 0;
  const worker = createGuestBookingReminderService({ db: f.db, now: () => clock, wake: async () => { wakes++; return { accepted: 1 }; } });
  await f.sql.exec("ALTER TABLE crm_audit_events ADD CONSTRAINT fail_reminder_audit CHECK(action <> 'booking.guest_reminder_queued')");
  await assert.rejects(worker.queueNext());
  assert.equal(wakes, 0);
  assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM my_shiloh_push_notifications WHERE event_key LIKE 'guest-booking:appointment_reminder:%'")).rows[0].n, 0);
  await f.sql.exec('ALTER TABLE crm_audit_events DROP CONSTRAINT fail_reminder_audit');
  let lost = false;
  const db = { ...f.db, connect: async () => {
    const tx = await f.db.connect();
    return { release: (...args) => tx.release(...args), query: async (sql, args) => {
      const result = await tx.query(sql, args);
      if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('Synthetic lost commit response'); }
      return result;
    } };
  } };
  await assert.rejects(createGuestBookingReminderService({ db, now: () => clock, wake: async () => { wakes++; } }).queueNext(), /lost commit/);
  assert.equal(wakes, 0);
  const retry = await worker.queueNext();
  assert.equal(retry.state, 'wake_accepted');
  assert.equal(wakes, 1);
  assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM my_shiloh_push_notifications WHERE event_key LIKE 'guest-booking:appointment_reminder:%'")).rows[0].n, 1);
});

test('a genuine own-mobile transition returns to the existing client reminder worker without forwarding private follow-up', async t => {
  const f = await createGuestFixture(t);
  const appointmentId = f.created.appointmentIds[0];
  const clientId = (await f.db.query('SELECT crm_v2_client_id FROM appointments WHERE id=$1', [appointmentId])).rows[0].crm_v2_client_id;
  await f.db.query("UPDATE crm_v2_clients SET normalized_mobile='27810000999',contact_mode='direct' WHERE id=$1", [clientId]);
  await subscribe(f, clientId);
  await f.sql.exec("UPDATE appointments SET starts_at=NOW()+INTERVAL '1 hour',ends_at=NOW()+INTERVAL '2 hours',updated_at=NOW();UPDATE appointment_groups SET starts_at=NOW()+INTERVAL '1 hour',updated_at=NOW();CREATE TABLE appointment_change_intents(phone TEXT,status TEXT,action TEXT)");
  const result = await createGuestBookingReminderService({ db: f.db, wake: async () => { throw new Error('No organiser wake permitted'); } }).queueNext();
  assert.equal(result.state, 'direct_pending');
  const row = (await f.db.query('SELECT * FROM appointment_lifecycle WHERE id=$1', [result.lifecycleId])).rows[0];
  assert.equal(row.phone, '27810000999');
  assert.equal(row.delivery_recipient_role, 'client');
  assert.equal(row.organiser_group_id, null);
  assert.equal((await claimDueReminder(f.db, { appOnly: true })).id, result.lifecycleId);
  assert.equal((await f.db.query("SELECT COUNT(*)::int n FROM my_shiloh_push_notifications WHERE event_key LIKE 'guest-booking:appointment_reminder:%'")).rows[0].n, 0);
});

test('private or ended visits cannot queue and an invalid early candidate does not starve other eligible guests', async t => {
  const f = await createGuestFixture(t); await subscribe(f);
  const [first] = f.created.appointmentIds;
  await f.db.query('UPDATE appointment_services SET service_id=90 WHERE appointment_id=$1', [first]);
  await f.db.query("INSERT INTO service_visibility_policies(service_id,visibility_scope,owner_staff_id) VALUES(90,'tenant_private',11)");
  let wakes = 0;
  const result = await processGuestReminders({ enabled: true, db: f.db, now: () => clock, wake: async () => { wakes++; return { accepted: 1 }; } });
  assert.deepEqual(result.results.map(r => r.state), ['review_required', 'wake_accepted']);
  assert.equal(wakes, 1);
  await f.db.query("UPDATE appointment_groups SET status='completed'");
  assert.equal((await createGuestBookingReminderService({ db: f.db, now: () => clock,
    wake: async () => { throw new Error('An ended group must not wake'); } }).queueNext()).state, 'idle');
});
