const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createAppointment } = require('../src/services/appointmentLifecycle');
const input = { appointmentId: 1, crmV2ClientId: 101, clientName: 'Synthetic Guest', phone: '27810000101',
  service: 'Synthetic treatment', appointmentAt: '2030-01-01T08:00Z', appointmentEndsAt: '2030-01-01T09:00Z', source: 'shiloh_calendar_group' };
async function setup(t, modern = true) {
  const sql = new PGlite(); t.after(() => sql.close());
  await sql.exec(`CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,normalized_mobile TEXT,status TEXT,contact_mode TEXT);
    INSERT INTO crm_v2_clients VALUES(101,'27810000101','active','direct');
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT,client_id BIGINT);INSERT INTO appointments VALUES(1,101,NULL);
    CREATE TABLE crm_audit_events(action TEXT,entity_type TEXT,entity_id BIGINT,metadata JSONB);
    CREATE TABLE appointment_lifecycle(id BIGSERIAL PRIMARY KEY,appointment_id BIGINT,client_id BIGINT,crm_v2_client_id BIGINT,
      client_name_snapshot TEXT,phone TEXT NOT NULL,service_text TEXT NOT NULL,appointment_at TIMESTAMPTZ NOT NULL,
      appointment_ends_at TIMESTAMPTZ,therapist_text TEXT,source TEXT,status TEXT DEFAULT 'confirmed',
      reminder_sent_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE UNIQUE INDEX lifecycle_appointment ON appointment_lifecycle(appointment_id) WHERE appointment_id IS NOT NULL;`);
  if (modern) await sql.exec(`ALTER TABLE appointment_lifecycle ALTER COLUMN phone DROP NOT NULL;
    ALTER TABLE appointment_lifecycle ADD COLUMN delivery_recipient_role TEXT DEFAULT 'client',ADD COLUMN organiser_group_id BIGINT;
    ALTER TABLE appointment_lifecycle ADD CONSTRAINT valid_recipient CHECK(
      (delivery_recipient_role='client' AND phone IS NOT NULL AND organiser_group_id IS NULL)
      OR (delivery_recipient_role='organiser' AND phone IS NULL AND organiser_group_id IS NOT NULL
        AND appointment_id IS NOT NULL AND crm_v2_client_id IS NOT NULL AND client_id IS NULL));
    INSERT INTO appointment_lifecycle(appointment_id,crm_v2_client_id,client_name_snapshot,phone,service_text,appointment_at,
      delivery_recipient_role,organiser_group_id,reminder_sent_at)
    VALUES(1,101,'Synthetic Guest',NULL,'Group appointment','2030-01-01T08:00Z','organiser',10,'2029-12-31T08:00Z');`);
  const query = async (...args) => { const r = await sql.query(...args); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
  const releases = [];
  return { sql, releases, db: { query, connect: async () => ({ query, release(error) { releases.push(error?.code || false); } }) } };
}

test('direct lifecycle enrolment retains ordinary behavior on the old schema', async t => {
  const { db, releases } = await setup(t, false);
  const first = await createAppointment(input, { db });
  const retry = await createAppointment({ ...input, therapist: 'Synthetic practitioner' }, { db });
  assert.equal(first.id, retry.id);
  assert.equal(retry.phone, input.phone);
  assert.equal(retry.therapist_text, 'Synthetic practitioner');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM crm_audit_events')).rows[0].n, 0);
  assert.deepEqual(releases, [false, false]);
});

test('later own-mobile enrolment atomically switches the existing guest delivery role without duplicating it or resetting a reminder', async t => {
  const { db } = await setup(t);
  const row = await createAppointment(input, { db });
  assert.equal(row.delivery_recipient_role, 'client');
  assert.equal(row.phone, input.phone);
  assert.equal(row.organiser_group_id, null);
  assert.equal(new Date(row.reminder_sent_at).toISOString(), '2029-12-31T08:00:00.000Z');
  await createAppointment(input, { db });
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM appointment_lifecycle')).rows[0].n, 1);
  const audits = (await db.query('SELECT * FROM crm_audit_events')).rows;
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.previousOrganiserGroupId, 10);
  assert.doesNotMatch(JSON.stringify(audits), /27810000101/);
});

test('an organiser phone, wrong canonical guest or failed audit cannot convert guest identity or lifecycle', async t => {
  const { db, sql, releases } = await setup(t);
  for (const patch of [{ phone: '27810000201' }, { crmV2ClientId: 102 }, { clientId: 9 }]) {
    await assert.rejects(createAppointment({ ...input, ...patch }, { db }), { code: 'GROUP_GUEST_DIRECT_CONTACT_REQUIRED' });
  }
  await sql.exec("ALTER TABLE crm_audit_events ADD CONSTRAINT reject_audit CHECK(action <> 'booking.guest_lifecycle_became_direct')");
  await assert.rejects(createAppointment(input, { db }));
  const row = (await db.query('SELECT * FROM appointment_lifecycle')).rows[0];
  assert.equal(row.delivery_recipient_role, 'organiser');
  assert.equal(row.phone, null);
  assert.equal(Number(row.organiser_group_id), 10);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM crm_audit_events')).rows[0].n, 0);
  assert.deepEqual(releases, ['GROUP_GUEST_DIRECT_CONTACT_REQUIRED', 'GROUP_GUEST_DIRECT_CONTACT_REQUIRED', 'GROUP_GUEST_DIRECT_CONTACT_REQUIRED', '23514']);
});
