const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  createWorkspaceCommunicationEvidenceService,
  messageDeliveryEntry,
} = require('../src/services/workspaceCommunicationEvidence');
const {
  WorkspaceMessagesError,
  createWorkspaceMessagesService,
} = require('../src/services/workspaceMessages');
const {
  WorkspaceDashboardError,
  createWorkspaceDashboardService,
} = require('../src/services/workspaceDashboard');
const { createWorkspaceNavigationService } = require('../src/services/workspaceNavigation');
const {
  renderWorkspaceNavigation,
  workspaceShellStyles,
  workspaceNavigationClientScript,
} = require('../src/presentation/workspaceShell');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
const { createWorkspaceOperationalRouter } = require('../src/routes/workspaceOperational');
const { createWorkspaceMessagesRouter } = require('../src/routes/workspaceMessages');
const { periodFor } = require('../src/services/calendarReadOnlyUx');

const ENABLED_ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};
const ROOT = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function withServer(app, work) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try { return await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function activityRow(overrides = {}) {
  return {
    client_id: 91,
    client_name: 'Synthetic Client',
    normalized_mobile: '27821234567',
    appointment_id: 501,
    message_kind: 'booking_confirmation',
    status: 'unknown',
    updated_at: '2026-09-05T07:00:00.000Z',
    ...overrides,
  };
}

test('cross-client Messages activity extends canonical communication evidence and preserves UNKNOWN truth', async () => {
  const calls = [];
  const db = { async query(sql, params) {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('recentMessageDeliveries')) return { rows: [activityRow()] };
    if (text.includes('recentReschedules')) return { rows: [] };
    if (text.includes('recentCustomerCare')) return { rows: [] };
    throw new Error('Unexpected query');
  } };
  const evidence = await createWorkspaceCommunicationEvidenceService({ db }).listRecent({ limit: 20 });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].status, 'unknown');
  assert.equal(evidence[0].statusLabel, 'Unknown');
  assert.equal(evidence[0].clientId, 91);
  assert.equal(evidence[0].mobileLast4, '4567');
  assert.equal(evidence[0].normalizedMobile, undefined);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.params[0] === 20));
  assert.match(calls[0].text, /JOIN crm_v2_clients c ON c\.id=d\.crm_v2_client_id/);
  assert.doesNotMatch(calls[0].text, /provider_message_id|provider_payload|raw_message/i);
  assert.deepEqual(messageDeliveryEntry(activityRow()).statusLabel, 'Unknown');
});

test('Messages composes client:lookup, canonical evidence and existing client:notify recovery authority', async () => {
  const calls = [];
  const service = createWorkspaceMessagesService({
    clientAccessService: {
      async resolveAccess() { return { capability: 'client:lookup' }; },
      async requireAccess() { calls.push('client:lookup'); return { capability: 'client:lookup' }; },
    },
    communicationService: { async listRecent() { calls.push('evidence'); return [{ ...activityRow(), clientId: 91, clientName: 'Synthetic Client', mobileLast4: '4567', label: 'Booking confirmation', statusLabel: 'Unknown', occurredAt: activityRow().updated_at }]; } },
    notificationService: {
      async resolveAccess() { calls.push('client:notify'); return { capability: 'client:notify' }; },
      async listBookingConfirmationExceptions() { calls.push('exceptions'); return { exceptions: [{ appointment: { id: 501 } }] }; },
    },
  });
  const model = await service.buildModel({ adminId: 7, view: 'all', now: new Date('2026-09-05T08:00:00Z') });
  assert.deepEqual(calls, ['client:lookup', 'evidence', 'client:notify', 'exceptions']);
  assert.equal(model.activity[0].statusLabel, 'Unknown');
  assert.equal(model.attention[0].appointment.id, 501);
  await assert.rejects(service.buildModel({ adminId: 7, view: 'chat' }), /Messages view is invalid/);
});

test('Messages fails closed without existing client:lookup authority', async () => {
  const service = createWorkspaceMessagesService({
    clientAccessService: {
      async resolveAccess() { return null; },
      async requireAccess() { throw new WorkspaceMessagesError('WORKSPACE_MESSAGES_FORBIDDEN', 'forbidden', 403); },
    },
    communicationService: { async listRecent() { throw new Error('must not read'); } },
    notificationService: { async resolveAccess() { throw new Error('must not read'); } },
  });
  await assert.rejects(service.buildModel({ adminId: 7 }), error => error.httpStatus === 403);
});

function calendarFixture() {
  return {
    dateKey: '2026-09-05',
    timeline: {
      staff: [{ id: 11, displayName: 'Synthetic Practitioner' }],
      appointments: [{ id: 501, kind: 'appointment', canonical: true, startsAt: '2026-09-05T08:00:00Z', endsAt: '2026-09-05T09:00:00Z', status: 'confirmed', revision: '2026-09-05T07:00:00.000Z', clientName: 'Synthetic Client', serviceName: 'Treatment', staffIds: [11] }],
      closures: [],
    },
  };
}

function ownerPrincipal() {
  return {
    id: 7,
    staff_id: 11,
    display_name: 'Synthetic Owner',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true, 'booking:update': true },
    admin_active: true,
    staff_status: 'active',
    calendarAuthority: {
      capabilities: ['appointment:view'],
      linkedStaffId: 11,
      businessRole: 'owner',
      calendarScope: 'all_business',
      serviceScope: 'all_services',
    },
  };
}

test('Dashboard composes canonical all-permitted current/carry-over Calendar days and bounded Messages projections', async () => {
  const calls = [];
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => ownerPrincipal(),
    calendarService: { async buildModel(input) {
      calls.push({ calendar: input });
      if (input.date === '2026-09-04') return { ...calendarFixture(), dateKey: '2026-09-04', timeline: { ...calendarFixture().timeline, appointments: [] } };
      return calendarFixture();
    } },
    messagesService: {
      async resolveAccess() { return { capability: 'client:lookup' }; },
      async buildModel(input) { calls.push({ messages: input }); return { attention: [], activity: [], attentionUnavailable: false, activityUnavailable: false }; },
    },
    canCertifyAppointmentFn: async () => true,
  });
  const viewer = { calendarScope: 'business_all_staff' };
  const model = await service.buildModel({ adminId: 7, viewer, now: new Date('2026-09-05T08:00:00Z') });
  const calendarCalls = calls.filter(call => call.calendar).map(call => call.calendar);
  const messageCall = calls.find(call => call.messages)?.messages;
  assert.deepEqual(calendarCalls.map(call => call.date).sort(), ['2026-09-04', '2026-09-05']);
  assert.ok(calendarCalls.every(call => call.view === 'day' && call.staff === 'all'));
  assert.ok(calendarCalls.every(call => call.viewer.calendarScope === 'all_business'));
  assert.equal(model.appointments.length, 1);
  assert.equal(model.carryOver.length, 0);
  assert.equal(messageCall.activityLimit, 4);
  await assert.rejects(service.buildModel({ adminId: 7, viewer: null }), error => error instanceof WorkspaceDashboardError && error.httpStatus === 403);
});

test('Dashboard and Messages GET routes require authenticated sessions and cannot invoke a provider sender', async () => {
  const state = { dashboardGets: 0, messageGets: 0, senderCalls: 0 };
  const sessionService = { async validateSessionToken(token) { return token === 'valid' ? { ok: true, adminId: 7, viewer: { calendarScope: 'business_all_staff' } } : { ok: false }; } };
  const app = express();
  app.use('/calendar/workspace', createWorkspaceOperationalRouter({
    env: ENABLED_ENV,
    sessionService,
    dashboardService: { async buildModel() { state.dashboardGets += 1; return { ...calendarFixture(), requestedDateKey: '2026-09-05', operationalDateKey: '2026-09-05', carryOverDateKey: '2026-09-04', carryOver: [], calendar: calendarFixture(), appointments: calendarFixture().timeline.appointments, closures: [], communications: null }; } },
    navigationService: { async resolve() { return {}; } },
  }));
  app.use('/calendar/messages', createWorkspaceMessagesRouter({
    env: ENABLED_ENV,
    sessionService,
    service: { async buildModel() { state.messageGets += 1; return { selectedView: 'all', attention: [], activity: [], notificationAuthority: null }; } },
  }));
  await withServer(app, async base => {
    assert.equal((await fetch(`${base}/calendar/workspace`)).status, 401);
    assert.equal((await fetch(`${base}/calendar/messages`)).status, 401);
    const headers = { cookie: 'shiloh_staff_session=valid' };
    assert.equal((await fetch(`${base}/calendar/workspace`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/calendar/messages`, { headers })).status, 200);
  });
  assert.deepEqual(state, { dashboardGets: 1, messageGets: 1, senderCalls: 0 });
});

test('capability-driven navigation is only a composition of existing destination authorities', async () => {
  const allowed = async () => ({ authority: true });
  const denied = async () => null;
  const service = createWorkspaceNavigationService({
    clientAccessService: { resolveAccess: allowed },
    staffAccessService: { resolveAccess: denied },
    servicesAccessService: { resolveAccess: allowed },
    reportsAccessService: { resolveAccess: denied },
  });
  const model = await service.resolve({ session: { adminId: 7, viewer: { calendarScope: 'business_all_staff' } } });
  assert.equal(model.dashboard.allowed, true);
  assert.equal(model.calendar.allowed, true);
  assert.equal(model.clients.allowed, true);
  assert.equal(model.messages.allowed, true);
  assert.equal(model.staff.allowed, false);
  assert.equal(model.services.allowed, true);
  assert.equal(model.reports.allowed, false);
});

test('Desktop and hidden Phone drawer share canonical destination grammar with capability-filtered More', () => {
  const html = renderWorkspaceNavigation({ active: 'messages', messagesHref: '/calendar/messages' });
  assert.ok(html.indexOf('Dashboard') < html.indexOf('Calendar'));
  assert.ok(html.indexOf('Calendar') < html.indexOf('Clients'));
  assert.ok(html.indexOf('Clients') < html.indexOf('Messages'));
  assert.ok(html.indexOf('Messages') < html.indexOf('Staff'));
  assert.ok(html.indexOf('Staff') < html.indexOf('Services'));
  assert.ok(html.indexOf('Services') < html.indexOf('Reports'));
  assert.match(html, /data-workspace-more-toggle>More<\/button>/);
  assert.match(workspaceShellStyles(), /\.workspace-nav\{position:fixed;inset:0 auto 0 0/);
  assert.match(workspaceShellStyles(), /transform:translateX\(-105%\)/);
  assert.match(workspaceShellStyles(), /workspace-links \.workspace-more-toggle,[^{]+\{display:none/);
  assert.match(workspaceShellStyles(), /workspace-links \.workspace-more-toggle\{display:flex/);
  assert.match(workspaceShellStyles(), /\.workspace-frame\{padding-bottom:0\}/);
  assert.match(html, /data-workspace-drawer-toggle/);
  assert.match(workspaceNavigationClientScript(), /\/calendar\/workspace\/navigation/);
  assert.doesNotMatch(workspaceNavigationClientScript(), /permissions|client:lookup|appointment:view/);
});

test('presentations expose operational evidence without chat, speculative metrics or provider internals', () => {
  const messages = renderMessagesPage({
    selectedView: 'all', notificationAuthority: null, attention: [], activityUnavailable: false,
    activity: [{ clientId: 91, clientName: 'Synthetic Client', mobileLast4: '4567', label: 'Booking confirmation', status: 'unknown', statusLabel: 'Unknown', occurredAt: '2026-09-05T07:00:00Z' }],
  });
  assert.match(messages, /data-message-status="unknown"/);
  assert.match(messages, />Unknown<\/span>/);
  assert.doesNotMatch(messages, /chat bubble|unread|response rate|conversion|provider_message_id|Graph API/i);
  const dashboard = renderDashboardPage({
    ...calendarFixture(), requestedDateKey: '2026-09-05', operationalDateKey: '2026-09-05', calendar: calendarFixture(), appointments: calendarFixture().timeline.appointments, closures: [], communications: null,
  });
  assert.match(dashboard, /data-dashboard-today/);
  assert.doesNotMatch(dashboard, /revenue|utilization|conversion|response rate/i);
});

test('standalone exception presentation is retired while recovery endpoint and #714 contracts remain canonical', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/presentation/workspaceBookingConfirmationExceptionsUx.js')), false);
  const operations = source('src/routes/calendarOperationalMutations.js');
  assert.match(operations, /booking-confirmation-exceptions[\s\S]*\/calendar\/messages\?view=attention/);
  assert.match(operations, /booking-confirmation\/recover', sameOrigin, requireSession, requireCsrf, requireNotificationCapability/);
  assert.doesNotMatch(source('src/routes/calendarReadOnlyUx.js'), /Confirmation exceptions/);
  assert.equal(periodFor('week', '2026-09-05').dateKeys.length, 6);
  assert.equal(periodFor('month', '2026-09-05').dateKeys.some(day => new Date(`${day}T12:00:00Z`).getUTCDay() === 0), false);
  const changedAuthority = [
    'src/services/workspaceMessages.js',
    'src/services/workspaceDashboard.js',
    'src/services/workspaceNavigation.js',
  ].map(source).join('\n');
  assert.doesNotMatch(changedAuthority, /INSERT INTO|UPDATE\s+\w+|DELETE FROM|sendWhatsApp|sendCustomerBookingConfirmation/);
});
