'use strict';
// All records here are synthetic; no production DB, client, provider or SMS is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {
  createClientCrmDetailAuthService,
  details,
  matches,
  networkGroup,
  WINDOW_MS,
} = require('../src/services/clientCrmDetailAuth');
const {
  createClientBrowserSessionService,
  SESSION_TTL_MS,
} = require('../src/services/clientBrowserSession');
const {
  recentClientSession,
  createClientPasskeyEnrollmentService,
} = require('../src/services/clientPasskeyEnrollment');
const { createClientPasskeyRecoveryService } = require('../src/services/clientPasskeyRecovery');
const {
  createMyShilohProfileService,
  profileRevision,
} = require('../src/services/myShilohProfile');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const synthetic = {
  firstName: 'Synthetic',
  surname: 'Example',
  mobile: '0820000001',
  dateOfBirth: '2000-01-01',
  gender: 'prefer_not_to_say',
};
const env = {
  MY_SHILOH_CRM_AUTH_ENABLED: 'true',
  MY_SHILOH_CRM_AUTH_RATE_KEY: 'synthetic-test-key-only'.repeat(3),
  SHILOH_CLIENT_PASSKEY_AUTH_ENABLED: 'true',
};
async function harness(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE appointments (id BIGINT PRIMARY KEY, status TEXT);');
  await pg.exec(fs.readFileSync('migrations/084_clean_crm_v2_foundation.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/136_my_shiloh_client_browser_sessions.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/173_my_shiloh_client_passkeys.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/174_my_shiloh_passkey_devices.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/177_my_shiloh_passkey_credential_id_check.sql', 'utf8'));
  await pg.exec("ALTER TABLE client_auth_passkey_challenges ALTER COLUMN created_at SET DEFAULT TIMESTAMPTZ '2026-10-09T06:00:00Z'");
  await pg.exec(fs.readFileSync('migrations/189_client_crm_detail_auth.sql', 'utf8'));
  let current = new Date('2026-10-09T06:00:00Z');
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push(sql);
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
    async connect() {
      return { query: db.query, release() {} };
    },
  };
  const sessions = createClientBrowserSessionService({ db, now: () => current });
  const auth = createClientCrmDetailAuthService({
    db,
    sessionService: sessions,
    env,
    now: () => current,
  });
  const attempt = (input = synthetic, register = false, extra = {}) =>
    auth.attempt({ input, register, address: '192.0.2.1', deviceToken: 'A'.repeat(43), ...extra });
  const insert = async (patch = {}) => {
    const d = { ...synthetic, ...patch };
    return (
      await db.query(
        `INSERT INTO crm_v2_clients(name,normalized_mobile,date_of_birth,gender,profile_status,source,status)
      VALUES($1,$2,$3,$4,'minimal','synthetic','active') RETURNING *`,
        [
          `${d.firstName} ${d.surname}`,
          details(d, false).mobile,
          patch.missingDob ? null : d.dateOfBirth,
          d.gender,
        ],
      )
    ).rows[0];
  };
  return {
    db,
    queries,
    sessions,
    auth,
    attempt,
    insert,
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

test('strict tuple, Unicode/spacing and SA input normalization; no fuzzy, foreign or missing DOB match', () => {
  for (const mobile of ['0820000001', '+27 82 000 0001', '0027820000001'])
    assert.equal(details({ ...synthetic, mobile }, false).mobile, '27820000001');
  for (const mobile of ['+44 7700 000000', 'x0820000001', '082000000', '08200000010'])
    assert.equal(details({ ...synthetic, mobile }, false), null);
  for (const dateOfBirth of ['', '2000-02-30', '1899-12-31', '2999-01-01'])
    assert.equal(details({ ...synthetic, dateOfBirth }, false), null);
  const d = details(synthetic, false);
  const row = {
    status: 'active',
    name: ' Synthetic   Example ',
    normalized_mobile: d.mobile,
    date_of_birth: d.dateOfBirth,
  };
  assert.equal(matches(row, d), true);
  assert.equal(matches({ ...row, name: 'Synthetic E' }, d), false);
  assert.equal(matches({ ...row, date_of_birth: null }, d), false);
  assert.equal(matches({ ...row, first_name: 'Synthetic Example', surname: 'Other' }, d), false);
  assert.equal(networkGroup('2001:db8:1:2::1'), networkGroup('2001:db8:1:2::99'));
  assert.notEqual(networkGroup('2001:db8:1:3::1'), networkGroup('2001:db8:1:2::1'));
});

test('CRM match has fixed 30 days, never verifies phone or changes CRM; mounted account changes use remembered sessions; retired recovery keeps its old gate', async (t) => {
  const h = await harness(t);
  const owner = await h.insert();
  const result = await h.attempt();
  assert.equal(result.ok, true);
  assert.equal(result.expiresAt - h.now(), SESSION_TTL_MS);
  const session = await h.sessions.validateSessionToken(result.sessionToken);
  assert.equal(session.authMethod, 'crm_details');
  assert.equal(session.assurance, 'biographical_match');
  assert.equal(recentClientSession(session, h.now()), false);
  assert.equal((await h.sessions.revokeOtherSessions(session)).ok, true);
  const enroll = createClientPasskeyEnrollmentService({ db: h.db, env, now: h.now });
  assert.equal((await enroll.begin({ session })).ok, true);
  assert.equal((await enroll.finish({ session })).code, 'CLIENT_PASSKEY_INVALID');
  assert.equal((await enroll.revoke({ session, credentialId: 1 })).code, 'CLIENT_PASSKEY_INVALID');
  const recovery = createClientPasskeyRecoveryService({ db: h.db, env, now: h.now });
  assert.equal((await recovery.create({ session })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  const profiles = createMyShilohProfileService({ db: h.db, now: h.now });
  assert.equal((await profiles.updateProfile({sessionId:session.sessionId,crmV2ClientId:owner.id,
    expectedRevision:profileRevision(owner),name:owner.name,dateOfBirth:synthetic.dateOfBirth,gender:synthetic.gender})).status,'unchanged');
  assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients')).rows[0], owner);
  const start = h.now().getTime();
  h.advance(SESSION_TTL_MS - 1);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok, true);
  await h.sessions.rotateCsrfToken(session.sessionId);
  assert.equal(
    new Date(
      (await h.db.query('SELECT expires_at FROM client_browser_sessions')).rows[0].expires_at,
    ).getTime(),
    start + SESSION_TTL_MS,
  );
  h.advance(1);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok, false);
});

test('mandatory registration records explicit names, unverified phone; repeated registration reuses owner, ignores conflicting gender', async (t) => {
  const h = await harness(t);
  const first = await h.attempt(synthetic, true);
  assert.equal(first.ok, true);
  const row = (await h.db.query('SELECT * FROM crm_v2_clients')).rows[0];
  assert.equal(row.first_name, synthetic.firstName);
  assert.equal(row.surname, synthetic.surname);
  assert.equal(row.mobile_verified_at, null);
  assert.equal(row.provenance.phoneOwnershipVerified, false);
  const second = await h.attempt({ ...synthetic, gender: 'other' }, true);
  assert.equal(second.client.id, first.client.id);
  assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients')).rows[0], row);
  assert.equal((await h.attempt({ ...synthetic, mobile: '0820000002' }, true)).ok, false);
  assert.equal(
    (await h.db.query('SELECT COUNT(*)::int AS count FROM crm_v2_clients')).rows[0].count,
    1,
  );
});

test('wrong details, missing DOB, archived collision and malformed registration give generic failure with no overwrite or auto-registration', async (t) => {
  const h = await harness(t);
  const row = await h.insert({ missingDob: true });
  for (const input of [
    synthetic,
    { ...synthetic, surname: 'Typo' },
    { ...synthetic, gender: '' },
  ]) {
    const result = await h.attempt(input, true);
    assert.equal(result.code, 'CRM_AUTH_INVALID');
    h.advance(60000);
  }
  await h.db.query("UPDATE crm_v2_clients SET status='archived' WHERE id=$1", [row.id]);
  assert.equal((await h.attempt(synthetic, true)).code, 'CRM_AUTH_INVALID');
  assert.equal(
    (await h.db.query('SELECT COUNT(*)::int AS count FROM crm_v2_clients')).rows[0].count,
    1,
  );
  const logs = (
    await h.db.query('SELECT metadata,crm_v2_client_id FROM client_auth_security_events')
  ).rows;
  assert.ok(logs.every((e) => e.crm_v2_client_id === null));
  assert.ok(!JSON.stringify(logs).includes(synthetic.mobile));
});

test('ambiguous owners fail closed, and a failed sign-in never creates a client', async (t) => {
  const h = await harness(t);
  await h.db.query('DROP INDEX uq_crm_v2_clients_active_mobile');
  await h.insert();
  await h.insert();
  assert.equal((await h.attempt()).code, 'CRM_AUTH_INVALID');
  const empty = await h.attempt({ ...synthetic, mobile: '0820000003' });
  assert.equal(empty.code, 'CRM_AUTH_INVALID');
  assert.equal(
    (await h.db.query('SELECT COUNT(*)::int AS count FROM crm_v2_clients')).rows[0].count,
    2,
  );
});

test('shared persistent identity/network limits survive a new service, device deletion, and UA rotation; backoff/reset bounded', async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 6; i++) {
    assert.equal((await h.attempt()).code, 'CRM_AUTH_INVALID');
    h.advance(60000);
  }
  const restarted = createClientCrmDetailAuthService({
    db: h.db,
    env,
    sessionService: h.sessions,
    now: h.now,
  });
  assert.equal(
    (
      await restarted.attempt({
        input: synthetic,
        address: '192.0.2.2',
        deviceToken: 'B'.repeat(43),
      })
    ).code,
    'CRM_AUTH_RATE_LIMITED',
  );
  h.advance(WINDOW_MS);
  assert.equal((await h.attempt()).code, 'CRM_AUTH_INVALID');
  await h.attempt();
  await h.attempt();
  assert.equal((await h.attempt()).code, 'CRM_AUTH_RATE_LIMITED');
  assert.ok(
    (await h.db.query('SELECT bucket_key FROM client_crm_auth_rate_buckets')).rows.every((row) =>
      /^[a-f0-9]{64}$/.test(row.bucket_key),
    ),
  );
});

test('logout revokes only current CRM session; stronger proof can revoke other CRM sessions across clients safely', async (t) => {
  const h = await harness(t);
  const owner = await h.insert();
  const first = await h.attempt();
  const second = await h.attempt();
  await h.sessions.revokeSession(first.sessionId);
  assert.equal((await h.sessions.validateSessionToken(first.sessionToken)).ok, false);
  assert.equal((await h.sessions.validateSessionToken(second.sessionToken)).ok, true);
  const strong = await h.sessions.issueVerifiedSmsSession({
    transaction: h.db,
    crmV2ClientId: owner.id,
    normalizedMobile: '27820000001',
  });
  const strongSession = await h.sessions.validateSessionToken(strong.sessionToken);
  assert.equal(recentClientSession(strongSession, h.now()), true);
  assert.equal((await h.sessions.revokeOtherSessions(strongSession)).ok, true);
  assert.equal((await h.sessions.validateSessionToken(second.sessionToken)).ok, false);
  assert.equal((await h.sessions.validateSessionToken(strong.sessionToken)).ok, true);
});

test('registration fields and lower assurance settings distinguish proof; feature disabled without configured key', async (t) => {
  const h = await harness(t);
  assert.equal(
    createClientCrmDetailAuthService({
      db: h.db,
      sessionService: h.sessions,
      env: { ...env, MY_SHILOH_CRM_AUTH_RATE_KEY: '' },
    }).enabled(),
    false,
  );
  const html = renderMyShilohPage({ crmAvailable: true, passkeysAvailable: true });
  for (const field of ['firstName', 'surname', 'dateOfBirth', 'mobile'])
    assert.match(html, new RegExp(`name="${field}"`));
  assert.match(html, /Prefer not to say/);
  assert.match(html, /Use a saved passkey/);
  const signed = renderMyShilohPage({
    client: { id: 1, name: 'Synthetic Example', firstName: 'Synthetic' },
    crmAvailable: true,
    passkeysAvailable: true,
    signInMethod: 'crm_details',
  });
  assert.match(signed, /Signed in with your Shiloh details/);
  assert.doesNotMatch(signed, /data-client-sms|data-passkey-recovery|Your recovery code|CRM details/);
  assert.doesNotMatch(signed, /data-client-setup hidden/);
});

test('stored assurance/revocation is rechecked: pretending a CRM timestamp is verified cannot authorize security mutations', async (t) => {
  const h = await harness(t);
  await h.insert();
  const result = await h.attempt();
  const actual = await h.sessions.validateSessionToken(result.sessionToken);
  const forged = { ...actual, authMethod: 'sms_code' };
  const enroll = createClientPasskeyEnrollmentService({ db: h.db, env, now: h.now });
  assert.equal((await enroll.begin({ session: forged })).ok, true); // First key needs no fresh assurance.
  assert.equal(
    (await enroll.revoke({ session: forged, credentialId: 1 })).code,
    'CLIENT_PASSKEY_INVALID',
  );
  const recovery = createClientPasskeyRecoveryService({ db: h.db, env, now: h.now });
  assert.equal((await recovery.create({ session: forged })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  assert.equal((await h.sessions.revokeOtherSessions(forged)).ok, true);
  for (const authMethod of [undefined, 'unknown', 'crm_details'])
    assert.equal(recentClientSession({ ...actual, authMethod }, h.now()), false);
});

test('current-client ownership protects revocation and CSRF across unrelated CRM clients', async (t) => {
  const h = await harness(t);
  await h.insert();
  const first = await h.attempt();
  const other = { ...synthetic, firstName: 'Syntheticother', mobile: '0820000002' };
  const owner = await h.insert(other);
  const second = await h.attempt(other);
  assert.notEqual(first.client.id, second.client.id);
  assert.equal(
    h.sessions.validateCsrfToken(
      await h.sessions.validateSessionToken(second.sessionToken),
      first.csrfToken,
    ),
    false,
  );
  const strong = await h.sessions.issueVerifiedSmsSession({
    transaction: h.db,
    crmV2ClientId: owner.id,
    normalizedMobile: '27820000002',
  });
  await h.sessions.revokeOtherSessions(await h.sessions.validateSessionToken(strong.sessionToken));
  assert.equal((await h.sessions.validateSessionToken(second.sessionToken)).ok, false);
  assert.equal((await h.sessions.validateSessionToken(first.sessionToken)).ok, true);
});

test('CRM HTTP flow rejects cross-origin and unknown fields, sends protected cookies and keeps API ownership server-side', async (t) => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const h = await harness(t);
  const owner = await h.insert();
  const app = express();
  app.use(express.json());
  const observed = [];
  app.use(
    createMyShilohRouter({
      env,
      sessionService: h.sessions,
      crmAuthService: h.auth,
      experienceService: {
        async getExperience(input) {
          observed.push(input);
          return { synthetic: true };
        },
      },
      voucherService: { async syncRecipientLinks() {} },
      assistantService: { async clearConversation() {} },
      actionService: { async revokeSessionActions() {} },
      smsAuthService: { enabled: () => false },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (payload, origin = base) =>
    fetch(`${base}/my-shiloh/auth/crm/sign-in`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  const { gender, ...input } = synthetic;
  assert.equal((await post(input, 'https://example.invalid')).status, 403);
  assert.equal((await post({ ...input, crmV2ClientId: 999 })).status, 401);
  const good = await post(input);
  assert.equal(good.status, 200);
  assert.match(good.headers.get('cache-control'), /private, no-store/);
  const cookie = good.headers
    .getSetCookie()
    .find((value) => value.startsWith('shiloh_client_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=\d+/);
  const response = await fetch(`${base}/my-shiloh/api/experience?crmV2ClientId=999`, {
    headers: { cookie: cookie.split(';')[0] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(observed, [{ crmV2ClientId: Number(owner.id) }]);
  const csrfSession = await h.sessions.validateSessionToken(cookie.split(';')[0].split('=')[1]);
  const csrf = await h.sessions.rotateCsrfToken(csrfSession.sessionId);
  const reenter = (headers = {}, body = input) => fetch(`${base}/my-shiloh/auth/crm/reauthenticate`, {
    method: 'POST', headers: {origin: base, 'content-type': 'application/json', ...headers}, body: JSON.stringify(body)
  });
  assert.equal((await reenter()).status, 401);
  assert.equal((await reenter({cookie: cookie.split(';')[0]})).status, 403);
  const reentryHeaders = {cookie: cookie.split(';')[0], 'x-shiloh-csrf-token': csrf.csrfToken};
  assert.equal((await reenter({...reentryHeaders, origin: 'https://foreign.invalid'})).status, 403);
  h.advance(1000);
  const refreshed = await reenter(reentryHeaders);
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).reauthenticated, true);
  assert.ok(refreshed.headers.getSetCookie().every(value => !value.startsWith('shiloh_client_session=')));

  assert.equal(
    (
      await fetch(`${base}/my-shiloh/auth/logout`, {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json', cookie: cookie.split(';')[0] },
        body: '{}',
      })
    ).status,
    403,
  );
  const logout = await fetch(`${base}/my-shiloh/auth/logout`, {
    method: 'POST',
    headers: {
      origin: base,
      'content-type': 'application/json',
      cookie: cookie.split(';')[0],
      'x-shiloh-csrf-token': csrf.csrfToken,
    },
    body: '{}',
  });
  assert.equal(logout.status, 204);
  assert.ok(logout.headers.getSetCookie().every((value) => value.includes('Max-Age=0')));
  assert.equal(
    (await h.sessions.validateSessionToken(cookie.split(';')[0].split('=')[1])).ok,
    false,
  );
});

test('network and daily budgets apply across distinct devices and changing submitted details', async (t) => {
  const h = await harness(t);
  for (let index = 0; index < 100; index++) {
    const mobile = '082' + String(index).padStart(7, '0');
    const deviceToken = require('node:crypto').randomBytes(32).toString('base64url');
    assert.equal(
      (await h.attempt({ ...synthetic, mobile, dateOfBirth: '' }, false, { deviceToken })).code,
      'CRM_AUTH_INVALID',
    );
  }
  assert.equal(
    (
      await h.attempt({ ...synthetic, mobile: '0830000000' }, false, {
        deviceToken: 'B'.repeat(43),
      })
    ).code,
    'CRM_AUTH_RATE_LIMITED',
  );
  h.advance(WINDOW_MS);
  for (let index = 0; index < 40; index++) {
    assert.equal(
      (await h.attempt({ ...synthetic, mobile: '0830000001' })).code,
      'CRM_AUTH_INVALID',
    );
    h.advance(WINDOW_MS);
  }
  assert.equal(
    (
      await h.attempt({ ...synthetic, mobile: '0830000001' }, false, {
        address: '192.0.2.2',
        deviceToken: 'C'.repeat(43),
      })
    ).code,
    'CRM_AUTH_RATE_LIMITED',
  );
});

test('pool acquisition failures give generic private 503 responses without sessions, registration or leaked diagnostics', async (t) => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const h = await harness(t);
  const warnings = [];
  let connections = 0;
  let writes = 0;
  let issued = 0;
  const diagnostic = JSON.stringify(synthetic);
  const auth = createClientCrmDetailAuthService({
    db: {
      async connect() {
        connections++;
        throw new Error(`synthetic driver failure: ${diagnostic}`);
      },
      async query() {
        writes++;
        throw new Error('query must not run without a connection');
      },
    },
    env,
    sessionService: {
      async issueCrmDetailSession() {
        issued++;
      },
    },
    logger: {
      warn(value) {
        warnings.push(value);
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use(createMyShilohRouter({ env, sessionService: h.sessions, crmAuthService: auth }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const mode of ['sign-in', 'register']) {
    const { gender, ...signIn } = synthetic;
    const response = await fetch(`${base}/my-shiloh/auth/crm/${mode}`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify(mode === 'register' ? synthetic : signIn),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'Sign-in is temporarily unavailable. Please try again later.',
    });
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.ok(
      response.headers
        .getSetCookie()
        .every((cookie) => !cookie.startsWith('shiloh_client_session=')),
    );
  }
  assert.equal(connections, 2);
  assert.equal(writes, 0);
  assert.equal(issued, 0);
  assert.deepEqual(
    warnings,
    Array(2).fill({ event: 'crm_detail_auth_unavailable', category: 'database' }),
  );
  for (const table of ['crm_v2_clients', 'client_browser_sessions'])
    assert.equal(
      (await h.db.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count,
      0,
    );
});

test('limiter evaluates current time after waiting for all shared bucket locks', async (t) => {
  const h = await harness(t);
  const key = require('node:crypto')
    .createHmac('sha256', env.MY_SHILOH_CRM_AUTH_RATE_KEY)
    .update('global:clinic')
    .digest('hex');
  await h.db.query(
    `INSERT INTO client_crm_auth_rate_buckets(bucket_key,window_started_at,attempts,blocked_until,expires_at)
    VALUES($1,$2,1,$3,$4)`,
    [key, h.now(), new Date(h.now().getTime() + 5), new Date(h.now().getTime() + WINDOW_MS)],
  );
  let locks = 0;
  const auth = createClientCrmDetailAuthService({
    env,
    now: h.now,
    sessionService: h.sessions,
    db: {
      async connect() {
        return {
          release() {},
          async query(sql, params) {
            const result = await h.db.query(sql, params);
            if (sql.includes('pg_advisory_xact_lock') && ++locks === 6) h.advance(10);
            return result;
          },
        };
      },
    },
  });
  const result = await auth.attempt({
    input: synthetic,
    address: '192.0.2.1',
    deviceToken: 'A'.repeat(43),
  });
  assert.equal(
    result.code,
    'CRM_AUTH_INVALID',
    'Expired backoff at lock acquisition must allow the attempt',
  );
});


test('Shiloh detail re-entry is scoped, bounded and never renews the session deadline', async t => {
  const h = await harness(t);
  await h.insert();
  const first = await h.attempt();
  const initial = await h.sessions.validateSessionToken(first.sessionToken);
  assert.equal(recentClientSession(initial, h.now()), false);
  const deadline = first.expiresAt.getTime();
  assert.equal(initial.reauthenticatedAt.getTime(), initial.issuedAt.getTime());
  assert.equal(recentClientSession(initial, h.now()), false);
  const other = { ...synthetic, firstName: 'Other', mobile: '0820000002' };
  await h.insert(other);
  h.advance(1000);
  assert.equal((await h.attempt(other, false, { reauthenticateSession: initial })).ok, false);
  h.advance(1000);
  assert.equal((await h.attempt({ ...synthetic, surname: 'Wrong' }, false,
    { reauthenticateSession: initial })).ok, false);
  h.advance(1001);
  h.queries.length = 0;
  const reentered = await h.attempt(synthetic, false, { reauthenticateSession: initial });
  assert.equal(reentered.reauthenticated, true);
  const sessionLock = h.queries.findIndex(sql => /FROM client_browser_sessions/.test(sql) && /FOR UPDATE/.test(sql));
  const clientLock = h.queries.findIndex(sql => /SELECT \* FROM crm_v2_clients/.test(sql));
  assert.ok(sessionLock >= 0 && clientLock > sessionLock, 'session lock precedes client lock during re-entry');
  assert.equal(reentered.sessionToken, undefined);
  const fresh = await h.sessions.validateSessionToken(first.sessionToken);
  assert.equal(fresh.assurance, 'biographical_match');
  assert.equal(recentClientSession(fresh, h.now()), true);
  assert.equal((await h.db.query('SELECT expires_at FROM client_browser_sessions WHERE id=$1', [fresh.sessionId])).rows[0].expires_at.getTime(), deadline);
  assert.equal((await h.sessions.revokeOtherSessions(fresh)).ok, true);
  const owner = (await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1', [fresh.crmV2ClientId])).rows[0];
  const profiles = createMyShilohProfileService({db: h.db, now: h.now});
  assert.equal((await profiles.updateProfile({sessionId: fresh.sessionId, crmV2ClientId: fresh.crmV2ClientId, expectedRevision: profileRevision(owner), name: owner.name, dateOfBirth: synthetic.dateOfBirth, gender: synthetic.gender})).status, 'unchanged');
  h.advance(10 * 60 * 1000);
  assert.equal(recentClientSession(await h.sessions.validateSessionToken(first.sessionToken), h.now()), true);
  h.advance(1);
  assert.equal(recentClientSession(await h.sessions.validateSessionToken(first.sessionToken), h.now()), false);
  await h.sessions.revokeSession(fresh.sessionId, 'logout');
  assert.equal((await h.attempt(synthetic, false, { reauthenticateSession: fresh })).ok, false);
});

const CLIENT_ORIGIN = 'https://app.shilohmtc.co.za';
const CLIENT_RP_ID = 'app.shilohmtc.co.za';
const b64url = v => Buffer.from(v).toString('base64url');
function encLen(major, n) { if (n < 24) return Buffer.from([(major << 5) | n]); if (n < 256) return Buffer.from([(major << 5) | 24, n]); if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; } throw new Error('test cbor length'); }
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? encLen(0, v) : encLen(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([encLen(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([encLen(3, b.length), b]); }
  if (v instanceof Map) { const parts = [encLen(5, v.size)]; for (const [k, val] of v) parts.push(cbor(k), cbor(val)); return Buffer.concat(parts); }
  throw new Error('unsupported test cbor');
}
function clientData(type, challenge, origin = CLIENT_ORIGIN) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }
function authData({ credentialId = null, cose = null, signCount = 0, flags = 0x05, rpId = CLIENT_RP_ID } = {}) {
  const head = Buffer.alloc(37); crypto.createHash('sha256').update(rpId).digest().copy(head, 0); head[32] = flags; head.writeUInt32BE(signCount, 33);
  if (!credentialId) return head;
  const aaguid = Buffer.alloc(16); const len = Buffer.alloc(2); len.writeUInt16BE(credentialId.length);
  return Buffer.concat([head, aaguid, len, credentialId, cbor(cose)]);
}
function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const credentialId = crypto.randomBytes(32); const challenge = crypto.randomBytes(32).toString('base64url');
  return { publicKey, privateKey, cose, credentialId, challenge };
}
function registrationResponse(f, { origin = CLIENT_ORIGIN, challenge = f.challenge, rpId = CLIENT_RP_ID, flags = 0x45 } = {}) {
  const cd = clientData('webauthn.create', challenge, origin);
  const ad = authData({ credentialId: f.credentialId, cose: f.cose, signCount: 0, flags, rpId });
  const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  return { id: b64url(f.credentialId), rawId: b64url(f.credentialId), type: 'public-key', response: { clientDataJSON: b64url(cd), attestationObject: b64url(att), transports: ['internal'] } };
}

test('first-ever passkey can be saved near the remembered deadline, without extending or changing assurance', async (t) => {
  const h = await harness(t); await h.insert(); const signed = await h.attempt();
  h.advance(SESSION_TTL_MS - 60_000);
  const session = await h.sessions.validateSessionToken(signed.sessionToken);
  const before = (await h.db.query('SELECT * FROM client_browser_sessions')).rows[0];
  const service = createClientPasskeyEnrollmentService({ db:h.db, env, now:h.now });
  const start = await service.begin({ session }); assert.equal(start.ok,true);
  const f = fixture(); f.challenge = start.options.challenge;
  assert.equal((await service.finish({ session, response:registrationResponse(f) })).ok,true);
  assert.deepEqual((await h.db.query('SELECT * FROM client_browser_sessions')).rows[0], before);
  assert.equal((await service.begin({ session })).ok, true);
  h.advance(60_000);
  assert.equal((await service.begin({ session })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
});
test('remembered setup includes historical revoked keys and rejects cross-client/revoked sessions', async (t) => {
  const h = await harness(t); const owner=await h.insert(); const signed=await h.attempt();
  h.advance(86400000); const session=await h.sessions.validateSessionToken(signed.sessionToken);
  const service=createClientPasskeyEnrollmentService({db:h.db,env,now:h.now});
  assert.equal((await service.begin({session:{...session,crmV2ClientId:owner.id+1}})).ok,false);
  await h.db.query("INSERT INTO client_auth_passkey_credentials(crm_v2_client_id,credential_id,public_key_spki,algorithm,revoked_at) VALUES($1,$2,$3,-7,$4)",[owner.id,'A'.repeat(24),Buffer.from('synthetic-public-key'),h.now()]);
  assert.equal((await service.begin({session})).ok,true);
  await h.db.query('DELETE FROM client_auth_passkey_credentials');
  await h.sessions.revokeSession(session.sessionId,'logout');
  assert.equal((await service.begin({session})).ok,false);
});
test('remembered session may finish an additional optional key under the same client limit', async (t) => {
  const h=await harness(t);const owner=await h.insert();const signed=await h.attempt();h.advance(86400000);
  const session=await h.sessions.validateSessionToken(signed.sessionToken);
  const service=createClientPasskeyEnrollmentService({db:h.db,env,now:h.now});const start=await service.begin({session});
  await h.db.query("INSERT INTO client_auth_passkey_credentials(crm_v2_client_id,credential_id,public_key_spki,algorithm) VALUES($1,$2,$3,-7)",[owner.id,'B'.repeat(24),Buffer.from('synthetic-public-key')]);
  const f=fixture();f.challenge=start.options.challenge;
  assert.equal((await service.finish({session,response:registrationResponse(f)})).ok,true);
  assert.equal((await h.db.query('SELECT * FROM client_auth_passkey_credentials')).rowCount,2);
});
test('expiry during an enrollment lock wait fails closed', async (t) => {
  const h=await harness(t);await h.insert();const signed=await h.attempt();
  const session=await h.sessions.validateSessionToken(signed.sessionToken);h.advance(SESSION_TTL_MS-1);
  const db={async query(sql,p){if(sql.includes('client-first-passkey:'))h.advance(1);return h.db.query(sql,p);}};
  const service=createClientPasskeyEnrollmentService({db,env,now:h.now});
  assert.equal((await service.begin({session})).ok,false);
  assert.equal((await h.db.query('SELECT * FROM client_auth_passkey_challenges')).rowCount,0);
});

test('remembered mobile update preserves client/session deadline, invalidates other sessions and supports new details only', async (t) => {
  const h=await harness(t);const owner=await h.insert();const signed=await h.attempt();const other=await h.attempt();
  h.advance(86400000);const session=await h.sessions.validateSessionToken(signed.sessionToken);
  await h.db.query("UPDATE crm_v2_clients SET first_name='Synthetic',surname='Example',mobile_verified_at=$2 WHERE id=$1",[owner.id,h.now()]);
  const current=(await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0];
  const before=(await h.db.query('SELECT * FROM client_browser_sessions WHERE id=$1',[session.sessionId])).rows[0];
  const service=createMyShilohProfileService({db:h.db,now:h.now});
  const result=await service.updateProfile({sessionId:session.sessionId,crmV2ClientId:owner.id,expectedRevision:profileRevision(current),name:current.name,dateOfBirth:synthetic.dateOfBirth,gender:synthetic.gender,mobile:'083 000 0003'});
  assert.equal(result.status,'updated');assert.equal(result.profile.mobile,'0•• ••• 0003');
  const updated=(await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0];
  assert.equal(updated.first_name,'Synthetic');assert.equal(updated.surname,'Example');
  assert.equal(updated.normalized_mobile,'27830000003');assert.equal(updated.mobile_verified_at,null);assert.equal(updated.provenance.phoneOwnershipVerified,false);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM crm_v2_clients')).rows[0].n,1);
  assert.deepEqual((await h.db.query('SELECT * FROM client_browser_sessions WHERE id=$1',[session.sessionId])).rows[0],before);
  assert.equal((await h.sessions.validateSessionToken(other.sessionToken)).ok,false);
  assert.equal((await h.attempt()).ok,false);assert.equal((await h.attempt({...synthetic,mobile:'0830000003'})).ok,true);
  const event=(await h.db.query("SELECT metadata FROM client_auth_security_events WHERE event_type='client_profile_updated'")).rows[0];
  assert.deepEqual(event.metadata.changedFields,['mobile']);assert.ok(!JSON.stringify(event).includes('27830000003'));
  const keyService=createClientPasskeyEnrollmentService({db:h.db,env,now:h.now});const start=await keyService.begin({session});assert.equal(start.ok,true);
  const f=fixture();f.challenge=start.options.challenge;assert.equal((await keyService.finish({session,response:registrationResponse(f)})).ok,true);
  const key=(await h.db.query('SELECT id FROM client_auth_passkey_credentials')).rows[0];
  assert.equal((await keyService.revoke({session,credentialId:Number(key.id)})).ok,true);
  assert.equal((await keyService.begin({session})).ok,true); // Revoked history does not block replacement.
});

test('mobile change rejects conflicts, stale/cross-client/expired sessions and malformed input without writes',async(t)=>{
  const h=await harness(t);const owner=await h.insert();await h.insert({...synthetic,firstName:'Other',mobile:'0830000003'});
  const signed=await h.attempt();const session=await h.sessions.validateSessionToken(signed.sessionToken);
  const service=createMyShilohProfileService({db:h.db,now:h.now});
  const payload={sessionId:session.sessionId,crmV2ClientId:owner.id,expectedRevision:profileRevision(owner),name:owner.name,dateOfBirth:synthetic.dateOfBirth,gender:synthetic.gender};
  for(const mobile of ['bad','+44 7700 000000','08200000010',''])await assert.rejects(service.updateProfile({...payload,mobile}),/South African/);
  await assert.rejects(service.updateProfile({...payload,mobile:'0830000003'}),/cannot be used/);
  await h.db.query("UPDATE crm_v2_clients SET status='archived' WHERE normalized_mobile='27830000003'");
  await assert.rejects(service.updateProfile({...payload,mobile:'0830000003'}),/cannot be used/);
  assert.equal((await h.sessions.validateSessionToken(signed.sessionToken)).ok,true);
  await assert.rejects(service.updateProfile({...payload,expectedRevision:'a'.repeat(64),mobile:'0840000004'}),/profile changed/);
  await assert.rejects(service.updateProfile({...payload,crmV2ClientId:owner.id+1,mobile:'0840000004'}),/session has expired/);
  h.advance(SESSION_TTL_MS);await assert.rejects(service.updateProfile({...payload,mobile:'0840000004'}),/session has expired/);
  assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0],owner);
});

test('other-session revocation fails if the current session expires during a lock wait',async(t)=>{
  const h=await harness(t);const owner=await h.insert();const first=await h.attempt();const other=await h.attempt();
  const session=await h.sessions.validateSessionToken(first.sessionToken);h.advance(SESSION_TTL_MS-1);
  const before=(await h.db.query('SELECT * FROM client_browser_sessions ORDER BY id')).rows;
  const db={async query(sql,p){if(sql.includes('FOR UPDATE OF s FOR SHARE'))h.advance(1);return h.db.query(sql,p);},async connect(){return {query:this.query.bind(this),release(){}};}};
  const sessions=createClientBrowserSessionService({db,now:h.now});assert.equal((await sessions.revokeOtherSessions(session)).ok,false);
  assert.deepEqual((await h.db.query('SELECT * FROM client_browser_sessions ORDER BY id')).rows,before);
  assert.equal((await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0].normalized_mobile,'27820000001');
});

test('mobile update rereads expiry after canonical number lock waits',async(t)=>{
  const h=await harness(t);const owner=await h.insert();const signed=await h.attempt();
  const session=await h.sessions.validateSessionToken(signed.sessionToken);h.advance(SESSION_TTL_MS-1);
  const db={async query(sql,p){if(sql.includes('pg_advisory_xact_lock(hashtext'))h.advance(1);return h.db.query(sql,p);},async connect(){return {query:this.query.bind(this),release(){}};}};
  const service=createMyShilohProfileService({db,now:h.now});
  await assert.rejects(service.updateProfile({sessionId:session.sessionId,crmV2ClientId:owner.id,expectedRevision:profileRevision(owner),name:owner.name,dateOfBirth:synthetic.dateOfBirth,gender:synthetic.gender,mobile:'0830000003'}),/sign in again/i);
  assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0],owner);
});
