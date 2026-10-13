'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStaffPasskeyAuthRouter } = require('../src/routes/staffPasskeyAuth');
const { createStaffPasskeyBootstrapRouter } = require('../src/routes/staffPasskeyBootstrap');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');
const { bootstrapPolicy } = require('../src/services/staffPasskeyDeviceBootstrap');
const { createStaffSmsDeviceSetupService } = require('../src/services/staffSmsDeviceSetup');
const { passkeyNavigationClientScript } = require('../src/routes/workspaceOperational');
const { staffSmsSetupPanel } = require('../src/presentation/workspaceAccessV2Ux');
const { workspaceStaffOnboardingClientScript } = require('../src/presentation/workspaceStaffOnboardingUx');
const { bootstrapAwareSigninScript } = require('../src/routes/staffCalendarAccessUx');
const env = {
  SHILOH_STAFF_DETAIL_AUTH_ENABLED: 'true',
  SHILOH_STAFF_DETAIL_AUTH_RATE_KEY: 'synthetic-rate-key'.repeat(3),
  SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true',
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  MY_SHILOH_SMS_AUTH_ENABLED: 'true',
  SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://staff.example.test',
};
test('staff device and SMS routes retire while administrator authentication and confirmation remain usable', async t => {
  const session = { ok: true, sessionId: 17, adminId: 42, authMethod: 'staff_details' };
  const sessions = {
    async validateSessionToken() { return session; },
    validateCsrfToken(_session, token) { return token === 'synthetic-csrf'; },
  };
  const calls = [];
  const passkeys = {
    async beginAuthentication({ session: actual } = {}) {
      calls.push(actual ? 'confirmation' : 'sign-in');
      return { ok: true, options: { challenge: 'synthetic' } };
    },
    async finishAuthentication({ session: actual } = {}) {
      assert.equal(actual, session);
      calls.push('confirmed');
      return { ok: true, credentialHint: 'A'.repeat(43) };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar/staff-auth/passkeys', createStaffPasskeyBootstrapRouter({ env, bootstrapService: { startRegistration() { throw Error('retired'); } }, smsSetupService: {} }));
  app.use('/calendar/staff-auth/passkeys', createStaffPasskeyAuthRouter({ env, sessionService: sessions, passkeyService: passkeys, bootstrapService: {} }));
  app.use('/calendar/team', createWorkspaceStaffMutationRouter({ env, sessionService: sessions, staffSmsDeviceSetupService: { issue() { throw Error('retired'); } } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, Cookie: 'shiloh_staff_session=' + 'B'.repeat(43), 'Content-Type': 'application/json', 'x-shiloh-csrf-token': 'synthetic-csrf' };
  async function request(path, method = 'POST') {
    return fetch(origin + '/calendar/staff-auth/passkeys' + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}), redirect: 'manual' });
  }
  for (const path of ['/registration/options', '/registration/finish', '/self-bootstrap', '/19/rename', '/19/revoke', '/sms-setup/verify', '/bootstrap/start', '/bootstrap/finish']) {
    assert.equal((await request(path)).status, 410, path);
  }
  for (const path of ['/', '/manage.js', '/sms-setup', '/sms-setup.js', '/bootstrap', '/bootstrap.js']) {
    assert.equal((await request(path, 'GET')).status, 410, path);
  }
  const manage = await request('/manage', 'GET');
  assert.equal(manage.status, 302);
  assert.equal(manage.headers.get('location'), '/calendar/staff-auth/details/manage');
  assert.equal((await fetch(origin + '/calendar/team/workspace-access/19/sms-device-setup', { method: 'POST', headers, body: '{}' })).status, 410);
  assert.equal((await request('/authentication/options')).status, 200);
  assert.equal((await request('/reauthentication/options')).status, 200);
  assert.equal((await request('/reauthentication/finish')).status, 204);
  assert.deepEqual(calls, ['sign-in', 'confirmation', 'confirmed']);
});
test('staff SMS issuance and verification fail closed before any database or gateway work', async () => {
  const service = createStaffSmsDeviceSetupService({ env, db: {}, gateway: { enabled() { throw Error('SMS must not be consulted'); } }, bootstrapService: {} });
  assert.equal(service.enabled(), false);
  assert.equal((await service.issue({})).ok, false);
  assert.equal((await service.verify({})).ok, false);
  assert.equal(bootstrapPolicy(env).enabled, false);
});
test('staff navigation and enrollment use details instead of devices and SMS', () => {
  const navigation = passkeyNavigationClientScript(env);
  assert.match(navigation, /My sign-in details/);
  assert.doesNotMatch(navigation, /passkeys\/manage|Devices/);
  const panel = staffSmsSetupPanel({ id: 19, active: true }, 1, true);
  assert.match(panel, /Staff sign-in details/);
  assert.match(panel, /administrator changes still require passkey confirmation/);
  assert.doesNotMatch(panel, /data-staff-sms|Send SMS|Replace lost/);
  const onboarding = workspaceStaffOnboardingClientScript({ detailSigninEnabled: true });
  assert.match(onboarding, /Ready for sign-in details/);
  assert.doesNotMatch(onboarding, /SMS setup|Ready for device setup/);
  assert.doesNotMatch(bootstrapAwareSigninScript(env), /SMS device setup|Devices & sign-in|private setup link|fresh setup link/);
});
