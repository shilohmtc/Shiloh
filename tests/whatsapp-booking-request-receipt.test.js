'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pendingRequestReceipt } = require('../src/services/whatsAppBookingRequestReceipt');

test('WhatsApp request recovery reads the exact Workspace hold made by the production trigger', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const baseline = fs.readFileSync(
    path.join(__dirname, '../migrations/108_workspace_booking_request_resolution.sql'),
    'utf8',
  );
  const start = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION create_client_booking_approval_hold()',
  );
  const endMarker = 'FOR EACH ROW EXECUTE FUNCTION create_client_booking_approval_hold();';
  const end = baseline.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);

  await db.exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,status text,profile_status text,normalized_mobile text,mobile_verified_at timestamptz DEFAULT NOW());
    CREATE TABLE client_contacts(id bigint PRIMARY KEY,client_id bigint,normalized_value text,contact_type text,is_primary boolean);
    CREATE TABLE appointments(id bigint PRIMARY KEY,crm_v2_client_id bigint,client_id bigint,location_id bigint,
      source text,status text,starts_at timestamptz,ends_at timestamptz,updated_at timestamptz);
    CREATE TABLE booking_policy_acceptances(id bigint PRIMARY KEY,crm_v2_client_id bigint,appointment_id bigint,channel text,phone text);
    CREATE TABLE appointment_staff(id bigint PRIMARY KEY,appointment_id bigint,position int,staff_id bigint);
    CREATE TABLE appointment_services(id bigint PRIMARY KEY,appointment_id bigint,position int,service_id bigint);
    CREATE TABLE appointment_booking_approvals(appointment_id bigint PRIMARY KEY,approver_staff_id bigint,status text,approval_mode text,
      requested_client_id bigint,requested_crm_v2_client_id bigint,requested_client_phone text,requested_location_id bigint,
      requested_staff_id bigint,requested_staff_ids bigint[],requested_service_id bigint,requested_service_ids bigint[],
      requested_starts_at timestamptz,requested_ends_at timestamptz,requested_revision timestamptz);
  `);
  await db.exec(baseline.slice(start, end + endMarker.length));
  await db.exec(`
    INSERT INTO crm_v2_clients VALUES(1,'active','registered','27820000001');
    INSERT INTO appointments VALUES(12,1,NULL,3,'shiloh_client_whatsapp','scheduled',NOW()+INTERVAL '1 day',NOW()+INTERVAL '25 hours',NOW());
    INSERT INTO booking_policy_acceptances VALUES(31,1,12,'whatsapp','27820000001');
    INSERT INTO appointment_services VALUES(1,12,1,5);
    INSERT INTO appointment_staff VALUES(1,12,1,7);
  `);
  const request = { acceptanceId: 31, verifiedClientId: 1, senderMobile: '27820000001' };
  const read = (overrides) => pendingRequestReceipt(db, { ...request, ...overrides });
  await t.test(
    'lost response and redelivery recover one pending request with no confirmation or deposit link',
    async () => {
      await db.exec('BEGIN READ ONLY');
      try {
        const first = await read();
        assert.deepEqual(first, {
          appointmentId: '12',
          status: 'pending_resolution',
          reply: 'Your request is with Reception. We’ll message you when it’s reviewed.',
        });
        assert.deepEqual(await read(), first);
        const queue = await db.query(
          'SELECT appointment_id, requested_staff_ids, requested_service_ids FROM appointment_booking_approvals',
        );
        assert.equal(queue.rows.length, 1);
        assert.deepEqual(queue.rows[0].requested_staff_ids.map(Number), [7]);
        assert.deepEqual(queue.rows[0].requested_service_ids.map(Number), [5]);
      } finally {
        await db.exec('ROLLBACK');
      }
    },
  );
  await t.test('mismatched sender, profile and acceptance do not disclose the hold', async () => {
    for (const input of [
      { senderMobile: '27820000002' },
      { verifiedClientId: 2 },
      { acceptanceId: 32 },
      { acceptanceId: null },
    ]) {
      assert.equal(await read(input), null);
    }
  });
  for (const [reason, sql] of [
    [
      'ambiguous ownership',
      "INSERT INTO crm_v2_clients VALUES(2,'active','registered','27820000001')",
    ],
    [
      'shared historical contact',
      "INSERT INTO client_contacts VALUES(1,5,'27820000001','WhatsApp',true)",
    ],
    ['incomplete registration', "UPDATE crm_v2_clients SET profile_status='minimal'"],
    ['unverified mobile', 'UPDATE crm_v2_clients SET mobile_verified_at=NULL'],
    ['archived profile', "UPDATE crm_v2_clients SET status='archived'"],
    ['another channel', "UPDATE booking_policy_acceptances SET channel='my_shiloh'"],
    ['changed appointment', "UPDATE appointments SET updated_at=updated_at+interval '1 second'"],
    ['approved request', "UPDATE appointment_booking_approvals SET status='approved'"],
    ['missing approval', 'DELETE FROM appointment_booking_approvals'],
    ['cancelled visit', "UPDATE appointments SET status='cancelled'"],
  ]) {
    await t.test(reason + ' suppresses the pending acknowledgement', async () => {
      await db.exec('BEGIN');
      try {
        await db.exec(sql);
        assert.equal(await read(), null);
      } finally {
        await db.exec('ROLLBACK');
      }
    });
  }
});
