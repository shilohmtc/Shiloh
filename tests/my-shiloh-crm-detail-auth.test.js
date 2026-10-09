'use strict';
// All records here are synthetic; no production DB, client, provider or SMS is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  await pg.exec('ALTER TABLE client_browser_sessions ADD COLUMN passkey_credential_id BIGINT');
  await pg.exec(fs.readFileSync('migrations/189_client_crm_detail_auth.sql', 'utf8'));
  let current = new Date('2026-10-09T06:00:00Z');
  const db = {
    async query(sql, params) {
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

test('CRM match has fixed 30 days, never verifies phone or changes CRM; all sensitive gates deny even fresh auth', async (t) => {
  const h = await harness(t);
  const owner = await h.insert();
  const result = await h.attempt();
  assert.equal(result.ok, true);
  assert.equal(result.expiresAt - h.now(), SESSION_TTL_MS);
  const session = await h.sessions.validateSessionToken(result.sessionToken);
  assert.equal(session.authMethod, 'crm_details');
  assert.equal(session.assurance, 'biographical_match');
  assert.equal(recentClientSession(session, h.now()), false);
  assert.equal((await h.sessions.revokeOtherSessions(session)).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  const enroll = createClientPasskeyEnrollmentService({ db: h.db, env, now: h.now });
  for (const action of ['begin', 'finish', 'revoke'])
    assert.equal(
      (await enroll[action]({ session, credentialId: 1 })).code,
      'CLIENT_RECENT_AUTH_REQUIRED',
    );
  const recovery = createClientPasskeyRecoveryService({ db: h.db, env, now: h.now });
  assert.equal((await recovery.create({ session })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  const profiles = createMyShilohProfileService({ db: h.db, now: h.now });
  await assert.rejects(
    profiles.updateProfile({
      sessionId: session.sessionId,
      crmV2ClientId: owner.id,
      expectedRevision: profileRevision(owner),
      name: 'Other Example',
      dateOfBirth: synthetic.dateOfBirth,
      gender: synthetic.gender,
    }),
    /session has expired/,
  );
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
  assert.match(signed, /phone ownership unverified/);
  assert.doesNotMatch(signed, /data-client-setup hidden/);
});

test('stored assurance/revocation is rechecked: pretending a CRM timestamp is verified cannot authorize security mutations', async (t) => {
  const h = await harness(t);
  await h.insert();
  const result = await h.attempt();
  const actual = await h.sessions.validateSessionToken(result.sessionToken);
  const forged = { ...actual, authMethod: 'sms_code' };
  const enroll = createClientPasskeyEnrollmentService({ db: h.db, env, now: h.now });
  assert.equal((await enroll.begin({ session: forged })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  assert.equal(
    (await enroll.revoke({ session: forged, credentialId: 1 })).code,
    'CLIENT_RECENT_AUTH_REQUIRED',
  );
  const recovery = createClientPasskeyRecoveryService({ db: h.db, env, now: h.now });
  assert.equal((await recovery.create({ session: forged })).code, 'CLIENT_RECENT_AUTH_REQUIRED');
  assert.equal((await h.sessions.revokeOtherSessions(forged)).code, 'CLIENT_RECENT_AUTH_REQUIRED');
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
