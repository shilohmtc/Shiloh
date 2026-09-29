const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sessionModule = require('../src/services/staffBrowserSession');
const sessionMiddleware = require('../src/middleware/staffBrowserSession');
const challengeDelivery = require('../src/services/staffBrowserChallengeDelivery');

function deterministicRandom() {
  let n = 1;
  return (size) => {
    const value = Buffer.alloc(size, n);
    n = (n + 1) % 255 || 1;
    return value;
  };
}

function scriptedClient(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [], rowCount: 0 };
    },
    release() {},
  };
}

function scriptedDb({ direct = [], transaction = [] } = {}) {
  const directClient = scriptedClient(direct);
  const txClient = scriptedClient(transaction);
  return {
    calls: directClient.calls,
    txCalls: txClient.calls,
    query: directClient.query.bind(directClient),
    async connect() { return txClient; },
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function mockRequest({
  headers = {},
  protocol = 'https',
  ip = '127.0.0.1',
} = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: lower,
    protocol,
    ip,
    get(name) { return lower[String(name).toLowerCase()]; },
  };
}

test('session token and challenge helpers are high-entropy-shaped and hashed', () => {
  const random = deterministicRandom();
  const token = sessionModule.randomOpaqueToken(random);
  const code = sessionModule.randomChallengeCode(random);
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(code.length, 10);
  assert.equal(sessionModule.isValidChallengeCode(code), true);
  assert.match(sessionModule.sha256(token), /^[0-9a-f]{64}$/);
});

test('calendar viewer authority is derived only from current canonical server authority', () => {
  assert.deepEqual(sessionModule.deriveCalendarViewer({
    id: 41,
    admin_active: true,
    business_role: 'manager',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true },
  }), { calendarScope: 'business_all_staff' });

  assert.deepEqual(sessionModule.deriveCalendarViewer({
    id: 42,
    admin_active: true,
    business_role: 'manager',
    calendar_scope: 'own',
    service_scope: 'own_services',
    permissions: {},
    staff_id: 44,
    staff_status: 'active',
  }), { calendarScope: 'business_all_staff' });

  assert.equal(sessionModule.deriveCalendarViewer({
    id: 43,
    admin_active: true,
    business_role: 'manager',
    calendar_scope: 'own',
    service_scope: 'own_services',
    permissions: { 'appointment:view': true },
    staff_id: null,
    staff_status: null,
  }), null);
  assert.equal(sessionModule.deriveCalendarViewer({
    id: 44,
    admin_active: true,
    business_role: 'manager',
    calendar_scope: 'own',
    service_scope: 'own_services',
    permissions: { 'appointment:view': true },
    staff_id: 44,
    staff_status: 'inactive',
  }), null);
});

test('retired WhatsApp challenge adapter stays dark even when the old flag is enabled', async () => {
  let calls = 0;
  const disabled = challengeDelivery.createStaffBrowserChallengeDispatcher({
    env: {},
    sendMessage: async () => { calls += 1; },
  });
  assert.equal(disabled, null);
  assert.equal(calls, 0);

  const enabled = challengeDelivery.createStaffBrowserChallengeDispatcher({
    env: { SHILOH_STAFF_BROWSER_AUTH_WHATSAPP_DELIVERY_ENABLED: 'true' },
    sendMessage: async () => { calls += 1; },
  });
  assert.equal(enabled, null);
  assert.equal(calls, 0);
});

test('challenge delivery is dark by default and performs no database query', async () => {
  const db = scriptedDb();
  const service = sessionModule.createStaffBrowserSessionService({ db });
  const result = await service.beginChallenge({ whatsapp: '+27821234567' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAFF_AUTH_DELIVERY_DISABLED');
  assert.equal(db.calls.length, 0);
  assert.equal(db.txCalls.length, 0);
});

test('authorized challenge stores only hash and dispatches plaintext only to injected provider boundary', async () => {
  let dispatched;
  const db = scriptedDb({
    direct: [
      { rows: [{ id: 7, whatsapp_number: '+27821234567' }], rowCount: 1 },
    ],
    transaction: [
      { rows: [] },
      { rows: [] },
      { rows: [{ count: 0 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [{ id: 91 }], rowCount: 1 },
      { rows: [] },
    ],
  });
  const service = sessionModule.createStaffBrowserSessionService({
    db,
    randomBytes: deterministicRandom(),
    challengeDispatcher: async (payload) => { dispatched = payload; },
    now: () => new Date('2026-08-24T12:00:00Z'),
  });
  const result = await service.beginChallenge({ whatsapp: '+27 82 123 4567', requestFingerprintHash: 'a'.repeat(64) });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.match(dispatched.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  const insert = db.txCalls.find((call) => call.sql.includes('INSERT INTO staff_browser_auth_challenges'));
  assert.ok(insert);
  assert.equal(insert.params.includes(dispatched.code), false);
  assert.equal(insert.params.includes(sessionModule.sha256(dispatched.code)), true);
});

test('challenge issuance is rate-limited without revealing account state', async () => {
  let dispatched = 0;
  const db = scriptedDb({
    direct: [{ rows: [{ id: 7, whatsapp_number: '+27821234567' }], rowCount: 1 }],
    transaction: [
      { rows: [] },
      { rows: [] },
      { rows: [{ count: sessionModule.CHALLENGE_ISSUE_LIMIT }], rowCount: 1 },
      { rows: [] },
    ],
  });
  const service = sessionModule.createStaffBrowserSessionService({
    db,
    challengeDispatcher: async () => { dispatched += 1; },
  });
  const result = await service.beginChallenge({ whatsapp: '+27821234567' });
  assert.deepEqual(result, { ok: true, accepted: true, delivered: false, rateLimited: true });
  assert.equal(dispatched, 0);
});

test('successful challenge verification consumes challenge, revokes prior sessions, and stores only token hashes', async () => {
  const random = deterministicRandom();
  const correctCode = 'ABCDEFGHJK';
  const db = scriptedDb({ transaction: [
    { rows: [] },
    { rows: [{
      id: 7,
      staff_id: 44,
      role: 'admin',
      business_role: 'manager',
      calendar_scope: 'all_business',
      service_scope: 'all_services',
      permissions: { 'appointment:view': true },
      admin_active: true,
      staff_status: 'active',
    }], rowCount: 1 },
    { rows: [] },
    { rows: [{ id: 91, challenge_hash: sessionModule.sha256(correctCode), expires_at: '2026-08-24T12:05:00Z', attempt_count: 0, max_attempts: 5 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 10 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: 11 }], rowCount: 1 },
    { rows: [] },
  ] });
  const service = sessionModule.createStaffBrowserSessionService({
    db,
    randomBytes: random,
    now: () => new Date('2026-08-24T12:01:00Z'),
  });
  const result = await service.verifyChallenge({ whatsapp: '+27821234567', code: correctCode });
  assert.equal(result.ok, true);
  assert.deepEqual(result.viewer, { calendarScope: 'business_all_staff' });
  const consume = db.txCalls.find((call) => call.sql.includes('SET consumed_at'));
  const revoke = db.txCalls.find((call) => call.sql.includes("revoke_reason = 'rotated'"));
  const insert = db.txCalls.find((call) => call.sql.includes('INSERT INTO staff_browser_sessions'));
  assert.ok(consume);
  assert.ok(revoke);
  assert.ok(insert);
  assert.equal(insert.params.includes(result.sessionToken), false);
  assert.equal(insert.params.includes(result.csrfToken), false);
  assert.equal(insert.params.includes(sessionModule.sha256(result.sessionToken)), true);
  assert.equal(insert.params.includes(sessionModule.sha256(result.csrfToken)), true);
});

test('wrong challenge attempt fails closed and increments brute-force counter', async () => {
  const db = scriptedDb({ transaction: [
    { rows: [] },
    { rows: [{ id: 7, admin_active: true }], rowCount: 1 },
    { rows: [] },
    { rows: [{ id: 91, challenge_hash: sessionModule.sha256('ABCDEFGHJK'), expires_at: '2026-08-24T12:05:00Z', attempt_count: 1, max_attempts: 5 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [] },
  ] });
  const service = sessionModule.createStaffBrowserSessionService({
    db,
    randomBytes: deterministicRandom(),
    now: () => new Date('2026-08-24T12:01:00Z'),
  });
  const result = await service.verifyChallenge({ whatsapp: '+27821234567', code: 'ZZZZZZZZZZ' });
  assert.equal(result.ok, false);
  const attempt = db.txCalls.find((call) => call.sql.includes('attempt_count = $2'));
  assert.ok(attempt);
  assert.equal(attempt.params[1], 2);
  assert.equal(db.txCalls.some((call) => call.sql.includes('INSERT INTO staff_browser_sessions')), false);
});

test('expired challenge fails closed and is revoked', async () => {
  const db = scriptedDb({ transaction: [
    { rows: [] },
    { rows: [{ id: 7, admin_active: true }], rowCount: 1 },
    { rows: [] },
    { rows: [{ id: 91, challenge_hash: sessionModule.sha256('ABCDEFGHJK'), expires_at: '2026-08-24T11:59:00Z', attempt_count: 0, max_attempts: 5 }], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [] },
  ] });
  const service = sessionModule.createStaffBrowserSessionService({ db, randomBytes: deterministicRandom(), now: () => new Date('2026-08-24T12:01:00Z') });
  const result = await service.verifyChallenge({ whatsapp: '+27821234567', code: 'ABCDEFGHJK' });
  assert.equal(result.ok, false);
  assert.equal(db.txCalls.some((call) => call.sql.includes('SET revoked_at = $2 WHERE id = $1')), true);
});

test('session validation rejects malformed tokens before database access', async () => {
  const db = scriptedDb();
  const service = sessionModule.createStaffBrowserSessionService({ db });
  const result = await service.validateSessionToken('tampered');
  assert.equal(result.ok, false);
  assert.equal(db.calls.length, 0);
});

test('session validation fails closed for revoked, expired, inactive, or scope-revoked current authority', async () => {
  for (const row of [
    { session_id: 1, admin_id: 7, csrf_hash: 'a'.repeat(64), expires_at: '2026-08-24T13:00:00Z', revoked_at: '2026-08-24T12:00:00Z', admin_active: true },
    { session_id: 1, admin_id: 7, csrf_hash: 'a'.repeat(64), expires_at: '2026-08-24T11:00:00Z', revoked_at: null, admin_active: true },
    { session_id: 1, admin_id: 7, csrf_hash: 'a'.repeat(64), expires_at: '2026-08-24T13:00:00Z', revoked_at: null, admin_active: false },
  ]) {
    const db = scriptedDb({ direct: [{ rows: [row], rowCount: 1 }] });
    const service = sessionModule.createStaffBrowserSessionService({ db, now: () => new Date('2026-08-24T12:01:00Z') });
    const token = Buffer.alloc(32, 9).toString('base64url');
    const result = await service.validateSessionToken(token);
    assert.equal(result.ok, false);
  }

  const db = scriptedDb({ direct: [
    { rows: [{ session_id: 1, admin_id: 7, csrf_hash: 'a'.repeat(64), expires_at: '2026-08-24T13:00:00Z', revoked_at: null, admin_active: true, calendar_scope: 'none', business_role: 'manager', staff_id: 44, staff_status: 'active' }], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ] });
  const service = sessionModule.createStaffBrowserSessionService({ db, now: () => new Date('2026-08-24T12:01:00Z') });
  const token = Buffer.alloc(32, 9).toString('base64url');
  const result = await service.validateSessionToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.viewer, null);
});

test('logout/revocation and CSRF validation are server-side', async () => {
  const token = Buffer.alloc(32, 5).toString('base64url');
  const db = scriptedDb({ direct: [{ rows: [{ id: 1 }], rowCount: 1 }] });
  const service = sessionModule.createStaffBrowserSessionService({ db });
  const session = { ok: true, csrfHash: sessionModule.sha256(token) };
  assert.equal(service.validateCsrfToken(session, token), true);
  assert.equal(service.validateCsrfToken(session, Buffer.alloc(32, 6).toString('base64url')), false);
  const revoked = await service.revokeSession(11, 'logout');
  assert.equal(revoked.ok, true);
  assert.equal(db.calls[0].params[2], 'logout');
});

test('production session cookie is HttpOnly Secure Strict and bounded', () => {
  const cookie = sessionMiddleware.serializeSessionCookie('opaque', { env: { NODE_ENV: 'production' }, maxAgeSeconds: 3600 });
  assert.match(cookie, /^__Host-shiloh_staff_session=opaque;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=3600/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test('duplicate/tampered cookie values fail closed', () => {
  assert.equal(sessionMiddleware.parseCookieValue('a=1; shiloh_staff_session=one', 'shiloh_staff_session'), 'one');
  assert.equal(sessionMiddleware.parseCookieValue('shiloh_staff_session=one; shiloh_staff_session=two', 'shiloh_staff_session'), null);
});

test('same-origin guard rejects cross-site and non-JSON state changes', () => {
  const guard = sessionMiddleware.sameOriginGuard({ env: { NODE_ENV: 'production' } });
  let nextCalled = false;
  let res = mockResponse();
  guard(mockRequest({ headers: { origin: 'https://evil.example', host: 'shiloh.example', 'content-type': 'application/json' } }), res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);

  res = mockResponse();
  guard(mockRequest({ headers: { origin: 'https://shiloh.example', host: 'shiloh.example', 'content-type': 'text/plain' } }), res, () => {});
  assert.equal(res.statusCode, 415);
});

test('same-origin guard accepts production HTTPS same-origin JSON', () => {
  const guard = sessionMiddleware.sameOriginGuard({ env: { NODE_ENV: 'production' } });
  let nextCalled = false;
  const res = mockResponse();
  guard(mockRequest({ headers: {
    origin: 'https://shiloh.example',
    host: 'shiloh.example',
    'x-forwarded-proto': 'https',
    'content-type': 'application/json; charset=utf-8',
    'sec-fetch-site': 'same-origin',
  } }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('calendar bridge is default-off and only trusted middleware can establish server viewer context', async () => {
  const symbol = Symbol.for('shiloh.calendar.server.viewer');
  const service = {
    async validateSessionToken() {
      return { ok: true, viewer: { calendarScope: 'business_all_staff' }, sessionId: 1 };
    },
  };
  const req = mockRequest({ headers: { cookie: 'shiloh_staff_session=' + Buffer.alloc(32, 9).toString('base64url') } });
  const res = mockResponse();
  const off = sessionMiddleware.createOptionalCalendarSessionMiddleware({ service, env: {} });
  await off(req, res, () => {});
  assert.equal(req[symbol], undefined);

  const on = sessionMiddleware.createOptionalCalendarSessionMiddleware({ service, env: { SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' } });
  await on(req, res, () => {});
  assert.deepEqual(req[symbol], {
    authenticated: true,
    source: 'server_staff_session',
    viewer: { calendarScope: 'business_all_staff' },
  });
});

test('browser-supplied staffId/calendarScope cannot establish Calendar viewer authority', async () => {
  const symbol = Symbol.for('shiloh.calendar.server.viewer');
  const service = { async validateSessionToken() { return { ok: false }; } };
  const req = mockRequest({ headers: { cookie: 'shiloh_staff_session=tampered', staffid: '999', calendarscope: 'business_all_staff' } });
  req.query = { staffId: '999', calendarScope: 'business_all_staff' };
  const middleware = sessionMiddleware.createOptionalCalendarSessionMiddleware({ service, env: { SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' } });
  await middleware(req, mockResponse(), () => {});
  assert.equal(req[symbol], undefined);
});

test('new browser-session surface never references shared ADMIN_API_KEY and never accepts raw browser authority claims', () => {
  const files = [
    'src/services/staffBrowserSession.js',
    'src/middleware/staffBrowserSession.js',
    'src/routes/staffBrowserSession.js',
    'src/services/staffBrowserChallengeDelivery.js',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key/i);
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src/routes/staffBrowserSession.js'), 'utf8');
  assert.doesNotMatch(routeSource, /req\.body\?\.(staffId|business_role|calendarScope|role|practitioner)/);
});

test('migration stores hashes, bounded expiry/revocation metadata, and no plaintext secret columns', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/078_staff_browser_sessions.sql'), 'utf8');
  assert.match(migration, /challenge_hash TEXT NOT NULL/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /csrf_hash TEXT NOT NULL/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /revoked_at TIMESTAMPTZ/);
  assert.match(migration, /attempt_count INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration, /\b(session_token|challenge_code|plaintext|password)\s+TEXT\b/i);
});

test('Calendar remains feature-gated, ICS route remains intact, and staff bridge has its own default-off gate', () => {
  const calendarRoute = fs.readFileSync(path.join(__dirname, '..', 'src/routes/calendar.js'), 'utf8');
  const readOnlyRoutePath = path.join(__dirname, '..', 'src/routes/calendarReadOnlyUx.js');
  if (fs.existsSync(readOnlyRoutePath)) {
    const readOnlyRoute = fs.readFileSync(readOnlyRoutePath, 'utf8');
    assert.match(readOnlyRoute, /SHILOH_CALENDAR_READONLY_UX_ENABLED/);
  }
  assert.match(calendarRoute, /router\.get\('\/:token\.ics'/);
  assert.match(calendarRoute, /createOptionalCalendarSessionMiddleware/);
  const middlewareSource = fs.readFileSync(path.join(__dirname, '..', 'src/middleware/staffBrowserSession.js'), 'utf8');
  assert.match(middlewareSource, /SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED/);
});
