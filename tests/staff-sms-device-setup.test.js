'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sha256 } = require('../src/services/staffBrowserSession');
const { createStaffSmsDeviceSetupService } = require('../src/services/staffSmsDeviceSetup');
const { createStaffPasskeyBootstrapRouter } = require('../src/routes/staffPasskeyBootstrap');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');
const { workspaceAccessV2ClientScript, staffSmsSetupPanel } = require('../src/presentation/workspaceAccessV2Ux');
const { bootstrapScript } = require('../src/presentation/staffPasskeyBootstrapUx');

const NOW = new Date('2026-09-28T11:30:00Z');
const REQUEST = 'A'.repeat(43);
const CODE = '123456';
const OPERATOR = { id: 1, staff_id: null, admin_active: true, role: 'admin', business_role: 'owner',
  calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'staff_auth:reset': true, 'appointment:view': true } };
const STAFF = { id: 2, staff_id: 19, staff_status: 'active', admin_active: true,
  normalized_whatsapp: '+27821234567', role: 'therapist', business_role: 'employee_practitioner',
  calendar_scope: 'own', service_scope: 'own_services', permissions: {} };
const session = { ok: true, adminId: 1, authMethod: 'passkey', recoveryRequired: false,
  authenticatedAt: new Date(NOW.getTime() - 30_000).toISOString() };

function setup({ smsRow, operator = OPERATOR, staff = STAFF, sendFails = false } = {}) {
  const calls = [];
  let approvedCount = 0;
  let smsCount = 0;
  const db = {
    async connect() { return { query: db.query, release() {} }; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes('FROM staff_admin_accounts')) return { rows: [params[0] === 1 ? operator : staff].filter(Boolean) };
      if (sql.includes('FROM staff_auth_sms_device_setups') && sql.includes('COUNT')) return { rows: [{ count: 0 }] };
      if (sql.includes('FROM staff_auth_sms_device_setups')) return { rows: smsRow ? [smsRow] : [] };
      if (sql.includes('INSERT INTO staff_auth_sms_device_setups')) return { rows: [{ id: 18 }] };
      if (sql.includes('INSERT INTO staff_auth_security_events') || sql.includes('UPDATE staff_auth_sms_device_setups') ||
          sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      throw Error(`Unexpected SQL ${sql}`);
    },
  };
  const gateway = { enabled: () => true, async sendStaffSetup() { smsCount += 1; if (sendFails) throw Error('gateway'); return 'accepted-id'; } };
  const bootstrapService = { policy: () => ({ operational: true, origin: 'https://app.shilohmtc.co.za' }),
    async issueApprovedBootstrap(_client, adminId, mode) { approvedCount += 1; assert.equal(adminId, 2); return { ok: true, url: `https://app.shilohmtc.co.za/setup#${mode}` }; } };
  const service = createStaffSmsDeviceSetupService({ db, gateway, bootstrapService,
    env: { MY_SHILOH_SMS_AUTH_ENABLED: 'true' }, now: () => NOW,
    randomBytes: size => size === 32 ? Buffer.alloc(32, 8) : Buffer.alloc(4, 1), logger: { warn() {} } });
  return { service, calls, get approvedCount() { return approvedCount; }, get smsCount() { return smsCount; } };
}

test('administrator must use a recent passkey and cannot approve their own setup', async () => {
  const s = setup();
  assert.equal((await s.service.issue({ session: { ...session, authMethod: 'whatsapp_otp' }, targetAdminId: 2, mode: 'replace', identityConfirmed: true })).code, 'STAFF_RECENT_STRONG_AUTH_REQUIRED');
  assert.equal((await s.service.issue({ session: { ...session, authenticatedAt: new Date(NOW.getTime() - 11 * 60 * 1000).toISOString() }, targetAdminId: 2, mode: 'add', identityConfirmed: true })).code, 'STAFF_RECENT_STRONG_AUTH_REQUIRED');
  assert.equal((await s.service.issue({ session, targetAdminId: 1, mode: 'add', identityConfirmed: true })).code, 'STAFF_SMS_SETUP_FORBIDDEN');
  assert.equal((await s.service.issue({ session, targetAdminId: 2, mode: 'add', identityConfirmed: false })).code, 'STAFF_SMS_SETUP_FORBIDDEN');
  assert.equal(s.smsCount, 0);
  assert.equal(s.calls.length, 0);
});

test('an administrator without reset permission cannot send a staff setup SMS', async () => {
  const s = setup({ operator: { ...OPERATOR, permissions: { 'appointment:view': true } } });
  assert.equal((await s.service.issue({ session, targetAdminId: 2, mode: 'add', identityConfirmed: true })).code, 'STAFF_SMS_SETUP_FORBIDDEN');
  assert.equal(s.smsCount, 0);
});

test('an approved request uses the number already on the staff account and sends no code in the setup link', async () => {
  const s = setup();
  const result = await s.service.issue({ session, targetAdminId: 2, mode: 'replace', identityConfirmed: true });
  assert.equal(result.ok, true);
  assert.equal(s.smsCount, 1);
  assert.match(result.url, /\/sms-setup#request=/);
  assert.doesNotMatch(JSON.stringify(result), /27821234567|123456/);
  const insert = s.calls.find(call => call.sql.includes('INSERT INTO staff_auth_sms_device_setups'));
  assert.equal(insert.params[4], sha256('27821234567'));
  assert.equal(insert.params[5], 'replace');
});

test('wrong code increments attempts without creating a passkey setup link', async () => {
  const row = { id: 18, admin_id: 2, operator_admin_id: 1, code_hash: sha256(`${REQUEST}:${CODE}`),
    mobile_hash: sha256('27821234567'), mode: 'replace', provider_message_id: 'accepted-id',
    expires_at: new Date(NOW.getTime() + 100_000) };
  const s = setup({ smsRow: row });
  assert.equal((await s.service.verify({ request: REQUEST, code: '999999' })).code, 'STAFF_SMS_SETUP_INVALID');
  assert.equal(s.approvedCount, 0);
  assert.ok(s.calls.some(call => call.sql.includes('verify_attempts = verify_attempts + 1')));
});

test('changed mobile or reset authority blocks redemption; valid code consumes request and issues bound link', async () => {
  const row = { id: 18, admin_id: 2, operator_admin_id: 1, code_hash: sha256(`${REQUEST}:${CODE}`),
    mobile_hash: sha256('27821234567'), mode: 'replace', provider_message_id: 'accepted-id',
    expires_at: new Date(NOW.getTime() + 100_000) };
  const changed = setup({ smsRow: row, staff: { ...STAFF, normalized_whatsapp: '+27829999999' } });
  assert.equal((await changed.service.verify({ request: REQUEST, code: CODE })).ok, false);
  assert.equal(changed.approvedCount, 0);
  const valid = setup({ smsRow: row });
  assert.deepEqual(await valid.service.verify({ request: REQUEST, code: CODE }),
    { ok: true, url: 'https://app.shilohmtc.co.za/setup#replace' });
  assert.equal(valid.approvedCount, 1);
  assert.ok(valid.calls.some(call => call.sql.includes('SET consumed_at = $2')));
});

test('SMS setup routes are gated and migration allows only constrained approved bootstrap modes', () => {
  const router = createStaffPasskeyBootstrapRouter({ env: {},
    bootstrapService: { startRegistration() {} }, smsSetupService: { enabled: () => false } });
  assert.ok(router);
  const service = fs.readFileSync(path.join(__dirname, '../src/services/staffPasskeyDeviceBootstrap.js'), 'utf8');
  assert.match(service, /ADMIN_SMS_REPLACE_SOURCE && mode !== 'replace'/);
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/178_staff_sms_passkey_setup.sql'), 'utf8');
  assert.match(migration, /source IN \('whatsapp_self', 'workspace_self', 'admin_sms_add', 'admin_sms_replace'\)/);
});

test('administrator and phone scripts parse and the approval screen labels revocation precisely', () => {
  assert.doesNotThrow(() => new vm.Script(workspaceAccessV2ClientScript()));
  assert.doesNotThrow(() => new vm.Script(bootstrapScript()));
  const html = staffSmsSetupPanel({ id: 19, active: true });
  assert.match(html, /Send SMS setup code/);
  assert.match(html, /after setup/);
  assert.match(html, /identity/);
  assert.match(html, /passkey within the last 10 minutes/);
});

test('expired administrator authentication gives actionable guidance without weakening forbidden responses', async () => {
  let resultCode = 'STAFF_RECENT_STRONG_AUTH_REQUIRED';
  const router = createWorkspaceStaffMutationRouter({ sessionService: {},
    staffSmsDeviceSetupService: { async issue() { return { ok: false, code: resultCode }; } } });
  const handler = router.stack.find(layer => layer.route?.path === '/workspace-access/:id/sms-device-setup').route.stack.at(-1).handle;
  const req = { params: { id: '2' }, body: { mode: 'add', identityConfirmed: true }, staffBrowserSession: session, id: 'test' };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res, error => { throw error; });
  assert.equal(res.statusCode, 428);
  assert.match(res.body.error, /sign in again with an authorized administrator passkey/i);
  resultCode = 'STAFF_SMS_SETUP_FORBIDDEN';
  await handler(req, res, error => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.doesNotMatch(res.body.error, /sign in again/i);
});

test('the SMS code entry page serves a parseable client script without storing the code in a URL', () => {
  const router = createStaffPasskeyBootstrapRouter({ env: {},
    bootstrapService: { startRegistration() {} }, smsSetupService: { enabled: () => true } });
  const js = router.stack.find(layer => layer.route?.path === '/sms-setup.js');
  let body;
  const response = { setHeader() {}, send(value) { body = value; return this; },
    status() { return this; }, type() { return this; } };
  js.route.stack[0].handle({}, response);
  assert.doesNotThrow(() => new vm.Script(body));
  assert.match(body, /history\.replaceState/);
  assert.match(body, /form\.elements\.namedItem\('code'\)/);
});
