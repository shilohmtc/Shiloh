'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClientSmsAuthService, createSmsMessengerGateway, safeGatewayFailure } = require('../src/services/clientSmsAuth');
const { normalizeMobile, normalizeName } = require('../src/services/crmV2ClientService');

const at = new Date('2026-09-28T07:00:00.000Z');
const fingerprint = 'a'.repeat(64);

function makeHarness({ owner = { status: 'found', client: { id: '17' } }, sendFails = false,
  mobileDayCount = 0, clinicDayCount = 0 } = {}) {
  let challenge;
  const queries = [];
  const warnings = [];
  const db = {
    async connect() { return { query: db.query, release() {} }; },
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('mobile_count')) return { rows: [{ mobile_count: 0, fingerprint_count: 0, last_issued: null }] };
      if (sql.includes('clinic_day_count')) return { rows: [{ mobile_day_count: mobileDayCount, clinic_day_count: clinicDayCount }] };
      if (sql.includes('INSERT INTO client_sms_auth_challenges')) {
        challenge = { id: 31, browser_token_hash: params[0], normalized_mobile: params[1], client_name: params[2],
          code_hash: params[3], request_fingerprint_hash: params[4], issued_at: params[5], expires_at: params[6],
          verify_attempts: 0, provider_message_id: null, revoked_at: null, consumed_at: null };
        return { rows: [{ id: 31 }] };
      }
      if (sql.includes('SET provider_message_id')) challenge.provider_message_id = params[1];
      if (sql.includes('SET revoked_at = $2') && challenge) challenge.revoked_at = params[1];
      if (sql.includes('SET verify_attempts')) {
        challenge.verify_attempts = params[1];
        if (params[1] >= 5) challenge.revoked_at = params[2];
      }
      if (sql.includes('SET consumed_at')) challenge.consumed_at = params[1];
      if (sql.includes('SELECT * FROM client_sms_auth_challenges')) return { rows: challenge && challenge.browser_token_hash === params[0] ? [{ ...challenge }] : [] };
      return { rows: [], rowCount: 1 };
    },
  };
  let issued = 0;
  let remembered;
  let verified = 0;
  const crmService = {
    normalizeMobile, normalizeName,
    async resolveExactMobile() { return owner; },
    async createClient() { return { status: 'created', client: { id: '17' } }; },
    async recordVerifiedSmsInteraction() { verified += 1; return { status: 'verified', client: { id: '17' } }; },
  };
  let sent;
  const gateway = { enabled: () => true, async send(payload) {
    sent = payload;
    if (sendFails) throw new Error('provider down');
    return 'provider-123';
  } };
  const sessionService = { async issueVerifiedSmsSession({ normalizedMobile, crmV2ClientId, keepSignedIn }) {
    issued += 1;
    remembered = keepSignedIn;
    assert.equal(normalizedMobile, '27821234567');
    assert.equal(crmV2ClientId, '17');
    return { ok: true, client: { id: '17' }, sessionToken: 'session', expiresAt: new Date(at.getTime() + 10000) };
  } };
  const service = createClientSmsAuthService({
    db, crmService, gateway, sessionService, env: { MY_SHILOH_SMS_AUTH_ENABLED: 'true' },
    now: () => at, randomBytes: (size) => Buffer.alloc(size, 7),
    logger: { warn(message) { warnings.push(message); } },
  });
  return { service, queries, warnings, get challenge() { return challenge; }, get sent() { return sent; }, remembered: () => remembered, issued: () => issued, verified: () => verified };
}

test('SMS gateway uses POST with private headers, requires accepted message id and sends one short code', async () => {
  let request;
  const gateway = createSmsMessengerGateway({ env: {
    SMSMESSENGER_ACCOUNT_EMAIL: 'clinic@example.test', SMSMESSENGER_API_TOKEN: 'private-token',
  }, fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { messageId: '42', error: null }; } };
  } });
  assert.equal(await gateway.send({ mobile: '27821234567', code: '123456' }), '42');
  assert.equal(request.options.method, 'POST');
  assert.equal(new URL(request.url).search, '');
  assert.equal(request.options.headers.token, 'private-token');
  assert.match(JSON.parse(request.options.body).message, /123456.*10 minutes/);
  const broken = createSmsMessengerGateway({ env: {
    SMSMESSENGER_ACCOUNT_EMAIL: 'clinic@example.test', SMSMESSENGER_API_TOKEN: 'private-token',
  }, fetchImpl: async () => ({ ok: true, async json() { return { error: 'no credits' }; } }) });
  await assert.rejects(broken.send({ mobile: '27821234567', code: '123456' }));
  await assert.rejects(createSmsMessengerGateway({ env: {
    SMSMESSENGER_ACCOUNT_EMAIL: 'clinic@example.test', SMSMESSENGER_API_TOKEN: 'private-token',
  }, fetchImpl: async () => ({ ok: false, status: 403,
    async json() { return { error: 'API key rejected: 27821234567 private-token' }; } })
  }).send({ mobile: '27821234567', code: '123456' }), error => {
    assert.deepEqual(safeGatewayFailure(error), { category: 'authentication', providerStatus: 403 });
    return true;
  });
});

test('provider rejection checks account without logging response text or private values', async () => {
  const requests = [];
  const gateway = createSmsMessengerGateway({ env: {
    SMSMESSENGER_ACCOUNT_EMAIL: 'clinic@example.test', SMSMESSENGER_API_TOKEN: 'private-token',
  }, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1
      ? { ok: false, status: 400, async text() { return 'Invalid recipient 27821234567 with code 123456'; } }
      : { ok: true, status: 200, async json() { return { creditBalance: 5 }; } };
  } });
  await assert.rejects(gateway.send({ mobile: '27821234567', code: '123456' }), error => {
    const logged = JSON.stringify(safeGatewayFailure(error));
    assert.deepEqual(JSON.parse(logged), { category: 'recipient', providerStatus: 400, balanceCheck: 'account_ok' });
    assert.doesNotMatch(logged, /27821234567|123456|private-token/);
    return true;
  });
  assert.equal(requests[1].url.endsWith('/account/balance.json'), true);
  assert.equal(requests[1].options.headers.token, 'private-token');
});

test('SMS remains gated when only the Render secrets exist', async () => {
  const h = makeHarness();
  const service = createClientSmsAuthService({ db: { async connect() { throw new Error('must not connect'); } },
    sessionService: { issueVerifiedSmsSession() {} }, env: { SMSMESSENGER_ACCOUNT_EMAIL: 'x', SMSMESSENGER_API_TOKEN: 'y' },
    gateway: { enabled: () => true } });
  assert.deepEqual(await service.start({ mobile: '0821234567', name: 'Jane Client' }), { ok: false, code: 'SMS_DISABLED' });
  assert.equal(h.issued(), 0);
});

test('SMS requires exact mobile proof, single use and at most five guesses', async () => {
  const h = makeHarness();
  const started = await h.service.start({ mobile: '082 123 4567', name: 'Jane Client', requestFingerprintHash: fingerprint });
  assert.equal(started.ok, true);
  assert.equal(h.sent.mobile, '27821234567');
  assert.equal(h.challenge.normalized_mobile, '27821234567');
  assert.equal(h.challenge.code_hash, crypto.createHash('sha256').update(`${started.browserToken}:${h.sent.code}`).digest('hex'));
  assert.equal(JSON.stringify(h.queries).includes(h.sent.code), false);
  assert.deepEqual(await h.service.finish({ browserToken: started.browserToken, code: '000000' }),
    { ok: false, code: 'SMS_INVALID_CODE' });
  assert.equal(h.issued(), 0);
  const signedIn = await h.service.finish({ browserToken: started.browserToken, code: h.sent.code });
  assert.equal(signedIn.ok, true);
  assert.equal(h.verified(), 1);
  assert.equal(h.issued(), 1);
  assert.deepEqual(await h.service.finish({ browserToken: started.browserToken, code: h.sent.code }),
    { ok: false, code: 'SMS_INVALID_CODE' });

  const wrong = makeHarness();
  const start = await wrong.service.start({ mobile: '0821234567', name: 'Jane Client' });
  for (let i = 0; i < 5; i += 1) await wrong.service.finish({ browserToken: start.browserToken, code: '000000' });
  assert.equal(wrong.challenge.revoked_at instanceof Date, true);
  assert.equal(wrong.issued(), 0);
});

test('SMS provider failure revokes the challenge and ambiguous CRM ownership never issues a session', async () => {
  const unavailable = makeHarness({ sendFails: true });
  assert.deepEqual(await unavailable.service.start({ mobile: '0821234567', name: 'Jane Client' }),
    { ok: false, code: 'SMS_UNAVAILABLE' });
  assert.equal(unavailable.challenge.revoked_at instanceof Date, true);
  assert.deepEqual(JSON.parse(unavailable.warnings[0]), {
    event: 'my_shiloh_sms_send_failed', category: 'provider_response', providerStatus: null,
  });
  assert.doesNotMatch(unavailable.warnings[0], /0821234567|123456|provider down/);
  const ambiguous = makeHarness({ owner: { status: 'conflict' } });
  const start = await ambiguous.service.start({ mobile: '0821234567', name: 'Jane Client' });
  assert.deepEqual(await ambiguous.service.finish({ browserToken: start.browserToken, code: ambiguous.sent.code }),
    { ok: false, code: 'SMS_PROFILE_UNAVAILABLE' });
  assert.equal(ambiguous.issued(), 0);
});

test('daily SMS budgets reject repeated requests before gateway delivery and serialize concurrent sends', async () => {
  for (const limits of [{ mobileDayCount: 6 }, { clinicDayCount: 50 }]) {
    const h = makeHarness(limits);
    assert.deepEqual(await h.service.start({ mobile: '0821234567', name: 'Jane Client' }),
      { ok: false, code: 'SMS_RATE_LIMITED' });
    assert.equal(h.sent, undefined);
    assert.equal(h.queries.some(({ sql }) => sql.includes('my-shiloh-sms-daily-budget')), true);
    assert.equal(h.queries.some(({ sql }) => sql.includes('INSERT INTO client_sms_auth_challenges')), false);
  }
  const h = makeHarness({ clinicDayCount: 39 });
  assert.equal((await h.service.start({ mobile: '0821234567', name: 'Jane Client' })).ok, true);
  assert.deepEqual(JSON.parse(h.warnings[0]), {
    event: 'my_shiloh_sms_daily_budget_near_limit', sends: 40, limit: 50,
  });
});

test('verified SMS forwards explicit remembered choice after exact identity proof', async () => {
  for (const keepSignedIn of [true, false]) {
    const h = makeHarness();
    const start = await h.service.start({ mobile: '0821234567', name: 'Synthetic Client' });
    assert.equal((await h.service.finish({ browserToken: start.browserToken, code: h.sent.code, keepSignedIn })).ok, true);
    assert.equal(h.remembered(), keepSignedIn);
  }
});
