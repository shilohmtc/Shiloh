const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const assistant = read('src/services/adminAssistant.js');
const interactive = read('src/services/adminInteractiveMenu.js');
const mobile = read('src/services/adminMobileMenu.js');
const {
  classifyRetiredAdminAction,
  classifyWorkspaceEntry,
  processRetiredAdminAuthorityMessage,
} = require('../src/services/adminAuthorityRetirement');
const { getMenuOptions, menu } = require('../src/services/adminMobileMenu');

const owner = {
  id: 1,
  staff_id: 10,
  display_name: 'Owner',
  business_role: 'owner',
  calendar_scope: 'all_business',
  service_scope: 'all_services',
  admin_active: true,
  staff_status: 'active',
  permissions: { 'appointment:view': true },
};

function oneAdminDb(admin = owner) {
  return {
    async query(sql) {
      if (String(sql).includes('FROM staff_admin_accounts')) return { rows: [admin], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('ordinary WhatsApp Admin menu is retired rather than retained as a parallel staff surface', () => {
  assert.deepEqual(getMenuOptions(owner), []);
  assert.match(menu(owner), /WhatsApp Admin has retired/);
  assert.doesNotMatch(interactive, /topLevelInteractive|workspaceLauncherInteractive|actionForId/);
  assert.doesNotMatch(mobile, /admin_action_today|admin_action_tomorrow|admin_action_reports|admin_action_earnings/);
});

test('stale staff payloads fail closed while normal client language remains available', () => {
  for (const input of [
    'booking_approval_approve_123', 'booking_approval_decline_123', 'resend_booking_approval_123',
    'admin_open_menu', 'admin_action_pending_approvals', 'admin_action_today',
    'admin_action_tomorrow', 'admin_action_reports', 'admin_action_earnings',
    'Admin', 'Pending approvals', 'Reports', 'Earnings', 'Services & pricing',
  ]) assert.ok(classifyRetiredAdminAction(input), input);
  for (const input of ['Today', 'Tomorrow', 'Yes', 'client_book_now', 'Open Calendar']) {
    assert.equal(classifyRetiredAdminAction(input), null, input);
  }
});

test('recognized staff greetings restore only the Open Workspace launcher', async () => {
  for (const greeting of ['hi', 'Hello!', 'howzit', 'good morning']) {
    assert.deepEqual(classifyWorkspaceEntry(greeting), { kind: 'launcher' });
    const result = await processRetiredAdminAuthorityMessage('27720000000', greeting, oneAdminDb());
    assert.equal(result.handled, true);
    assert.equal(result.interactive?.type, 'button');
    assert.deepEqual(result.interactive?.buttons, [{ id: 'staff_open_workspace', title: 'Open Workspace' }]);
    assert.doesNotMatch(JSON.stringify(result), /Pending approvals|admin_open_menu|Admin menu/);
  }
});

test('recognized staff can request a secure one-time Workspace handoff directly', async () => {
  const calls = [];
  const handoffService = {
    async issueForWhatsapp(input) {
      calls.push(input);
      return { ok: true, token: 'A'.repeat(43) };
    },
  };
  const env = { SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://shiloh.example' };
  for (const command of ['workspace', 'open workspace', 'staff_open_workspace']) {
    const result = await processRetiredAdminAuthorityMessage(
      '27720000000',
      command,
      oneAdminDb(),
      { handoffService, env },
    );
    assert.equal(result.handled, true);
    assert.match(result.reply, /Open Workspace/);
    assert.match(result.reply, /https:\/\/shiloh\.example\/calendar\/staff\/handoff#handoff=/);
  }
  assert.deepEqual(calls, [
    { whatsapp: '27720000000' },
    { whatsapp: '27720000000' },
    { whatsapp: '27720000000' },
  ]);
});

test('non-staff greetings and Workspace terms continue through the client flow', async () => {
  const noAdmin = { query: async () => ({ rows: [], rowCount: 0 }) };
  for (const input of ['hi', 'workspace', 'open workspace', 'staff_open_workspace']) {
    assert.deepEqual(await processRetiredAdminAuthorityMessage('27720000000', input, noAdmin), { handled: false });
  }
});

test('ambiguous staff identity fails closed for Workspace entry', async () => {
  const ambiguous = { query: async () => ({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }) };
  const blocked = await processRetiredAdminAuthorityMessage('27720000000', 'hi', ambiguous);
  assert.equal(blocked.handled, true);
  assert.match(blocked.reply, /could not be authorized/);
  assert.match(blocked.reply, /No action was taken/);
});

test('#900 active linked staff receives the Workspace launcher without explicit appointment:view while inactive staff remains denied', async () => {
  const activeLinkedNoView = { ...owner, permissions: {} };
  const activeResult = await processRetiredAdminAuthorityMessage('27720000000', 'hi', oneAdminDb(activeLinkedNoView));
  assert.equal(activeResult.handled, true);
  assert.equal(activeResult.interactive?.type, 'button');
  assert.deepEqual(activeResult.interactive?.buttons, [{ id: 'staff_open_workspace', title: 'Open Workspace' }]);

  const inactive = { ...activeLinkedNoView, staff_status: 'inactive' };
  const inactiveResult = await processRetiredAdminAuthorityMessage('27720000000', 'hi', oneAdminDb(inactive));
  assert.equal(inactiveResult.handled, true);
  assert.equal(inactiveResult.interactive, undefined);
  assert.match(inactiveResult.reply, /Workspace access is not available/);
});

test('non-admin stale command is not intercepted and ambiguous staff authority fails closed', async () => {
  const noAdmin = { query: async () => ({ rows: [], rowCount: 0 }) };
  assert.deepEqual(await processRetiredAdminAuthorityMessage('27720000000', 'Services & pricing', noAdmin), { handled: false });
  const ambiguous = { query: async () => ({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }) };
  const blocked = await processRetiredAdminAuthorityMessage('27720000000', 'Admin', ambiguous);
  assert.equal(blocked.handled, true);
  assert.match(blocked.reply, /could not be authorized/);
  assert.match(blocked.reply, /No action was taken/);
});

test('authenticated stale action records provenance without invoking a domain mutation', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (queries.length === 1) return { rows: [owner], rowCount: 1 };
      if (String(sql).includes('INSERT INTO crm_audit_events')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await processRetiredAdminAuthorityMessage('27720000000', 'booking_approval_approve_123', db);
  assert.equal(result.handled, true);
  assert.equal(result.disposition.kind, 'retired');
  assert.match(result.reply, /has been retired/);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /admin\.whatsapp_authority_retired/);
  assert.equal(JSON.parse(queries[1].params[1]).mutationAttempted, false);
});

test('legacy Assistant remains inert', () => {
  assert.doesNotMatch(assistant, /INSERT|UPDATE|DELETE|prepareAdminBooking|confirmAdminBooking|archiveClientForAdmin/);
  assert.match(assistant, /handled: false, retired: true/);
});
