const test = require('node:test');
const assert = require('node:assert/strict');
const { lifecycleDb } = require('./fixtures/guest-booking-lifecycle-db');
const { createGroupBookingOrganiserService } = require('../src/services/groupBookingOrganiser');
const { createGuestGroupConfirmationService } = require('../src/services/guestGroupConfirmation');
const now = new Date('2026-11-06T00:00:00Z');

async function setup(t) {
  const db = await lifecycleDb(t);
  await db.exec(`ALTER TABLE crm_v2_clients ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE appointment_groups ADD COLUMN created_by_admin_id BIGINT DEFAULT 7;
    ALTER TABLE appointment_group_members ADD COLUMN guest_position INT;
    UPDATE appointment_group_members SET guest_position=appointment_id;
    ALTER TABLE appointment_group_booking_contacts ADD COLUMN created_by_admin_id BIGINT DEFAULT 7;
    CREATE TABLE staff_admin_accounts(id BIGINT PRIMARY KEY,active BOOLEAN);
    INSERT INTO staff_admin_accounts VALUES(7,TRUE);
    CREATE TABLE crm_audit_events(actor_admin_id BIGINT,action TEXT,entity_type TEXT,entity_id TEXT,metadata JSONB);`);
  const principal = { id: 7, calendarAuthority: { calendarScope: 'all_business', serviceScope: 'all_services',
    capabilities: ['appointment:create', 'client:lookup'] } };
  const organiser = createGroupBookingOrganiserService({ authorityResolver: async () => principal });
  const reviewedOrganiser = await organiser.review(db, { adminId: 7, organiserClientId: 201 });
  const service = createGuestGroupConfirmationService({ organiser });
  return { db, principal, service, input: { groupId: 10, adminId: 7, reviewedOrganiser, now } };
}

test('one audited organiser obligation covers distinct phoneless guests, retains direct participants and retries without wakes', async t => {
  const { db, service, input } = await setup(t);
  const seen = [];
  const adapter = { query: async (...args) => { seen.push(args[0]); return db.query(...args); } };
  await db.exec('BEGIN');
  const result = await service.queue(adapter, input);
  await db.exec('COMMIT');
  assert.deepEqual(result.guestAppointmentIds, [1, 3]);
  assert.equal(result.organiserClientId, 201);
  assert.equal(result.queued, true);
  assert.equal(result.duplicate, false);
  await db.exec('BEGIN');
  const retry = await service.queue(adapter, input);
  await db.exec('COMMIT');
  assert.equal(retry.notificationId, result.notificationId);
  assert.equal(retry.duplicate, true);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 2);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 1);
  const audit = (await db.query('SELECT * FROM crm_audit_events')).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'booking.group_organiser_confirmation_queued');
  assert.equal(audit[0].metadata.channel, 'my_shiloh');
  assert.doesNotMatch(JSON.stringify(audit), /private health|27810000|booking_confirmation_sent/);
  assert.ok(seen.every(sql => !/my_shiloh_push_subscriptions|\bCOMMIT\b|\bBEGIN\b/.test(sql)));
  assert.equal((await db.query('SELECT normalized_mobile FROM crm_v2_clients WHERE id=102')).rows[0].normalized_mobile, '27810000102');
});

test('audit failure rolls back lifecycle and notice with the authorized outer transaction', async t => {
  const { db, service, input } = await setup(t);
  await db.exec("ALTER TABLE crm_audit_events ADD CONSTRAINT fail_audit CHECK(action <> 'booking.group_organiser_confirmation_queued');BEGIN");
  await assert.rejects(service.queue(db, input));
  await db.exec('ROLLBACK');
  for (const table of ['appointment_lifecycle', 'my_shiloh_push_notifications', 'crm_audit_events']) {
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n, 0);
  }
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, 3);
});

test('current staff authority and reviewed organiser revision remain mandatory before any obligation', async t => {
  const { db, principal, service, input } = await setup(t);
  await db.exec("UPDATE crm_v2_clients SET normalized_mobile='27810000999',updated_at=updated_at+INTERVAL '1 second' WHERE id=201");
  await assert.rejects(service.queue(db, input), { code: 'GROUP_CONTACT_CHANGED' });
  principal.calendarAuthority.capabilities = [];
  await assert.rejects(service.queue(db, input), { code: 'GROUP_CONTACT_FORBIDDEN' });
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 0);
});

test('an unavailable or private participant prevents the group obligation instead of skipping that guest', async t => {
  const { db, service, input } = await setup(t);
  await db.exec("UPDATE appointment_services SET service_id=21 WHERE appointment_id=3;INSERT INTO service_visibility_policies VALUES(21,'tenant_private');BEGIN");
  await assert.rejects(service.queue(db, input), { code: 'GROUP_ORGANISER_CONFIRMATION_FAILED' });
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM my_shiloh_push_notifications')).rows[0].n, 0);
});
