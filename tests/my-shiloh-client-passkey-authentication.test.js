'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../src/services/clientPasskeyAuthentication.js'), 'utf8');
const fingerprint = 'a'.repeat(64);
const time = new Date('2026-09-27T19:00:00Z');
const challenge = Buffer.alloc(32, 7).toString('base64url');
const browserToken = Buffer.alloc(32, 7).toString('base64url');
const credentialId = Buffer.alloc(32, 9).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const response = {
  id: credentialId, rawId: credentialId, type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({
    type: 'webauthn.get', origin: 'https://app.shilohmtc.co.za', challenge,
  })).toString('base64url'), authenticatorData: 'abc', signature: 'def' },
};

function makeDb({ count = 0, challengeRow = { id: 33, expires_at: new Date(time.getTime() + 1000) },
  credential = { id: 44, credential_id: credentialId, crm_v2_client_id: 17, status: 'active' } } = {}) {
  const queries = [];
  return { queries, async query(sql, params) {
    queries.push({ sql, params });
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count }] };
    if (/FROM client_auth_passkey_login_challenges/.test(sql)) return { rows: challengeRow ? [challengeRow] : [] };
    if (/FROM client_auth_passkey_credentials/.test(sql)) return { rows: credential ? [credential] : [] };
    return { rowCount: 1, rows: [] };
  } };
}

function makeService(db, { enabled = true, verify = () => ({ signCount: 8, backedUp: true }), session } = {}) {
  const module = { exports: {} };
  const requireDependency = (name) => {
    if (name === 'node:crypto') return crypto;
    if (name === '../db/pool') return { pool: db };
    if (name === './clientBrowserSession') return {
      sha256: hash,
      normalizedFingerprint: (value) => /^[0-9a-f]{64}$/.test(String(value)) ? value : null,
      isValidOpaqueToken: (value) => /^[A-Za-z0-9_-]{43}$/.test(String(value)),
    };
    if (name === './clientPasskeyEnrollment') return {
      CHALLENGE_TTL_MS: 300000,
      enrollmentPolicy: (env) => ({ enabled: env.SHILOH_CLIENT_PASSKEY_AUTH_ENABLED === 'true',
        operational: env.SHILOH_CLIENT_PASSKEY_AUTH_ENABLED === 'true',
        rpId: 'app.shilohmtc.co.za', origin: 'https://app.shilohmtc.co.za' }),
      responseChallenge: (r, origin, type) => {
        const data = JSON.parse(Buffer.from(r?.response?.clientDataJSON || '', 'base64url').toString());
        return data.origin === origin && data.type === type ? data.challenge : null;
      },
    };
    if (name === './staffPasskeyAuth') return {
      verifyAssertionResponse: verify,
      b64url: (value) => Buffer.from(value).toString('base64url'),
      fromB64url: (value) => Buffer.from(value, 'base64url'),
    };
    throw new Error(`unexpected dependency: ${name}`);
  };
  vm.runInThisContext(`(function(require, module) { ${source}\n})`, { filename: 'clientPasskeyAuthentication.js' })(requireDependency, module);
  let issued = 0;
  const sessionService = session || { async issueVerifiedPasskeySession({ transaction, crmV2ClientId }) {
    issued += 1;
    assert.equal(transaction, db);
    assert.equal(crmV2ClientId, 17);
    return { ok: true, sessionToken: 'session', csrfToken: 'csrf', client: { id: '17' } };
  } };
  return {
    service: module.exports.createClientPasskeyAuthenticationService({
      db, sessionService, now: () => time, randomBytes: () => Buffer.alloc(32, 7),
      env: { SHILOH_CLIENT_PASSKEY_AUTH_ENABLED: enabled ? 'true' : 'false' },
    }),
    issued: () => issued,
  };
}

test('guest challenges are disabled by default, browser bound and rate limited', async () => {
  const db = makeDb();
  const disabled = makeService(db, { enabled: false }).service;
  assert.deepEqual(await disabled.begin({ requestFingerprintHash: fingerprint }),
    { ok: false, code: 'CLIENT_PASSKEY_DISABLED' });
  assert.equal(db.queries.length, 0);
  const start = await makeService(db).service.begin({ requestFingerprintHash: fingerprint });
  assert.equal(start.ok, true);
  assert.equal(start.options.challenge, challenge);
  assert.equal(start.options.userVerification, 'required');
  assert.deepEqual(start.options.allowCredentials, []);
  const insert = db.queries.find((q) => /INSERT INTO client_auth_passkey_login_challenges/.test(q.sql));
  assert.deepEqual(insert.params.slice(0, 3), [hash(challenge), hash(browserToken), fingerprint]);
  assert.equal(JSON.stringify(start).includes(credentialId), false);
  const limited = await makeService(makeDb({ count: 5 })).service.begin({ requestFingerprintHash: fingerprint });
  assert.deepEqual(limited, { ok: false, code: 'CLIENT_PASSKEY_RATE_LIMITED' });
});

test('wrong browser token and expired challenge cannot issue a session', async () => {
  for (const challengeRow of [null, { id: 33, expires_at: new Date(time.getTime() - 1) }]) {
    const db = makeDb({ challengeRow });
    const auth = makeService(db);
    assert.deepEqual(await auth.service.finish({ browserToken, response, requestFingerprintHash: fingerprint }),
      { ok: false, code: 'CLIENT_PASSKEY_INVALID' });
    assert.equal(auth.issued(), 0);
    assert.equal(db.queries.some((q) => /UPDATE client_auth_passkey_credentials/.test(q.sql)), false);
    const lookup = db.queries.find((q) => /FROM client_auth_passkey_login_challenges/.test(q.sql));
    assert.deepEqual(lookup.params, [hash(challenge), hash(browserToken)]);
  }
});

test('failed signature and revoked or inactive credential consume challenge without a session', async () => {
  for (const options of [
    { verify: () => { throw new Error('bad signature'); } },
    { credential: null },
    { credential: { id: 44, crm_v2_client_id: 17, status: 'inactive' } },
  ]) {
    const db = makeDb({ credential: Object.hasOwn(options, 'credential') ? options.credential : undefined });
    const auth = makeService(db, options);
    assert.deepEqual(await auth.service.finish({ browserToken, response, requestFingerprintHash: fingerprint }),
      { ok: false, code: 'CLIENT_PASSKEY_INVALID' });
    assert.equal(auth.issued(), 0);
    assert.equal(db.queries.some((q) => /SET consumed_at/.test(q.sql)), true);
    assert.equal(db.queries.some((q) => /UPDATE client_auth_passkey_credentials/.test(q.sql)), false);
    assert.equal(db.queries.filter((q) => q.sql === 'COMMIT').length, 1);
  }
});

test('verified assertion updates counter and issues existing CRM browser session atomically', async () => {
  const db = makeDb();
  const auth = makeService(db);
  const result = await auth.service.finish({ browserToken, response, requestFingerprintHash: fingerprint });
  assert.equal(result.ok, true);
  assert.equal(auth.issued(), 1);
  assert.deepEqual(db.queries.find((q) => /SET sign_count/.test(q.sql)).params.slice(0, 3), [44, 8, true]);
  assert.equal(db.queries.filter((q) => q.sql === 'COMMIT').length, 1);
  assert.equal(db.queries.some((q) => /staff_admin_accounts|staff_browser_sessions/.test(q.sql)), false);
});

test('guest routes require same origin and use a separate HttpOnly challenge cookie', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/myShiloh.js'), 'utf8');
  const cookies = fs.readFileSync(path.join(__dirname, '../src/middleware/clientBrowserSession.js'), 'utf8');
  assert.match(routes, /passkeys\/sign-in\/options', sameOrigin/);
  assert.match(routes, /passkeys\/sign-in\/finish', sameOrigin/);
  assert.match(routes, /clientPasskeyAuthTokenFromRequest\(req, env\)/);
  assert.match(cookies, /__Host-shiloh_client_passkey_auth/);
  assert.match(cookies, /'SameSite=Strict'/);
  assert.match(cookies, /'HttpOnly'/);
  assert.match(cookies, /'Secure'/);
});

test('verified passkey forwards remembered choice without changing WebAuthn verification', async () => {
  for (const keepSignedIn of [true, false]) {
    const db = makeDb();
    let remembered;
    const auth = makeService(db, { session: { async issueVerifiedPasskeySession(input) {
      remembered = input.keepSignedIn;
      return { ok: true };
    } } });
    assert.equal((await auth.service.finish({ browserToken, response, requestFingerprintHash: fingerprint, keepSignedIn })).ok, true);
    assert.equal(remembered, keepSignedIn);
  }
});
