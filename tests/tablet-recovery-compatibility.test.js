'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const migrations = require('../src/services/migrations');
const { clientHarness } = require('./helpers/clientCodeHarness');
const { PGlite } = require('@electric-sql/pglite');

function verificationDb(ledger) {
  const calls = [];
  return { calls, async query(sql) {
    calls.push(sql);
    if (/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$|^ROLLBACK$/.test(sql)) return { rows: [] };
    if (/to_regclass\('public.schema_migrations'\)/.test(sql)) return { rows: [{ table_name: 'schema_migrations' }] };
    if (/SELECT filename, checksum, applied_at FROM schema_migrations/.test(sql)) return { rows: ledger };
    throw Error('Unexpected verification query');
  } };
}
const ledger = () => migrations.migrationInventory().map(row => ({ ...row, applied_at: '2026-11-11T00:00:00Z' }));

test('recovery source recognises exact ledger 202 using unchanged read-only authority', async () => {
  const db = verificationDb(ledger());
  const state = await migrations.verifyMigrationState({ db });
  assert.equal(state.migrationFiles, 202);
  assert.equal(state.ledgerRows, 202);
  assert.deepEqual(state.pending, []);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.calls.every(sql => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)));
  const bytes = fs.readFileSync(path.join(__dirname, '../migrations/202_clinic_tablet_booked_grants.sql'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '40c37de7579056fcf88352419af18f87d33b8d2ad1500d341abc9d954d12d56d');
});

test('recovery source refuses pending, changed and unknown migration history', async () => {
  await assert.rejects(migrations.verifyMigrationState({ db: verificationDb(ledger().slice(0, -1)) }), e => e.code === 'MIGRATION_PENDING');
  const changed = ledger(); changed.at(-1).checksum = 'wrong';
  await assert.rejects(migrations.verifyMigrationState({ db: verificationDb(changed) }), e => e.code === 'MIGRATION_CHECKSUM_MISMATCH');
  await assert.rejects(migrations.verifyMigrationState({ db: verificationDb([...ledger(), { filename: '999_unknown.sql', checksum: 'wrong' }]) }), e => e.code === 'MIGRATION_LEDGER_UNKNOWN_FILE');
});

test('canonical migration executor and recovery verifier agree on an isolated 201-to-202 database', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE clinic_checkin_devices(id BIGINT PRIMARY KEY); CREATE TABLE consultation_form_assignments(id BIGINT PRIMARY KEY); CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE synthetic_unchanged_budget(attempts INT); INSERT INTO synthetic_unchanged_budget VALUES(7)');
  await pg.query('INSERT INTO schema_migrations(filename,checksum) SELECT filename,checksum FROM jsonb_to_recordset($1::jsonb) AS r(filename TEXT,checksum TEXT)', [JSON.stringify(ledger().slice(0, -1))]);
  const db = { async query(sql, args) {
    const result = args ? await pg.query(sql, args) : (await pg.exec(sql)).at(-1);
    return { ...result, rowCount: result.rows?.length ?? result.affectedRows ?? 0 };
  } };
  await assert.rejects(migrations.verifyMigrationState({ db }), e => e.code === 'MIGRATION_PENDING');
  const result = await migrations.applyMigrationFile('202_clinic_tablet_booked_grants.sql', { db });
  assert.equal(result.applied, true);
  assert.equal((await migrations.verifyMigrationState({ db })).ledgerRows, 202);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM clinic_tablet_visit_grants')).rows[0].n, 0);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM pg_indexes WHERE tablename='clinic_tablet_visit_grants'")).rows[0].n, 5);
  assert.equal((await pg.query('SELECT attempts FROM synthetic_unchanged_budget')).rows[0].attempts, 7);
  assert.equal((await migrations.applyMigrationFile('202_clinic_tablet_booked_grants.sql', { db })).applied, false);
});

test('ordinary worker skips queued tablet proofs across restart without changing quotas', async t => {
  const h = await clientHarness(t);
  const tablet = { hash: 'a'.repeat(64), purpose: 'tablet_forms', state: 'queued', expiresAt: new Date(h.now().getTime() + 900000) };
  await h.store.transaction(tx => tx.insert(tablet));
  assert.deepEqual(await h.service.dispatchOne(), { ok: true, processed: false });
  assert.deepEqual(await h.make().dispatchOne(), { ok: true, processed: false });
  assert.equal(h.sent.length, 0);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM client_code_rates')).rows[0].n, 0);
  assert.deepEqual((await h.db.query('SELECT payload FROM client_code_records')).rows[0].payload, JSON.parse(JSON.stringify(tablet)));
});

test('ordinary sign-in still works without claiming or revoking tablet records', async t => {
  const h = await clientHarness(t);
  await h.owner();
  const request = await h.service.begin(h.context);
  const normal = (await h.db.query('SELECT payload FROM client_code_records')).rows[0].payload;
  for (const [hash, state] of [['b'.repeat(64), 'queued'], ['c'.repeat(64), 'ready']]) {
    await h.store.transaction(tx => tx.insert({ ...normal, hash, purpose: 'tablet_forms', state }));
  }
  await h.service.dispatchOne();
  assert.equal(h.sent.length, 1);
  const tablets = (await h.db.query("SELECT payload FROM client_code_records WHERE payload->>'purpose'='tablet_forms' ORDER BY record_hash")).rows;
  assert.deepEqual(tablets.map(row => row.payload.state), ['queued', 'ready']);
  const result = await h.service.verify({ ...h.context, request: request.request, code: h.sent[0].code });
  assert.equal(result.ok, true);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok, true);
  const rates = (await h.db.query('SELECT * FROM client_code_rates ORDER BY bucket_key')).rows;
  assert.equal((await h.make().dispatchOne()).processed, false);
  assert.deepEqual((await h.db.query('SELECT * FROM client_code_rates ORDER BY bucket_key')).rows, rates);
  assert.equal(h.sent.length, 1);
});

test('feature-off source does not prepare tablet access, start its worker or expose its route and CTA', async t => {
  const express = require('express');
  const { once } = require('node:events');
  const { prepareConfiguredClinicTablet, FLAG } = require('../src/services/clinicTabletBookedActivation');
  const { createClinicTabletBookedRouter } = require('../src/routes/clinicTabletBooked');
  const { welcome } = require('../src/presentation/clinicIpadCheckinUx');
  const never = () => assert.fail('Feature-off must not access services, query, send, prepare or start');
  for (const value of [undefined, false, 'false']) {
    const result = await prepareConfiguredClinicTablet({
      env: { [FLAG]: value, SHILOH_CLINIC_IPAD_CHECKIN_ENABLED: 'true', SHILOH_CLIENT_CONSULTATION_FORMS_ENABLED: 'true' },
      clientRelease: new Proxy({}, { get: never }), createCheckin: never, forms: new Proxy({}, { get: never }),
    });
    assert.equal(result, null);
  }
  assert.doesNotMatch(welcome({ bookedJourneyAvailable: false }), /href="\/check-in\/booked\//);
  const app = express();
  app.use('/check-in/booked', createClinicTabletBookedRouter({
    enabled: false, approvedForProduction: true, env: { NODE_ENV: 'production' }, service: new Proxy({}, { get: never }),
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/check-in/booked`;
  for (const [method, suffix] of [['GET', '/'], ['GET', '/current'], ['POST', '/start'], ['POST', '/verify'], ['POST', '/choose'], ['POST', '/form'], ['POST', '/touch'], ['POST', '/cancel']]) {
    const response = await fetch(base + suffix, { method, redirect: 'manual' });
    assert.equal(response.status, 404, `${method} ${suffix}`);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});
