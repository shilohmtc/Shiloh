'use strict';
// Fabricated local-only proof. Never accepts a production URL or uses the application pool.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Pool } = require('pg');
const { createClientCrmDetailAuthService } = require('../src/services/clientCrmDetailAuth');
const { createClientBrowserSessionService } = require('../src/services/clientBrowserSession');

async function main() {
  const host = process.env.CRM_SYNTHETIC_PG_SOCKET;
  assert.equal(
    host,
    '/workspace/crm-postgres-synthetic/socket',
    'Explicit isolated local socket required',
  );
  const schema = 'crm_auth_synthetic_proof';
  const admin = new Pool({ host, user: 'postgres', database: 'crm_synthetic_review', max: 2 });
  const db = new Pool({
    host,
    user: 'postgres',
    database: 'crm_synthetic_review',
    max: 12,
    options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=2000`,
    application_name: 'crm_synthetic_contention_proof',
  });
  const env = {
    MY_SHILOH_CRM_AUTH_ENABLED: 'true',
    MY_SHILOH_CRM_AUTH_RATE_KEY: 'fabricated-local-rate-key-only'.repeat(3),
  };
  const input = {
    firstName: 'Synthetic',
    surname: 'Example',
    mobile: '0820000001',
    dateOfBirth: '2000-01-01',
    gender: 'prefer_not_to_say',
  };
  const warnings = [];
  const sessions = createClientBrowserSessionService({ db });
  const auth = createClientCrmDetailAuthService({
    db,
    env,
    sessionService: sessions,
    logger: {
      warn(value) {
        warnings.push(value);
      },
    },
  });
  const attempt = (details = input, register = false) =>
    auth.attempt({
      input: details,
      register,
      address: '192.0.2.1',
      deviceToken: crypto.randomBytes(32).toString('base64url'),
    });
  const count = async (table) =>
    (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
  const reset = () =>
    db.query(
      'TRUNCATE client_auth_security_events,client_browser_sessions,client_browser_auth_challenges,crm_v2_clients,client_crm_auth_rate_buckets CASCADE',
    );
  const migration = fs.readFileSync('migrations/189_client_crm_detail_auth.sql', 'utf8');
  async function waitForBlockedAuth() {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const waiting = await admin.query(
        "SELECT 1 FROM pg_stat_activity WHERE application_name='crm_synthetic_contention_proof' AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(hashtext(%'",
      );
      if (waiting.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('Expected a separate auth connection blocked on canonical mobile lock');
  }
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await db.query('CREATE TABLE appointments(id BIGINT PRIMARY KEY,status TEXT)');
    await db.query(fs.readFileSync('migrations/084_clean_crm_v2_foundation.sql', 'utf8'));
    await db.query(fs.readFileSync('migrations/136_my_shiloh_client_browser_sessions.sql', 'utf8'));
    await db.query('ALTER TABLE client_browser_sessions ADD COLUMN passkey_credential_id BIGINT');
    const beforeMigration = (
      await db.query(`INSERT INTO crm_v2_clients
      (name,normalized_mobile,date_of_birth,gender,source)
      VALUES('Synthetic Historical','27820000009','2000-01-01','other','synthetic') RETURNING *`)
    ).rows[0];
    // Establish an actual conflicting table lock, not a mocked lock response.
    const reader = await db.connect();
    const migrator = await db.connect();
    try {
      await reader.query('BEGIN');
      await reader.query('SELECT * FROM crm_v2_clients');
      await migrator.query('BEGIN');
      await migrator.query("SET LOCAL lock_timeout='200ms'");
      const started = Date.now();
      await assert.rejects(migrator.query(migration), { code: '55P03' });
      assert.ok(Date.now() - started < 1500, 'Migration lock wait must be bounded');
      await migrator.query('ROLLBACK');
      const columns = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='crm_v2_clients' AND column_name IN ('first_name','surname')",
        [schema],
      );
      assert.equal(columns.rowCount, 0, 'Blocked migration has no partial additive columns');
      await reader.query('ROLLBACK');
      await db.query(migration);
      const afterMigration = (await db.query('SELECT * FROM crm_v2_clients')).rows[0];
      assert.deepEqual(afterMigration, { ...beforeMigration, first_name: null, surname: null });
    } finally {
      await reader.query('ROLLBACK');
      await migrator.query('ROLLBACK');
      reader.release();
      migrator.release();
    }
    console.log(
      'PASS migration 189: conflicting reader causes bounded 55P03 and atomic rollback; retry after reader release succeeds. Production lock budget remains unmeasured.',
    );
    await reset();

    const same = await Promise.all([attempt(input, true), attempt(input, true)]);
    assert.ok(same.every((r) => r.ok));
    assert.equal(same[0].client.id, same[1].client.id);
    assert.equal(await count('crm_v2_clients'), 1);
    assert.equal(await count('client_browser_sessions'), 2);
    assert.equal(
      (await db.query('SELECT mobile_verified_at FROM crm_v2_clients')).rows[0].mobile_verified_at,
      null,
    );
    console.log(
      'PASS simultaneous identical registrations reuse one unverified CRM identity, issue two independently stored sessions.',
    );

    await reset();
    const differentPhones = await Promise.all([
      attempt(input, true),
      attempt({ ...input, mobile: '0820000002' }, true),
    ]);
    assert.equal(
      differentPhones.filter((r) => r.ok).length,
      1,
      JSON.stringify(differentPhones.map((r) => ({ ok: r.ok, code: r.code }))),
    );
    assert.equal(differentPhones.filter((r) => r.code === 'CRM_AUTH_INVALID').length, 1);
    assert.equal(await count('crm_v2_clients'), 1);
    assert.equal(await count('client_browser_sessions'), 1);
    console.log(
      'PASS simultaneous same-name/DOB registrations on different phones cannot create two CRM identities.',
    );

    for (const conflict of [false, true]) {
      await reset();
      const writer = await db.connect();
      let pending;
      try {
        await writer.query('BEGIN');
        await writer.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'crm-v2-mobile:27820000001',
        ]);
        pending = attempt(input, true);
        await waitForBlockedAuth();
        const row = (
          await writer.query(
            `INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,source,status)
          VALUES($1,'27820000001','2000-01-01','other','registered','synthetic','active') RETURNING *`,
            [conflict ? 'Synthetic Different' : 'Synthetic Example'],
          )
        ).rows[0];
        await writer.query('COMMIT');
        const result = await pending;
        assert.equal(result.ok, !conflict);
        if (conflict) assert.equal(result.code, 'CRM_AUTH_INVALID');
        else assert.equal(result.client.id, row.id);
        assert.deepEqual((await db.query('SELECT * FROM crm_v2_clients')).rows[0], row);
        assert.equal(await count('client_browser_sessions'), conflict ? 0 : 1);
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
        if (pending) await pending;
      }
    }
    console.log(
      'PASS competing canonical CRM writers serialize; committed matching owners are reused unchanged, conflicting owners deny generically.',
    );

    async function seedBucket(kind, value, attempts) {
      const key = crypto
        .createHmac('sha256', env.MY_SHILOH_CRM_AUTH_RATE_KEY)
        .update(`${kind}:${value}`)
        .digest('hex');
      await db.query(
        `INSERT INTO client_crm_auth_rate_buckets(bucket_key,window_started_at,attempts,blocked_until,expires_at)
        VALUES($1,NOW(),$2,NOW()-INTERVAL '1 second',NOW()+INTERVAL '15 minutes')`,
        [key, attempts],
      );
      return key;
    }
    await reset();
    const identityKey = await seedBucket('identity', '27820000001', 5);
    const identityRace = await Promise.all(Array.from({ length: 8 }, () => attempt()));
    assert.equal(identityRace.filter((r) => r.code === 'CRM_AUTH_INVALID').length, 1);
    assert.equal(identityRace.filter((r) => r.code === 'CRM_AUTH_RATE_LIMITED').length, 7);
    assert.equal(
      (
        await db.query('SELECT attempts FROM client_crm_auth_rate_buckets WHERE bucket_key=$1', [
          identityKey,
        ])
      ).rows[0].attempts,
      6,
    );
    assert.equal(await count('client_browser_sessions'), 0);
    console.log('PASS eight competing identity attempts cannot exceed the six-attempt limit.');

    await reset();
    const globalKey = await seedBucket('global', 'clinic', 999);
    const globalRace = await Promise.all(
      Array.from({ length: 8 }, (_, i) => attempt({ ...input, mobile: `082000000${i + 1}` })),
    );
    assert.equal(globalRace.filter((r) => r.code === 'CRM_AUTH_INVALID').length, 1);
    assert.equal(globalRace.filter((r) => r.code === 'CRM_AUTH_RATE_LIMITED').length, 7);
    assert.equal(
      (
        await db.query('SELECT attempts FROM client_crm_auth_rate_buckets WHERE bucket_key=$1', [
          globalKey,
        ])
      ).rows[0].attempts,
      1000,
    );
    assert.equal(await count('crm_v2_clients'), 0);
    assert.equal(warnings.length, 0, 'No hidden database errors/deadlocks in contention proof');
    console.log('PASS eight distinct-device/identity attempts cannot exceed the clinic budget.');
    console.log(
      `PostgreSQL ${(await admin.query('SHOW server_version')).rows[0].server_version}: six isolated proof groups passed with real concurrent connections.`,
    );
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch((error) => {
  console.error(
    'Synthetic PostgreSQL proof failed:',
    error.code || error.name,
    error.code === 'ERR_ASSERTION' ? error.message : 'redacted',
  );
  process.exitCode = 1;
});
