'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createClientBrowserSessionService, SESSION_TTL_MS, REMEMBERED_SESSION_TTL_MS } = require('../src/services/clientBrowserSession');
const { recentClientSession } = require('../src/services/clientPasskeyEnrollment');
const { serializeClientSessionCookie } = require('../src/middleware/clientBrowserSession');

async function harness(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE crm_v2_clients (id BIGINT PRIMARY KEY, name TEXT, status TEXT, normalized_mobile TEXT);
    INSERT INTO crm_v2_clients VALUES (17, 'Synthetic One', 'active', '27821234567'), (18, 'Synthetic Two', 'active', '27821234568');`);
  await pg.exec(fs.readFileSync('migrations/136_my_shiloh_client_browser_sessions.sql', 'utf8'));
  await pg.exec('ALTER TABLE client_browser_sessions ADD COLUMN passkey_credential_id BIGINT');
  let current = new Date('2026-10-08T16:28:00Z');
  const queries = [];
  const db = { async query(sql, params) {
    queries.push(sql);
    const r = await pg.query(sql, params);
    return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
  } };
  const service = createClientBrowserSessionService({ db, now: () => current });
  const issue = async (method, keepSignedIn, id = 17) => {
    await db.query('BEGIN');
    const result = await service[method]({ transaction: db, crmV2ClientId: id, passkeyCredentialId: 99,
      normalizedMobile: id === 17 ? '27821234567' : '27821234568', keepSignedIn });
    await db.query('COMMIT');
    return result;
  };
  return { db, service, issue, queries, at: () => current, advance: ms => { current = new Date(current.getTime() + ms); } };
}

for (const method of ['issueVerifiedSmsSession', 'issueVerifiedPasskeySession', 'issueVerifiedRecoverySession']) {
  test(`${method}: explicit 30 days, seven-day default, fixed deadline, exact expiry and recent auth`, async t => {
    const h = await harness(t);
    for (const choice of [undefined, false, 'true', 1, true]) {
      const start = h.at().getTime();
      const result = await h.issue(method, choice);
      const ttl = choice === true ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS;
      assert.equal(ttl, (choice === true ? 30 : 7) * 86400000);
      assert.equal(result.expiresAt.getTime(), start + ttl);
      const fresh = await h.service.validateSessionToken(result.sessionToken);
      assert.equal(fresh.ok, true);
      assert.equal(recentClientSession(fresh, h.at()), true);
      assert.equal(h.service.validateCsrfToken(fresh, result.csrfToken), true);
      h.advance(600001);
      const old = await h.service.validateSessionToken(result.sessionToken);
      assert.equal(old.ok, true);
      assert.equal(recentClientSession(old, h.at()), false);
      await h.service.rotateCsrfToken(old.sessionId);
      const row = (await h.db.query('SELECT issued_at, expires_at, reauthenticated_at FROM client_browser_sessions WHERE id=$1', [old.sessionId])).rows[0];
      assert.equal(new Date(row.expires_at).getTime(), start + ttl);
      assert.equal(new Date(row.reauthenticated_at).getTime(), start);
      h.advance(ttl - 600002);
      assert.equal((await h.service.validateSessionToken(result.sessionToken)).ok, true);
      h.advance(1);
      assert.equal((await h.service.validateSessionToken(result.sessionToken)).ok, false);
      assert.equal((await h.service.rotateCsrfToken(result.sessionId)).ok, false);
    }
  });
}

test('fresh sign-out-other-sessions closes SMS, passkey and recovery for only this owner; logout closes current session', async t => {
  const h = await harness(t);
  const current = await h.issue('issueVerifiedSmsSession', true);
  const others = [];
  for (const method of ['issueVerifiedSmsSession', 'issueVerifiedPasskeySession', 'issueVerifiedRecoverySession']) others.push(await h.issue(method, true));
  const differentClient = await h.issue('issueVerifiedSmsSession', true, 18);
  const session = await h.service.validateSessionToken(current.sessionToken);
  assert.deepEqual(await h.service.revokeOtherSessions(session), { ok: true });
  for (const other of others) assert.equal((await h.service.validateSessionToken(other.sessionToken)).ok, false);
  assert.equal((await h.service.validateSessionToken(current.sessionToken)).ok, true);
  assert.equal((await h.service.validateSessionToken(differentClient.sessionToken)).ok, true);
  const newOther = await h.issue('issueVerifiedSmsSession', true);
  h.advance(600001);
  assert.equal((await h.service.revokeOtherSessions(session)).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  assert.equal((await h.service.validateSessionToken(newOther.sessionToken)).ok, true);
  // A forged fresh timestamp cannot bypass the stored recent-auth check.
  assert.equal((await h.service.revokeOtherSessions({ ...session, authenticatedAt: h.at() })).ok, false);
  await h.service.revokeSession(current.sessionId);
  assert.equal((await h.service.validateSessionToken(current.sessionToken)).ok, false);
});

test('revoked authorizing session cannot sign out others even with a previously valid session object', async t => {
  const h = await harness(t);
  const a = await h.issue('issueVerifiedSmsSession', true);
  const b = await h.issue('issueVerifiedSmsSession', true);
  const snapshot = await h.service.validateSessionToken(a.sessionToken);
  await h.service.revokeSession(a.sessionId);
  assert.equal((await h.service.revokeOtherSessions(snapshot)).ok, false);
  assert.equal((await h.service.validateSessionToken(b.sessionToken)).ok, true);
});

test('session cookie retains production protections and cannot outlive thirty days', () => {
  const env = { NODE_ENV: 'production' };
  for (const maxAgeSeconds of [604800, 2592000, Infinity, 9999999]) {
    const cookie = serializeClientSessionCookie('synthetic', { env, maxAgeSeconds });
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Domain=/);
    assert.ok(Number(cookie.match(/Max-Age=(\d+)/)[1]) <= 2592000);
  }
});

// Execute each production route with synthetic service doubles, never a gateway or client account.
test('SMS/passkey/recovery route opt-in, private cookie expiry, CSRF and fresh-auth revocation', async t => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const seen = [];
  let recent = true;
  let loggedOut = false;
  const auth = async input => {
    seen.push(input);
    return { ok: true, sessionToken: crypto.randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + (input.keepSignedIn ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS)),
      client: { id: '17', firstName: 'Synthetic' } };
  };
  const app = express(); app.use(express.json());
  app.use(createMyShilohRouter({ env: { NODE_ENV: 'test' },
    sessionService: { async validateSessionToken(token) { return token === 'synthetic' && !loggedOut ? { ok: true, sessionId: 1, crmV2ClientId: 17 } : { ok: false }; },
      validateCsrfToken(_session, token) { return token === 'synthetic-csrf'; },
      async revokeOtherSessions() { return { ok: recent }; },
      async revokeSession() { loggedOut = true; return { ok: true }; } },
    assistantService: { async clearConversation() {} }, actionService: { async revokeSessionActions() {} },
    smsAuthService: { finish: auth }, passkeyAuthenticationService: { finish: auth }, passkeyRecoveryService: { redeem: auth },
    voucherService: { async syncRecipientLinks() {} },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, headers = {}) {
    return fetch(origin + '/my-shiloh/auth/' + path, { method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  }
  for (const path of ['sms/complete', 'passkeys/sign-in/finish', 'passkeys/recovery/use']) {
    for (const choice of [true, false, 'true', undefined]) {
      const r = await post(path, { keepSignedIn: choice });
      assert.equal(r.status, 200);
      assert.equal(seen.at(-1).keepSignedIn, choice === true);
      assert.match(r.headers.get('cache-control'), /no-store/);
      const seconds = Number(r.headers.get('set-cookie').match(/shiloh_client_session=[^;]+; Path=\/; Max-Age=(\d+)/)[1]);
      assert.ok(seconds <= (choice === true ? 30 : 7) * 86400);
      assert.ok(seconds >= (choice === true ? 30 : 7) * 86400 - 2);
    }
  }
  assert.equal((await post('sessions/revoke-others', {})).status, 401);
  assert.equal((await post('sessions/revoke-others', {}, { cookie: 'shiloh_client_session=synthetic' })).status, 403);
  const headers = { cookie: 'shiloh_client_session=synthetic', 'x-shiloh-csrf-token': 'synthetic-csrf' };
  assert.equal((await post('sessions/revoke-others', {}, headers)).status, 200);
  recent = false;
  assert.equal((await post('sessions/revoke-others', {}, headers)).status, 428);
  assert.equal((await post('sessions/revoke-others', {}, { ...headers, origin: 'https://foreign.example.test' })).status, 403);
  const logout = await post('logout', {}, headers);
  assert.equal(logout.status, 204);
  const cookies = logout.headers.get('set-cookie');
  for (const name of ['shiloh_client_session', 'shiloh_client_auth', 'shiloh_client_sms_auth', 'shiloh_client_passkey_auth']) {
    assert.ok(cookies.includes(`${name}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly`));
  }
  assert.equal((await post('sessions/revoke-others', {}, headers)).status, 401);
});
