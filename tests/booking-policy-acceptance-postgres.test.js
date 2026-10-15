'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../src/db/pool');

// Exercise the production acceptance transaction, with unrelated approval-schema
// setup replaced. All data and schema changes remain inside this isolated fixture.
test('booking acceptance uses production-shaped phone types and fails atomically', async t => {
  let pg;
  const nativeUrl = process.env.TEST_BOOKING_POLICY_DATABASE_URL;
  if (nativeUrl) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: nativeUrl });
    await client.connect();
    const schema = `booking_policy_test_${process.pid}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    pg = { query: (...args) => client.query(...args), exec: sql => client.query(sql),
      async close() {
        try { await client.query('ROLLBACK'); await client.query(`DROP SCHEMA ${schema} CASCADE`); }
        finally { await client.end(); }
      } };
  } else pg = new PGlite();
  t.after(() => pg.close());
  const query = async (sql, values) => {
    const result = await pg.query(sql, values);
    return { ...result, rowCount: result.rowCount ?? (result.rows.length || result.affectedRows || 0) };
  };
  t.mock.method(pool, 'query', query);
  let releases = 0;
  t.mock.method(pool, 'connect', async () => ({ query, release() { releases++; } }));
  const schemaSetup = require('../src/services/clientBookingApprovalSchema');
  t.mock.method(schemaSetup, 'ensureBookingApprovalInfrastructure', async () => {});
  const { recordAcceptance, ensurePolicySchema, POLICY_VERSION, POLICY_TEXT } = require('../src/services/bookingPolicy');
  const { createMyShilohBookingService } = require('../src/services/myShilohBooking');
  await pg.exec(`
    CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY, name TEXT, normalized_mobile TEXT,
      status TEXT, profile_status TEXT, date_of_birth DATE DEFAULT '1980-01-01', gender TEXT DEFAULT 'female', provenance JSONB DEFAULT '{}');
    CREATE TABLE appointments(id BIGINT PRIMARY KEY, crm_v2_client_id BIGINT);
    CREATE TABLE booking_intents(phone VARCHAR(32) PRIMARY KEY, service_text TEXT,
      preferred_date TEXT, preferred_time TEXT, therapist_text TEXT, service_verified BOOLEAN,
      status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  `);
  await ensurePolicySchema();
  for (const name of ['155_in_person_booking_policy_acceptance_links.sql', '193_client_policy_document_snapshots.sql']) {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
  }
  const phone = '27820000001';
  const stage = async (version = POLICY_VERSION) => {
    await pg.exec('DELETE FROM booking_intents; DELETE FROM booking_policy_acceptances; DELETE FROM crm_v2_clients');
    await query(`INSERT INTO booking_intents(phone,service_text,preferred_date,preferred_time,therapist_text,
      service_verified,status,policy_version) VALUES($1,'Synthetic treatment','2030-01-02','10:00',
      'Synthetic practitioner',TRUE,'awaiting_policy_acceptance',$2)`, [phone, version]);
  };

  await t.test('zero, one and multiple active matches retain exact snapshots and conservative identity', async () => {
    for (const activeMatches of [0, 1, 2]) {
      await stage();
      await query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,status,profile_status) VALUES(9,'Archived synthetic',$1,'archived','registered')", [phone]);
      for (let id = 1; id <= activeMatches; id++) {
        await query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,status,profile_status) VALUES($1,'Synthetic client',$2,'active','registered')", [id, phone]);
      }
      const accepted = await recordAcceptance(phone, 'my_shiloh');
      assert.equal(accepted.status, 'policy_accepted');
      const rows = (await query('SELECT * FROM booking_policy_acceptances')).rows;
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.phone, phone);
      assert.equal(row.policy_version, POLICY_VERSION);
      assert.equal(row.policy_text_snapshot, POLICY_TEXT);
      assert.equal(row.channel, 'my_shiloh');
      assert.equal(row.service_text, 'Synthetic treatment');
      assert.equal(row.preferred_date, '2030-01-02');
      assert.equal(row.preferred_time, '10:00');
      assert.equal(row.therapist_text, 'Synthetic practitioner');
      assert.equal(new Date(row.accepted_at).getTime(), new Date(accepted.policy_accepted_at).getTime());
      assert.equal(row.crm_v2_client_id === null ? null : Number(row.crm_v2_client_id), activeMatches === 1 ? 1 : null);
      assert.equal(await recordAcceptance(phone, 'my_shiloh'), null);
      assert.equal((await query('SELECT * FROM booking_policy_acceptances')).rows.length, 1);
      await assert.rejects(query("UPDATE booking_policy_acceptances SET policy_text_snapshot='Changed'"), /cannot be rewritten/);
      if (activeMatches === 1) await assert.rejects(query('UPDATE booking_policy_acceptances SET crm_v2_client_id=9'), /cannot be reassigned/);
    }
  });

  await t.test('missing, stale and unsupported acceptance do not write', async () => {
    await stage('stale-policy');
    assert.equal(await recordAcceptance(phone, 'my_shiloh'), null);
    assert.equal(await recordAcceptance('27820000002', 'my_shiloh'), null);
    await assert.rejects(recordAcceptance(phone, 'unsupported'), /Unsupported/);
    assert.equal((await query('SELECT * FROM booking_policy_acceptances')).rows.length, 0);
    assert.equal((await query('SELECT status FROM booking_intents')).rows[0].status, 'awaiting_policy_acceptance');
  });

  await t.test('insert constraint failure rolls the intent back and releases the transaction', async () => {
    await stage();
    await pg.exec("ALTER TABLE booking_policy_acceptances ADD CONSTRAINT synthetic_reject CHECK(channel <> 'my_shiloh')");
    const before = (await query('SELECT * FROM booking_intents')).rows;
    const releasedBefore = releases;
    await assert.rejects(recordAcceptance(phone, 'my_shiloh'), { code: '23514' });
    assert.deepEqual((await query('SELECT * FROM booking_intents')).rows, before);
    assert.equal((await query('SELECT * FROM booking_policy_acceptances')).rows.length, 0);
    assert.equal(releases, releasedBefore + 1);
  });

  await t.test('the VARCHAR phone limit is preserved by assignment rather than a truncating cast', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/services/bookingPolicy.js'), 'utf8');
    const sql = source.match(/await client.query\(`(INSERT INTO booking_policy_acceptances[^`]+)`/)[1];
    await assert.rejects(query(sql, ['2'.repeat(33), POLICY_VERSION, new Date(), 'my_shiloh',
      'Synthetic treatment', '2030-01-02', '10:00', 'Synthetic practitioner', POLICY_TEXT]), { code: '22001' });
  });

  await t.test('request failure attempts scoped cleanup and never creates an appointment, even when cleanup fails', async () => {
    for (const cleanupFails of [false, true]) {
      await stage();
      await pg.exec('DELETE FROM booking_intents');
      await query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,status,profile_status) VALUES(1,'Synthetic client',$1,'active','registered')", [phone]);
      const startsAt = '2030-01-02T08:00:00.000Z';
      let cleanupAttempts = 0;
      let commits = 0;
      let approvals = 0;
      const db = { async query(sql, values) {
        if (sql.includes('FROM services s')) return { rows: [{ id: 7, name: 'Synthetic treatment', status: 'active', price: '650.00', duration_minutes: 60 }], rowCount: 1 };
        if (sql.includes('FROM staff') && sql.includes('tenant_practitioner')) return { rows: [{ id: 11 }], rowCount: 1 };
        if (sql.includes('DELETE FROM booking_intents')) {
          cleanupAttempts++;
          assert.deepEqual(values.slice(0, 1), [phone]);
          assert.ok(values[1]);
          assert.match(sql, /phone=\$1 AND created_at=\$2/);
          if (cleanupFails) throw new Error('Synthetic cleanup failure');
        }
        return query(sql, values);
      } };
      const service = createMyShilohBookingService({ db,
        eligibleStaff: async () => [{ id: 11, display_name: 'Synthetic practitioner' }],
        availability: async () => ({ status: 'available', slots: [{ staff_id: 11, starts_at: startsAt, ends_at: '2030-01-02T09:00:00.000Z' }] }),
        ensureIntentTable: async () => {}, ensurePolicy: ensurePolicySchema, acceptPolicy: recordAcceptance,
        commitBooking: async () => { commits++; await query('INSERT INTO appointments(id) VALUES(1)'); },
        stageApproval: async () => { approvals++; }, now: () => new Date('2030-01-01') });
      await assert.rejects(service.createRequest({ crmV2ClientId: 1, serviceId: 7, staffId: 11,
        startsAt, policyAccepted: true, specialOccasion: false }), { code: '23514' });
      assert.equal(cleanupAttempts, 1);
      assert.equal(commits, 0);
      assert.equal(approvals, 0);
      assert.equal((await query('SELECT * FROM appointments')).rows.length, 0);
      assert.equal((await query('SELECT * FROM booking_policy_acceptances')).rows.length, 0);
      assert.equal((await query('SELECT * FROM booking_intents')).rows.length, cleanupFails ? 1 : 0);
    }
  });
});
