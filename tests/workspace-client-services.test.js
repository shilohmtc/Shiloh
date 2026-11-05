'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientActivity } = require('../src/domain/workspaceClientActivity');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { renderWorkspaceNavigation } = require('../src/presentation/workspaceShell');
const { renderClientManagement } = require('../src/presentation/workspaceClientManagementUx');
const { createWorkspaceMessagesService } = require('../src/services/workspaceMessages');
const { createWorkspaceChangeDeliveryAttentionService } = require('../src/services/workspaceChangeDeliveryAttention');

const old = { id: 901, eventKey: 'appointment-time:12:901', clientId: 9, appointmentId: 12, clientName: 'Synthetic client', status: 'failed', statusLabel: 'Send attempt failed', updatedAt: '2025-01-01T08:00:00Z' };
const app = { eventKey: old.eventKey, clientId: 9, appointmentId: 12, status: 'available', statusLabel: 'Available in My Shiloh', occurredAt: '2025-01-01T08:00:00Z' };

test('old unresolved exceptions survive the recent window, and only exact client/event identities join', async () => {
  const recent = Array.from({ length: 50 }, (_, i) => ({ ...app, eventKey: `appointment-time:12:${1000+i}` }));
  const service = createWorkspaceMessagesService({
    clientAccessService: { requireAccess: async () => ({ clientScope: { kind: 'clinic' } }) },
    notificationService: { resolveAccess: async () => ({}), listBookingConfirmationExceptions: async () => ({ exceptions: [] }) },
    communicationService: { listRecent: async () => recent },
    changeDeliveryService: { list: async () => [old] },
  });
  const model = await service.buildModel({ adminId: 1 });
  assert.equal(buildClientActivity(model).length, 51);
  assert.equal(buildClientActivity(model)[0].item.id, 901);
  const rows = buildClientActivity({ ...model, activity: [app, { ...app, clientId: 99 }, ...recent] });
  assert.equal(rows.length, 52);
  assert.equal(rows[0].activity.status, 'available');
  assert.equal(rows[0].item.status, 'failed');
  assert.equal(rows[1].item.clientId, 99);
  assert.equal(buildClientActivity({ ...model, notificationAuthority: null }).length, 50);
});

test('one activity list preserves separate availability and delivery states, count and old direct-link filter', () => {
  const model = { notificationAuthority: {}, changeAttention: [old], activity: [app], selectedView: 'recent' };
  const html = renderMessagesPage(model);
  assert.equal((html.match(/data-change-delivery-attention=/g) || []).length, 1);
  assert.match(html, /Available in My Shiloh/);
  assert.match(html, /Send attempt failed/);
  assert.match(html, /attention-count">1</);
  assert.match(html, /data-needs-attention/);
  assert.doesNotMatch(html, /data-messages-attention|data-messages-recent/);
  assert.match(renderMessagesPage({ ...model, selectedView: 'attention' }), /data-change-delivery-attention/);
  assert.match(renderMessagesPage({ ...model, changeAttentionUnavailable: true }), /count may be incomplete/);
});

test('directory and four existing service destinations share navigation without inventing access', () => {
  const html = renderWorkspaceNavigation({ active: 'forms', formsHref: '/calendar/forms', vouchersHref: '/calendar/vouchers' });
  assert.match(html, /Client Directory/);
  assert.doesNotMatch(html, /data-client-services|Client Services/);
  const group = renderClientManagement({ vouchersHref: '/calendar/vouchers' });
  assert.match(group, /Manage across clients/);
  for (const key of ['messages','vouchers','rewards','forms']) assert.match(group, new RegExp(`data-workspace-destination="${key}"`));
  assert.match(group, /href="\/calendar\/vouchers"/);
  assert.doesNotMatch(group, /href="\/calendar\/messages"|href="\/calendar\/rewards"/);
});

test('change exceptions have no recent-event row or age cutoff and retain exact scope', async () => {
  let sql;
  const service = createWorkspaceChangeDeliveryAttentionService({ db: { query: async statement => { sql = statement; return { rows: [] }; } } });
  await service.list({ authority: { businessRole: 'owner', clientScope: { kind: 'clinic' } }, notificationAuthority: {} });
  assert.doesNotMatch(sql, /LIMIT|30 days|expires_at/);
  assert.match(sql, /app_update.event_key='appointment-'/);
  assert.match(sql, /relationship_type='clinic'/);
  assert.match(sql, /service_visibility_policies/);
});

test('tool-only directory retains independent capabilities without client search or mutations', async () => {
  const { createWorkspaceClientListHandler } = require('../src/routes/workspaceClients');
  const env = { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' };
  for (const allowed of [true, false]) {
    let body, status, managementCalls = 0;
    const res = { setHeader() {}, status(value) { status = value; return this; }, type() { return this; }, send(value) { body = value; return this; } };
    const handler = createWorkspaceClientListHandler({ env,
      service: { listClients: async () => { throw Object.assign(new Error('Denied'), { code: 'WORKSPACE_CLIENTS_FORBIDDEN', httpStatus: 403 }); } },
      navigationService: { resolve: async () => ({ forms: { allowed, href: '/calendar/forms' }, rewards: { allowed: false, href: null } }) },
      injectManagement: () => { managementCalls++; },
    });
    await handler({ staffBrowserSession: { adminId: 7 }, query: {} }, res);
    assert.equal(status, allowed ? 200 : 403);
    assert.equal(managementCalls, 0);
    assert.doesNotMatch(body, /<main data-clients-list-view|id="client-search"|href="\/calendar\/rewards"/);
    if (allowed) assert.match(body, /href="\/calendar\/forms"/);
  }
});

test('directory entry composes tool capabilities without granting activity or client lookup', async () => {
  const { createWorkspaceNavigationService } = require('../src/services/workspaceNavigation');
  const denied = { resolveAccess: async () => null };
  const service = createWorkspaceNavigationService({ clientAccessService: denied, staffAccessService: denied,
    servicesAccessService: denied, reportsAccessService: denied, clinicHoursAccessService: denied,
    voucherAccessService: denied, rewardsAccessService: denied,
    formsAccessService: { resolveAccess: async () => ({}) },
  });
  const result = await service.resolve({ session: { adminId: 7 } });
  assert.deepEqual(result.clients, { allowed: true, href: '/calendar/clients' });
  assert.deepEqual(result.messages, { allowed: false, href: null });
  assert.equal(result.forms.allowed, true);
  assert.equal(result.rewards.allowed, false);
});
