const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  WorkspaceDashboardError,
  createWorkspaceDashboardService,
  groupOwnerAppointments,
  operationalDayWindow,
} = require('../src/services/workspaceDashboard');
const {
  renderDashboardPage,
  dashboardClientScript,
} = require('../src/presentation/workspaceDashboardUx');
const { createWorkspaceOperationalRouter } = require('../src/routes/workspaceOperational');
const { finalizeAppointment } = require('../src/services/adminAppointmentFinalization');

const ENABLED_ENV = {
  NODE_ENV: 'test',
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};
const NOW = new Date('2026-09-05T10:00:00.000Z');

function authorityPrincipal(overrides = {}) {
  const base = {
    id: 7,
    staff_id: 11,
    display_name: 'Canonical Practitioner',
    business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments',
    service_scope: 'own_services',
    permissions: { 'appointment:view': true, 'booking:update': true },
    admin_active: true,
    staff_status: 'active',
  };
  const principal = { ...base, ...overrides };
  principal.calendarAuthority = {
    capabilities: principal.permissions['appointment:view'] ? ['appointment:view'] : [],
    linkedStaffId: principal.staff_id,
    businessRole: principal.business_role,
    calendarScope: principal.calendar_scope,
    serviceScope: principal.service_scope,
  };
  return principal;
}

function appointment(overrides = {}) {
  return {
    id: 501,
    kind: 'appointment',
    canonical: true,
    startsAt: '2026-09-05T07:00:00.000Z',
    endsAt: '2026-09-05T08:00:00.000Z',
    status: 'confirmed',
    revision: '2026-09-05T06:30:00.000Z',
    clientName: 'Clinic Client',
    serviceName: 'Treatment',
    staffIds: [11],
    ...overrides,
  };
}

function calendarModel(items = [appointment()], staff = [{ id: 11, displayName: 'Canonical Practitioner' }]) {
  return { dateKey: '2026-09-05', timeline: { staff, appointments: items, closures: [] } };
}

function messagesService(attention = []) {
  return {
    async resolveAccess() { return { capability: 'client:lookup' }; },
    async buildModel() { return { attention, activity: [], attentionUnavailable: false, activityUnavailable: false }; },
  };
}

async function withServer(app, work) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try { return await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('practitioner My Day re-resolves current principal and narrows even own-services sessions server-side', async () => {
  const calls = [];
  const principal = authorityPrincipal({ calendar_scope: 'own_services', business_role: 'tenant_practitioner' });
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async adminId => { calls.push({ adminId }); return principal; },
    calendarService: { async buildModel(input) { calls.push({ input }); return calendarModel(); } },
    messagesService: messagesService(),
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async () => true,
  });
  const model = await service.buildModel({ adminId: 7, viewer: { calendarScope: 'business_all_staff' }, now: NOW });
  assert.equal(model.mode, 'my_day');
  assert.equal(model.displayName, 'Canonical Practitioner');
  assert.deepEqual(calls[1].input.viewer, { calendarScope: 'own_appointments', staffId: 11 });
  assert.equal(calls[1].input.staff, 'all');
  assert.equal(model.appointments.length, 1);
  assert.equal(model.appointments[0].canFinalize, true);
});

test('crafted practitioner viewer cannot broaden or switch canonical own-staff scope', async () => {
  let calendarReads = 0;
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => authorityPrincipal(),
    calendarService: { async buildModel() { calendarReads += 1; return calendarModel(); } },
    messagesService: messagesService(),
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async () => true,
  });
  await assert.rejects(
    service.buildModel({ adminId: 7, viewer: { calendarScope: 'own_staff', staffId: 99 }, now: NOW }),
    error => error instanceof WorkspaceDashboardError && error.httpStatus === 403,
  );
  await assert.rejects(
    service.buildModel({ adminId: 7, viewer: { calendarScope: 'business_all_staff' }, now: NOW }),
    error => error instanceof WorkspaceDashboardError && error.httpStatus === 403,
  );
  assert.equal(calendarReads, 0);
});

test('owner overview groups the whole permitted team while each shared booking remains one canonical row', async () => {
  const shared = appointment({ id: 503, staffIds: [11, 22], clientName: 'Shared Client' });
  const items = [appointment(), appointment({ id: 502, staffIds: [22], clientName: 'Second Client' }), shared];
  const principal = authorityPrincipal({ business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services' });
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => principal,
    calendarService: { async buildModel(input) {
      assert.deepEqual(input.viewer, { calendarScope: 'all_business' });
      return calendarModel(items, [{ id: 11, displayName: 'First' }, { id: 22, displayName: 'Second' }]);
    } },
    messagesService: messagesService(),
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async () => true,
  });
  const model = await service.buildModel({ adminId: 7, viewer: { calendarScope: 'business_all_staff' }, now: NOW });
  assert.equal(model.mode, 'owner_overview');
  assert.equal(model.teamGroups.flatMap(group => group.appointments).filter(item => item.id === 503).length, 1);
  assert.equal(model.teamGroups.find(group => group.key === 'shared').label, 'Shared appointments');
  assert.equal(model.awaitingFinalization.length, 3);
  assert.equal(groupOwnerAppointments(items).flatMap(group => group.appointments).length, 3);
});

test('shared practitioner visit stays visible but cannot be self-certified; final outcomes feed operational activity', async () => {
  const items = [
    appointment({ id: 501, staffIds: [11, 22] }),
    appointment({ id: 502, status: 'completed' }),
    appointment({ id: 503, status: 'no_show' }),
  ];
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => authorityPrincipal(),
    calendarService: { async buildModel() { return calendarModel(items); } },
    messagesService: messagesService(),
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async (_principal, id) => Number(id) !== 501,
  });
  const model = await service.buildModel({ adminId: 7, viewer: { calendarScope: 'own_staff', staffId: 11 }, now: NOW });
  assert.equal(model.appointments[0].canFinalize, false);
  assert.deepEqual(model.awaitingFinalization.map(item => item.id), [501]);
  assert.deepEqual(model.recentActivity.map(item => item.id), [502, 503]);
});

test('Workspace finalization delegates to the canonical row-locking finalizer with current operator, revision and day bounds', async () => {
  const calls = [];
  const principal = authorityPrincipal({ business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services', display_name: 'Canonical Owner' });
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async adminId => { assert.equal(adminId, 7); return principal; },
    calendarService: { async buildModel() { return calendarModel(); } },
    messagesService: messagesService(),
    finalizeAppointmentFn: async (...args) => { calls.push(args); return { status: 'updated' }; },
    canCertifyAppointmentFn: async () => true,
  });
  const result = await service.finalizeVisit({
    adminId: 7,
    viewer: { calendarScope: 'business_all_staff' },
    appointmentId: 501,
    expectedRevision: '2026-09-05T06:30:00.000Z',
    outcome: 'completed',
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], principal);
  assert.deepEqual(calls[0].slice(1, 3), [501, 'completed']);
  assert.deepEqual(calls[0][3], {
    ...operationalDayWindow('2026-09-05'),
    expectedRevision: '2026-09-05T06:30:00.000Z',
    workspace: true,
    allowBusinessBackup: true,
  });
  await assert.rejects(service.finalizeVisit({ adminId: 7, viewer: { calendarScope: 'business_all_staff' }, appointmentId: 501, expectedRevision: 'x', outcome: 'cancelled', now: NOW }), error => error.httpStatus === 400);
});

test('canonical finalizer row-locks and audits the actual Workspace operator, while stale revision writes nothing', async () => {
  const operator = authorityPrincipal({ business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services', display_name: 'Actual Operator' });
  function fakePool(revision) {
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM appointments a')) return { rows: [{
          id: 501, client_id: 91, starts_at: '2026-09-05T07:00:00.000Z', ends_at: '2026-09-05T08:00:00.000Z',
          status: 'confirmed', updated_at: revision, total_price: 500, client_name: 'Clinic Client', services: 'Treatment', staff: 'Practitioner',
        }] };
        if (String(sql).includes('FROM appointment_staff')) return { rows: [{ staff_id: 22 }] };
        return { rows: [], rowCount: 1 };
      },
      release() { calls.push({ sql: 'RELEASE', params: [] }); },
    };
    return { calls, connect: async () => client };
  }
  const currentRevision = '2026-09-05T06:30:00.000Z';
  const stalePool = fakePool(currentRevision);
  assert.equal((await finalizeAppointment(operator, 501, 'completed', {
    ...operationalDayWindow('2026-09-05'), expectedRevision: '2026-09-05T06:31:00.000Z',
    workspace: true, allowBusinessBackup: true, connectionPool: stalePool,
  })).status, 'stale_revision');
  assert.equal(stalePool.calls.some(call => call.sql.includes('UPDATE appointments')), false);

  const currentPool = fakePool(currentRevision);
  const result = await finalizeAppointment(operator, 501, 'completed', {
    ...operationalDayWindow('2026-09-05'), expectedRevision: currentRevision,
    workspace: true, allowBusinessBackup: true, connectionPool: currentPool,
  });
  assert.equal(result.status, 'updated');
  const lockedRead = currentPool.calls.find(call => call.sql.includes('FROM appointments a'));
  assert.match(lockedRead.sql, /FOR UPDATE OF a/);
  const history = currentPool.calls.find(call => call.sql.includes('INSERT INTO appointment_status_history'));
  assert.equal(history.params[3], 'admin:7:Actual Operator');
  assert.equal(history.params[4], 'Explicit Workspace attendance certification');
  const audit = currentPool.calls.find(call => call.sql.includes('INSERT INTO crm_audit_events'));
  assert.equal(audit.params[0], 7);
  assert.equal(JSON.parse(audit.params[2]).surface, 'workspace_dashboard');
});

test('Dashboard presentation makes appointment operations primary and communication failures unambiguous', () => {
  const model = {
    generatedAt: NOW.toISOString(), requestedDateKey: '2026-09-05', operationalDateKey: '2026-09-05',
    displayName: 'Canonical Practitioner', mode: 'my_day', calendar: calendarModel(), closures: [],
    appointments: [{ ...appointment(), canFinalize: true }], awaitingFinalization: [{ ...appointment(), canFinalize: true }], recentActivity: [],
    communications: { attentionUnavailable: false, attention: [{ client: { name: 'Clinic Client' }, appointment: { id: 501 }, confirmation: { statusLabel: 'Failed' } }] },
  };
  const html = renderDashboardPage(model);
  assert.match(html, /Welcome, Canonical Practitioner/);
  assert.match(html, /My day/);
  assert.match(html, /data-dashboard-finalize="completed"/);
  assert.match(html, /data-dashboard-finalize="no_show"/);
  assert.match(html, /Client notification needs attention/);
  assert.doesNotMatch(html, /Appointment #501 · Failed/);
  assert.ok(html.indexOf('data-dashboard-today') < html.indexOf('data-dashboard-communications-panel'));
  assert.match(dashboardClientScript(), /x-shiloh-csrf-token/);
  assert.match(dashboardClientScript(), /expectedRevision/);
});

test('Needs Attention projects pending and awaiting-client booking requests with exact resolution actions', async () => {
  const requests = [
    {
      appointmentId: 7651, effectiveStatus: 'pending', clientName: 'Request Client', serviceName: 'Treatment',
      staffName: 'Canonical Practitioner', requestedStartsAt: '2026-09-09T08:00:00.000Z', requestedRevision: '2026-09-05T06:30:00.000Z',
    },
    {
      appointmentId: 7652, effectiveStatus: 'awaiting_client_confirmation', clientName: 'Awaiting Client', serviceName: 'Treatment',
      staffName: 'Canonical Practitioner', proposedStaffName: 'Canonical Practitioner', requestedStartsAt: '2026-09-10T08:00:00.000Z',
      proposedStartsAt: '2026-09-11T08:00:00.000Z', requestedRevision: '2026-09-05T06:31:00.000Z',
    },
  ];
  let listInput;
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => authorityPrincipal(),
    calendarService: { async buildModel() { return calendarModel([]); } },
    messagesService: messagesService(),
    bookingRequestService: { async listUnresolvedBookingRequests(input) { listInput = input; return requests; } },
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async () => true,
  });
  const model = await service.buildModel({ adminId: 7, viewer: { calendarScope: 'own_staff', staffId: 11 }, now: NOW });
  assert.equal(listInput.principal.id, 7);
  assert.equal(listInput.now, NOW);
  assert.equal(model.bookingRequests.length, 2);
  const html = renderDashboardPage(model);
  assert.match(html, /Needs staff resolution/);
  assert.match(html, /Awaiting client/);
  assert.match(html, />Accept requested appointment</);
  assert.match(html, />Propose alternative</);
  assert.match(html, />Cannot accommodate</);
  assert.doesNotMatch(html, />Approve<|>Decline</);
  assert.doesNotMatch(html, /Alternative practitioner/);

  const ownerHtml = renderDashboardPage({ ...model, mode: 'owner_overview' });
  assert.match(ownerHtml, /Alternative practitioner/);
  assert.match(html, /<span>Alternative date<\/span><input type="date" data-proposal-date>/);
  assert.match(html, /<span>Alternative time<\/span><input type="time" step="900" data-proposal-time>/);
  assert.match(html, /data-booking-request-status aria-live="polite"/);
  const clientScript = dashboardClientScript();
  assert.match(clientScript, /booking-requests/);
  assert.match(clientScript, /date\+'T'\+time\+':00\+02:00'/);
  assert.match(clientScript, /Choose an alternative date and time\./);
  assert.match(clientScript, /Checking this alternative…/);
  assert.match(clientScript, /requestStatus/);
});

test('Workspace booking-request action re-resolves authority and forwards only controlled inputs', async () => {
  const calls = [];
  const bookingRequestService = {
    async listUnresolvedBookingRequests() { return []; },
    async acceptRequestedAppointment(input) { calls.push(['accept', input]); return { ok: true, status: 'approved' }; },
    async proposeAlternative(input) { calls.push(['propose', input]); return { ok: true, status: 'awaiting_client_confirmation' }; },
    async cannotAccommodate(input) { calls.push(['cannot', input]); return { ok: true, status: 'declined' }; },
  };
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => authorityPrincipal(),
    calendarService: { async buildModel() { return calendarModel([]); } }, messagesService: messagesService(),
    bookingRequestService, finalizeAppointmentFn: async () => ({ status: 'updated' }), canCertifyAppointmentFn: async () => true,
  });
  const common = { adminId: 7, viewer: { calendarScope: 'own_staff', staffId: 11 }, appointmentId: 7651, expectedRevision: '2026-09-05T06:30:00.000Z' };
  await service.resolveBookingRequest({ ...common, action: 'accept' });
  await service.resolveBookingRequest({ ...common, action: 'propose', startsAt: '2026-09-11T08:00:00.000Z', staffId: 11, serviceId: 25 });
  await service.resolveBookingRequest({ ...common, action: 'cannot_accommodate' });
  assert.deepEqual(calls.map(call => call[0]), ['accept', 'propose', 'cannot']);
  assert.equal(calls[0][1].principal.id, 7);
  assert.equal(calls[1][1].startsAt, '2026-09-11T08:00:00.000Z');
});

test('Dashboard finalization route preserves session, same-origin and CSRF boundaries', async () => {
  const calls = [];
  const session = { ok: true, adminId: 7, viewer: { calendarScope: 'business_all_staff' }, csrfHash: 'test' };
  const sessionService = {
    async validateSessionToken(token) { return token === 'valid' ? session : { ok: false }; },
    validateCsrfToken(current, token) { return current === session && token === 'csrf'; },
  };
  const dashboardService = {
    async buildModel() { throw new Error('not used'); },
    async finalizeVisit(input) { calls.push(input); return { ok: true, appointmentId: 501, outcome: 'completed' }; },
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar/workspace', createWorkspaceOperationalRouter({ env: ENABLED_ENV, sessionService, dashboardService }));
  await withServer(app, async base => {
    const path = `${base}/calendar/workspace/appointments/501/finalize`;
    const body = JSON.stringify({ expectedRevision: '2026-09-05T06:30:00.000Z', outcome: 'completed' });
    assert.equal((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', origin: base, 'content-type': 'application/json', 'x-shiloh-csrf-token': 'bad' }, body })).status, 403);
    const response = await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', origin: base, 'content-type': 'application/json', 'x-shiloh-csrf-token': 'csrf' }, body });
    assert.equal(response.status, 200);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].adminId, 7);
  assert.equal(calls[0].viewer, session.viewer);
});

test('booking-request routes preserve session, same-origin and CSRF boundaries', async () => {
  const calls = [];
  const session = { ok: true, adminId: 7, viewer: { calendarScope: 'own_staff', staffId: 11 }, csrfHash: 'test' };
  const sessionService = {
    async validateSessionToken(token) { return token === 'valid' ? session : { ok: false }; },
    validateCsrfToken(current, token) { return current === session && token === 'csrf'; },
  };
  const dashboardService = {
    async buildModel() { throw new Error('not used'); },
    async resolveBookingRequest(input) { calls.push(input); return { ok: true, status: 'awaiting_client_confirmation' }; },
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar/workspace', createWorkspaceOperationalRouter({ env: ENABLED_ENV, sessionService, dashboardService }));
  await withServer(app, async base => {
    const path = `${base}/calendar/workspace/booking-requests/7651/propose`;
    const body = JSON.stringify({ expectedRevision: '2026-09-05T06:30:00.000Z', startsAt: '2026-09-11T08:00:00.000Z', staffId: 11 });
    assert.equal((await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', origin: base, 'content-type': 'application/json', 'x-shiloh-csrf-token': 'bad' }, body })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: 'shiloh_staff_session=valid', origin: base, 'content-type': 'application/json', 'x-shiloh-csrf-token': 'csrf' }, body })).status, 200);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    adminId: 7, viewer: session.viewer, appointmentId: '7651', action: 'propose',
    expectedRevision: '2026-09-05T06:30:00.000Z', startsAt: '2026-09-11T08:00:00.000Z', staffId: 11, serviceId: undefined,
  });
});
