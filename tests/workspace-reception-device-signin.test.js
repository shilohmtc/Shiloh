'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('../src/services/staffBrowserSession');
const { createWorkspaceReceptionDeviceSigninService } = require('../src/services/workspaceReceptionDeviceSignin');
const { expectedPermissions } = require('../src/services/workspaceReceptionAccess');

const NOW = new Date('2026-09-10T18:50:00.000Z');
const RECEPTION = {
  id: 42,
  staff_id: null,
  display_name: 'Shiloh Reception',
  normalized_whatsapp: '+27820000000',
  role: 'receptionist',
  business_role: 'booking_operator',
  calendar_scope: 'all_business',
  service_scope: 'all_services',
  active: true,
  staff_status: null,
  permissions: expectedPermissions(),
};

function recentSession(overrides = {}) {
  return {
    ok: true,
    adminId: 7,
    authenticatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    authMethod: 'passkey',
    recoveryRequired: false,
    ...overrides,
  };
}

function serviceWith({ db, bootstrapResult } = {}) {
  return createWorkspaceReceptionDeviceSigninService({
    db,
    now: () => new Date(NOW),
    bootstrapService: {
      issueBootstrap: async () => bootstrapResult || {
        ok: true,
        handled: true,
        eligible: true,
        token: 'A'.repeat(43),
        url: 'https://shiloh.example/calendar/staff-auth/passkeys/bootstrap#setup=redacted',
        expiresAt: new Date(NOW.getTime() + 10 * 60_000),
      },
    },
  });
}

test('issues Reception setup only with recent senior reset authority and audits with control auth method', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM staff_admin_accounts')) return { rows: [RECEPTION] };
      if (sql.includes('INSERT INTO staff_auth_security_events')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = serviceWith({ db });
  const result = await service.issue({ session: recentSession(), targetAdminId: RECEPTION.id, requestFingerprintHash: 'f'.repeat(64) });

  assert.equal(result.ok, true);
  assert.equal(result.subjectAdminId, RECEPTION.id);
  assert.equal(result.displayName, 'Shiloh Reception');
  const audit = calls.find((call) => call.sql.includes('INSERT INTO staff_auth_security_events'));
  assert.ok(audit);
  assert.match(audit.sql, /'control'/);
  assert.doesNotMatch(JSON.stringify(result), /27820000000/);
});

test('fails closed before bootstrap issuance when recent authentication is stale', async () => {
  let bootstrapCalls = 0;
  const service = createWorkspaceReceptionDeviceSigninService({
    db: { query: async () => { throw new Error('database should not be reached'); } },
    now: () => new Date(NOW),
    bootstrapService: { issueBootstrap: async () => { bootstrapCalls += 1; return {}; } },
  });

  const result = await service.issue({
    session: recentSession({ authenticatedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() }),
    targetAdminId: RECEPTION.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAFF_RECENT_AUTH_REQUIRED');
  assert.equal(bootstrapCalls, 0);
});

test('fails closed before target lookup when canonical operator lacks reset-other authority', async () => {
  let dbCalls = 0;
  let bootstrapCalls = 0;
  const service = serviceWith({
    db: { query: async () => { dbCalls += 1; return { rows: [] }; } },
    bootstrapResult: null,
  });
  service.issue;
  const result = await service.issue({ session: recentSession(), targetAdminId: RECEPTION.id });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAFF_RESET_FORBIDDEN');
  assert.equal(dbCalls, 1);
  assert.equal(bootstrapCalls, 0);
});

test('audit failure revokes only the token created by the request', async () => {
  const token = 'B'.repeat(43);
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM staff_admin_accounts')) return { rows: [RECEPTION] };
      if (sql.includes('INSERT INTO staff_auth_security_events')) throw new Error('audit rejected');
      if (sql.includes('UPDATE staff_auth_passkey_bootstraps')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = serviceWith({
    db,
    bootstrapResult: {
      ok: true,
      handled: true,
      eligible: true,
      token,
      url: 'https://shiloh.example/calendar/staff-auth/passkeys/bootstrap#setup=redacted',
      expiresAt: new Date(NOW.getTime() + 10 * 60_000),
    },
  });

  await assert.rejects(() => service.issue({ session: recentSession(), targetAdminId: RECEPTION.id }), /audit rejected/);
  const cleanup = calls.find((call) => call.sql.includes('UPDATE staff_auth_passkey_bootstraps'));
  assert.ok(cleanup);
  assert.match(cleanup.sql, /token_hash = \$2/);
  assert.deepEqual(cleanup.params.slice(0, 2), [RECEPTION.id, sha256(token)]);
});
