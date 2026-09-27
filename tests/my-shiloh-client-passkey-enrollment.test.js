'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Load the service with explicit dependencies so these security checks run
// even in a sparse review workspace without a production database or pg.
const source = fs.readFileSync(path.join(__dirname, '../src/services/clientPasskeyEnrollment.js'), 'utf8');
function makeService(db, { now = new Date('2026-09-27T16:45:00Z'), enabled = true, verify } = {}) {
  const module = { exports: {} };
  const requireDependency = (name) => {
    if (name === 'crypto') return crypto;
    if (name === '../db/pool') return { pool: db };
    if (name === '../config/publicOrigins') return { APP_ORIGIN: 'https://app.shilohmtc.co.za' };
    if (name === './clientBrowserSession') return {
      sha256: (value) => crypto.createHash('sha256').update(String(value)).digest('hex'),
      normalizedFingerprint: (value) => /^[0-9a-f]{64}$/.test(String(value)) ? value : null,
    };
    if (name === './staffPasskeyAuth') return { verifyRegistrationResponse: verify || (() => ({
      credentialId: 'A'.repeat(24), publicKeySpki: Buffer.from('public-key'), algorithm: -7,
      signCount: 0, transports: ['internal'], backedUp: true,
    })) };
    throw new Error(`unexpected dependency: ${name}`);
  };
  vm.runInThisContext(`(function(require, module) { ${source}\n})`, { filename: 'clientPasskeyEnrollment.js' })(requireDependency, module);
  const api = module.exports;
  return {
    api,
    service: api.createClientPasskeyEnrollmentService({
      db, env: { SHILOH_CLIENT_PASSKEY_AUTH_ENABLED: enabled ? 'true' : 'false',
        SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://app.shilohmtc.co.za' },
      now: () => now, randomBytes: () => Buffer.alloc(32, 7),
    }),
  };
}
const session = {
  ok: true, crmV2ClientId: 17, sessionId: 22,
  authenticatedAt: new Date('2026-09-27T16:42:00Z'),
};
function dbForBegin({ owner = true, recent = 0, existing = [] } = {}) {
  const queries = [];
  const db = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM crm_v2_clients/.test(sql)) return { rowCount: owner ? 1 : 0, rows: owner ? [{ id: 17 }] : [] };
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: recent }] };
      if (/SELECT credential_id/.test(sql)) return { rows: existing.map((credential_id) => ({ credential_id })) };
      return { rowCount: 1, rows: [] };
    },
  };
  return db;
}

test('enrollment is disabled by default and requires a fresh verified client session', async () => {
  const db = dbForBegin();
  const disabled = makeService(db, { enabled: false }).service;
  assert.deepEqual(await disabled.begin({ session }), { ok: false, code: 'CLIENT_PASSKEY_DISABLED' });
  const enabled = makeService(db).service;
  assert.deepEqual(await enabled.begin({ session: { ...session, authenticatedAt: new Date('2026-09-27T16:30:00Z') } }),
    { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' });
  assert.equal(db.queries.length, 0);
});

test('client passkeys use the My Shiloh host even if Calendar origin differs', () => {
  const { api } = makeService(dbForBegin());
  assert.deepEqual(api.enrollmentPolicy({
    SHILOH_CLIENT_PASSKEY_AUTH_ENABLED: 'true',
    SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://calendar.example.test',
  }), {
    enabled: true, operational: true,
    origin: 'https://app.shilohmtc.co.za', rpId: 'app.shilohmtc.co.za',
  });
});

test('registration challenge belongs to existing CRM client and browser session', async () => {
  const db = dbForBegin({ existing: ['B'.repeat(24)] });
  const { service } = makeService(db);
  const result = await service.begin({ session, requestFingerprintHash: 'c'.repeat(64) });
  assert.equal(result.ok, true);
  assert.equal(result.options.rp.id, 'app.shilohmtc.co.za');
  assert.equal(result.options.user.id, Buffer.from('crm-client:17').toString('base64url'));
  assert.equal(result.options.userVerification, undefined);
  assert.equal(result.options.authenticatorSelection.userVerification, 'required');
  assert.deepEqual(result.options.excludeCredentials.map((x) => x.id), ['B'.repeat(24)]);
  const insert = db.queries.find((x) => /INSERT INTO client_auth_passkey_challenges/.test(x.sql));
  assert.equal(insert.params[1], 17);
  assert.equal(insert.params[2], 22);
  assert.equal(insert.params[3], 'c'.repeat(64));
  assert.equal(insert.params[0], crypto.createHash('sha256').update(result.options.challenge).digest('hex'));
  assert.equal(db.queries.some((x) => /staff_admin_accounts|staff_browser_sessions/.test(x.sql)), false);
});

test('challenge issuance limits repeated requests and number of registered devices', async () => {
  const rate = await makeService(dbForBegin({ recent: 5 })).service.begin({ session });
  assert.deepEqual(rate, { ok: false, code: 'CLIENT_PASSKEY_RATE_LIMITED' });
  const full = await makeService(dbForBegin({ existing: Array(5).fill('B') })).service.begin({ session });
  assert.deepEqual(full, { ok: false, code: 'CLIENT_PASSKEY_LIMIT_REACHED' });
});

test('finish rejects another client, another session and expired challenge before key storage', async () => {
  const challenge = Buffer.alloc(32, 7).toString('base64url');
  const response = { response: { clientDataJSON: Buffer.from(JSON.stringify({
    type: 'webauthn.create', origin: 'https://app.shilohmtc.co.za', challenge,
  })).toString('base64url') } };
  for (const found of [null, { id: 1, expires_at: '2026-09-27T16:44:59Z' }]) {
    const queries = [];
    const db = { async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM client_auth_passkey_challenges/.test(sql)) return { rows: found ? [found] : [] };
      return { rows: [], rowCount: 1 };
    } };
    const result = await makeService(db).service.finish({ session, response });
    assert.deepEqual(result, { ok: false, code: 'CLIENT_PASSKEY_INVALID' });
    assert.equal(queries.some((x) => /INSERT INTO client_auth_passkey_credentials/.test(x.sql)), false);
    const lookup = queries.find((x) => /FROM client_auth_passkey_challenges/.test(x.sql));
    assert.equal(lookup.params[1], 17);
    assert.equal(lookup.params[2], 22);
  }
});

test('invalid registration response consumes challenge without storing a credential', async () => {
  const challenge = Buffer.alloc(32, 7).toString('base64url');
  const response = { response: { clientDataJSON: Buffer.from(JSON.stringify({
    type: 'webauthn.create', origin: 'https://app.shilohmtc.co.za', challenge,
  })).toString('base64url') } };
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (/FROM client_auth_passkey_challenges/.test(sql)) return { rows: [{ id: 1, expires_at: '2026-09-27T16:46:00Z' }] };
    if (/FROM crm_v2_clients/.test(sql)) return { rowCount: 1, rows: [{ id: 17 }] };
    return { rows: [], rowCount: 1 };
  } };
  const result = await makeService(db, { verify: () => { throw new Error('bad signature'); } }).service.finish({ session, response });
  assert.deepEqual(result, { ok: false, code: 'CLIENT_PASSKEY_INVALID' });
  assert.equal(queries.some((x) => /UPDATE client_auth_passkey_challenges SET consumed_at/.test(x.sql)), true);
  assert.equal(queries.some((x) => /INSERT INTO client_auth_passkey_credentials/.test(x.sql)), false);
  assert.equal(queries.filter((x) => x.sql === 'COMMIT').length, 1);
});

test('route keeps both enrollment endpoints session, origin and CSRF bound', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/myShiloh.js'), 'utf8');
  assert.match(route, /passkeys\/registration\/options', sameOrigin, requireSession, requireCsrf/);
  assert.match(route, /passkeys\/registration\/finish', sameOrigin, requireSession, requireCsrf/);
  assert.doesNotMatch(source, /staff_auth_passkey_credentials|staff_browser_sessions/);
});

test('device list exposes only owned active credential metadata', async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [{ id: '9', device_label: 'iPhone', created_at: '2026-09-27',
      last_used_at: null, backed_up: true }] };
  } };
  const result = await makeService(db).service.list({ session });
  assert.deepEqual(result.devices, [{ id: 9, label: 'iPhone', createdAt: '2026-09-27',
    lastUsedAt: null, backedUp: true }]);
  assert.deepEqual(queries[0].params, [17]);
  assert.match(queries[0].sql, /revoked_at IS NULL/);
  assert.doesNotMatch(queries[0].sql, /credential_id|public_key_spki/);
});

test('device revocation requires recent authentication and closes linked and older sessions atomically', async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (/SELECT id FROM client_auth_passkey_credentials/.test(sql)) return { rowCount: 1, rows: [{ id: 9 }] };
    return { rowCount: 1, rows: [] };
  } };
  const { service } = makeService(db);
  assert.equal((await service.revoke({ session: { ...session, authenticatedAt: '2026-09-27T16:00:00Z' }, credentialId: 9 })).code,
    'CLIENT_RECENT_AUTH_REQUIRED');
  assert.equal(queries.length, 0);
  assert.equal((await service.revoke({ session, credentialId: 9 })).ok, true);
  assert.deepEqual(queries.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 3).join(' ')).slice(0, 2),
    ['BEGIN', 'SELECT id FROM']);
  const ownership = queries.find(({ sql }) => /SELECT id FROM client_auth_passkey_credentials/.test(sql));
  assert.deepEqual(ownership.params, [9, 17]);
  const sessionUpdate = queries.find(({ sql }) => /UPDATE client_browser_sessions/.test(sql));
  assert.match(sessionUpdate.sql, /passkey_credential_id = \$2/);
  assert.match(sessionUpdate.sql, /passkey_credential_id IS NULL AND auth_method = 'passkey'/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('revocation rejects another client credential without updating sessions', async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push(sql);
    if (/SELECT id FROM client_auth_passkey_credentials/.test(sql)) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  } };
  assert.equal((await makeService(db).service.revoke({ session, credentialId: 9 })).code, 'CLIENT_PASSKEY_INVALID');
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(queries.some((sql) => /UPDATE client_browser_sessions/.test(sql)), false);
});
