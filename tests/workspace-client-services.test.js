'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientActivity } = require('../src/domain/workspaceClientActivity');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { renderWorkspaceNavigation } = require('../src/presentation/workspaceShell');
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
  assert.match(html, /data-client-services open/);
  const group = html.match(/<details[\s\S]*?<\/details>/)[0];
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
