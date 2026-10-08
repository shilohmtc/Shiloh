'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClientPasskeyRecoveryService, CODE_FORMAT } = require('../src/services/clientPasskeyRecovery');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');

const time = new Date('2026-09-27T21:00:00Z');
const fingerprint = 'a'.repeat(64);
const session = { ok: true, crmV2ClientId: 17, sessionId: 22, authenticatedAt: time };
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture({ activePasskey = true, attempts = 0 } = {}) {
  const queries = [];
  let activeCode = null;
  let issued = 0;
  let remembered;
  const db = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (/FROM client_auth_passkey_credentials/.test(sql)) return { rowCount: activePasskey ? 1 : 0, rows: activePasskey ? [{ id: 3 }] : [] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: attempts }] };
    if (/INSERT INTO client_auth_passkey_recovery_codes/.test(sql)) activeCode = params[1];
    if (/FROM client_auth_passkey_recovery_codes/.test(sql)) {
      return activeCode === params[0] ? { rowCount: 1, rows: [{ id: 5, crm_v2_client_id: 17 }] } : { rowCount: 0, rows: [] };
    }
    if (/UPDATE client_auth_passkey_recovery_codes SET consumed_at/.test(sql)) activeCode = null;
    return { rowCount: 1, rows: [] };
  } };
  const service = createClientPasskeyRecoveryService({ db, now: () => time,
    randomBytes: () => Buffer.alloc(20, 0xab), env: { SHILOH_CLIENT_PASSKEY_AUTH_ENABLED: 'true' },
    sessionService: { async issueVerifiedRecoverySession({ transaction, crmV2ClientId, keepSignedIn }) {
      assert.equal(transaction, db);
      assert.equal(crmV2ClientId, 17);
      issued += 1;
      remembered = keepSignedIn;
      return { ok: true, sessionId: 40, client: { id: '17' } };
    } },
  });
  return { service, queries, remembered: () => remembered, issued: () => issued };
}

test('a code requires a recently authenticated account with a saved passkey and is stored only as a hash', async () => {
  const { service, queries } = fixture();
  assert.deepEqual(await service.create({ session: { ...session, authenticatedAt: new Date(time.getTime() - 11 * 60 * 1000) } }),
    { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' });
  const result = await service.create({ session, requestFingerprintHash: fingerprint });
  assert.equal(result.ok, true);
  assert.match(result.code, CODE_FORMAT);
  const insert = queries.find(({ sql }) => /INSERT INTO client_auth_passkey_recovery_codes/.test(sql));
  assert.equal(insert.params[1], hash(result.code.replace(/-/g, '')));
  assert.equal(JSON.stringify(queries).includes(result.code), false);
  assert.deepEqual(await fixture({ activePasskey: false }).service.create({ session }),
    { ok: false, code: 'CLIENT_PASSKEY_REQUIRED' });
});

test('valid code signs in only once; bad codes and rate limiting issue no sessions', async () => {
  const { service, issued, queries } = fixture();
  const { code } = await service.create({ session });
  assert.deepEqual(await service.redeem({ code: 'wrong', requestFingerprintHash: fingerprint }),
    { ok: false, code: 'CLIENT_RECOVERY_INVALID' });
  assert.equal(issued(), 0);
  assert.equal((await service.redeem({ code: code.toLowerCase(), requestFingerprintHash: fingerprint })).ok, true);
  assert.equal(issued(), 1);
  assert.deepEqual(await service.redeem({ code, requestFingerprintHash: fingerprint }),
    { ok: false, code: 'CLIENT_RECOVERY_INVALID' });
  assert.equal(issued(), 1);
  assert.equal(queries.filter(({ sql }) => /INSERT INTO client_auth_passkey_recovery_attempts/.test(sql)).length, 3);
  const limited = fixture({ attempts: 5 });
  assert.deepEqual(await limited.service.redeem({ code, requestFingerprintHash: fingerprint }),
    { ok: false, code: 'CLIENT_RECOVERY_RATE_LIMITED' });
  assert.equal(limited.issued(), 0);
});

test('passkey entry offers recovery and a recovered client is prompted to replace the used code', () => {
  const guest = renderMyShilohPage({ passkeysAvailable: true, catalogue: [] });
  assert.match(guest, /Can’t use your passkey\?/);
  assert.match(guest, /data-passkey-recovery-form/);
  const profile = renderMyShilohPage({ passkeysAvailable: true, catalogue: [],
    client: { id: '17', firstName: 'Jean-Pierre', name: 'Jean-Pierre Botha' },
    signInMethod: 'passkey_recovery' });
  assert.match(profile, /Signed in with a recovery code/);
  assert.match(profile, /Save a new passkey and create a new recovery code now/);
  assert.match(profile, /data-passkey-recovery-create/);
});

test('single-use recovery forwards explicit remembered choice only after proof', async () => {
  for (const keepSignedIn of [true, false]) {
    const h = fixture();
    const { code } = await h.service.create({ session });
    assert.equal((await h.service.redeem({ code, requestFingerprintHash: fingerprint, keepSignedIn })).ok, true);
    assert.equal(h.remembered(), keepSignedIn);
  }
});
