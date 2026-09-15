const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_REPORT_DAYS,
  evaluateReportAuthority,
  resolvePeriod,
  createWorkspaceReportsService,
} = require('../src/services/workspaceReports');
const { renderReportsPage } = require('../src/presentation/workspaceReportsUx');
const {
  createWorkspaceReportsHandler,
  setWorkspaceReportsSecurityHeaders,
} = require('../src/routes/workspaceReports');

function ownerRow(overrides = {}) {
  return {
    id: 7,
    staff_id: 2,
    display_name: 'Christel',
    calendar_scope: 'all_business',
    permissions: { 'appointment:view': true },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function fakeDb({ authority = ownerRow() } = {}) {
  const seen = [];
  let statusCall = 0;
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (/WorkspaceReports:principal/.test(sql)) return { rows: [authority], rowCount: 1 };
      if (/WorkspaceReports:appointment_status/.test(sql)) {
        statusCall += 1;
        const current = statusCall === 1;
        return {
          rows: current
            ? [{ status: 'booked', count: 1 }, { status: 'cancelled', count: 1 }]
            : [{ status: 'booked', count: 1 }],
          rowCount: current ? 2 : 1,
        };
      }
      if (/WorkspaceReports:client_summary/.test(sql)) {
        return { rows: [{ unique_clients: 2, new_clients: 1, returning_clients: 1 }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function timelineFixture() {
  return {
    staff: [{ id: 2, displayName: 'Christel' }],
    workingWindows: [
      { staffId: 2, dayOfWeek: 1, startsLocal: '08:00:00', endsLocal: '17:00:00', locationId: 1 },
    ],
    scheduleExceptions: [],
    closures: [],
    appointments: [{
      id: 100,
      startsAt: '2026-08-31T08:00:00.000Z',
      endsAt: '2026-08-31T09:00:00.000Z',
      status: 'booked',
      staffIds: [2],
      serviceName: 'Sports Massage',
      serviceContexts: [{ serviceId: 12, serviceName: 'Sports Massage', categoryName: 'Massage' }],
    }],
    blocks: [{
      id: 200,
      startsAt: '2026-08-31T12:00:00.000Z',
      endsAt: '2026-08-31T13:00:00.000Z',
      staffIds: [2],
    }],
    leave: [],
  };
}

function reportModel() {
  return {
    authority: { reportScope: 'all_business', displayName: 'Christel' },
    period: { preset: '7d', startKey: '2026-08-25', endInclusiveKey: '2026-08-31', dayCount: 7 },
    selectedStaffId: null,
    permittedStaff: [{ id: 2, displayName: '<Christel>' }],
    appointments: { operational: 3, allRecorded: 4, statusCounts: { booked: 3, cancelled: 1 } },
    totals: { bookedMinutes: 180, remainingMinutes: 600, utilisationPct: 23 },
    capacity: [{
      staffId: 2,
      name: '<Christel>',
      scheduledMinutes: 900,
      bookedMinutes: 180,
      blockedMinutes: 60,
      leaveMinutes: 60,
      remainingMinutes: 600,
      utilisationPct: 23,
    }],
    services: [{ name: '<Massage>', category: 'Body', appointments: 3 }],
    clients: { uniqueClients: 3, newClients: 1, returningClients: 2 },
    closures: 0,
    trend: { delta: 1, currentOperationalAppointments: 3, previousOperationalAppointments: 2 },
  };
}

test('Reports authority reuses appointment:view and Calendar visibility without granting new access', () => {
  const business = evaluateReportAuthority([ownerRow()]);
  assert.equal(business.reportScope, 'all_business');
  assert.deepEqual(business.timelineViewer, { calendarScope: 'all_business' });

  const own = evaluateReportAuthority([ownerRow({ calendar_scope: 'own_appointments', staff_id: 9 })]);
  assert.equal(own.reportScope, 'own_staff');
  assert.equal(own.staffId, 9);
  assert.deepEqual(own.timelineViewer, { calendarScope: 'own_appointments', staffId: 9 });

  assert.equal(evaluateReportAuthority([ownerRow({ permissions: {} })]), null);
  assert.equal(evaluateReportAuthority([ownerRow({ calendar_scope: 'none' })]), null);
  assert.equal(evaluateReportAuthority([ownerRow({ staff_status: 'inactive' })]), null);
});

test('Reports dates include the selected end date and remain limited to 31 days', () => {
  const period = resolvePeriod({ from: '2026-08-31', to: '2026-08-31' });
  assert.equal(period.dayCount, 1);
  assert.equal(period.startKey, '2026-08-31');
  assert.equal(period.endKey, '2026-09-01');
  assert.throws(
    () => resolvePeriod({ from: '2026-08-01', to: '2026-09-01' }),
    error => error.code === 'WORKSPACE_REPORTS_RANGE_TOO_LARGE'
      && error.message.includes(String(MAX_REPORT_DAYS)),
  );
});

test('Reports derive team time from the scheduling timeline and use read-only aggregate queries', async () => {
  const db = fakeDb();
  const calls = [];
  const service = createWorkspaceReportsService({
    db,
    listTimeline: async input => { calls.push(input); return timelineFixture(); },
  });

  const model = await service.buildReport({
    adminId: 7,
    from: '2026-08-31',
    to: '2026-08-31',
    now: new Date('2026-08-31T10:00:00+02:00'),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].viewer.calendarScope, 'all_business');
  assert.equal(model.capacity[0].scheduledMinutes, 9 * 60);
  assert.equal(model.capacity[0].bookedMinutes, 60);
  assert.equal(model.capacity[0].blockedMinutes, 60);
  assert.equal(model.capacity[0].remainingMinutes, 7 * 60);
  assert.equal(model.services[0].name, 'Sports Massage');
  assert.deepEqual(model.clients, { uniqueClients: 2, newClients: 1, returningClients: 1 });
  assert.equal(model.appointments.statusCounts.cancelled, 1);

  for (const { sql } of db.seen) {
    assert.match(sql, /WorkspaceReports:/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
  }
});

test('Own-team-member report access rejects another staff filter before loading timeline data', async () => {
  const db = fakeDb({ authority: ownerRow({ calendar_scope: 'own_services', staff_id: 2 }) });
  let timelineCalls = 0;
  const service = createWorkspaceReportsService({
    db,
    listTimeline: async () => { timelineCalls += 1; return timelineFixture(); },
  });

  await assert.rejects(
    service.buildReport({ adminId: 7, from: '2026-08-31', to: '2026-08-31', staff: '3' }),
    error => error.code === 'WORKSPACE_REPORTS_STAFF_FORBIDDEN' && error.httpStatus === 403,
  );
  assert.equal(timelineCalls, 0);
});

test('Reports presentation uses staff-friendly wording and escapes names and treatments', () => {
  const html = renderReportsPage(reportModel());
  assert.match(html, /data-workspace-reports="true"/);
  assert.match(html, /A clear view of appointments, team time and clients/);
  assert.match(html, /All team members/);
  assert.match(html, /View report/);
  assert.match(html, /Team booking time/);
  assert.match(html, /Treatments booked/);
  assert.match(html, /New and returning clients/);
  assert.match(html, /Payments and income are shown separately/);
  assert.doesNotMatch(html, /canonical|business-wide operational scope|practitioner authority|service snapshot|aggregate identity|utilisation/i);
  assert.doesNotMatch(html, /<Christel>|<Massage>/);
  assert.match(html, /&lt;Christel&gt;/);
  assert.match(html, /&lt;Massage&gt;/);
});

test('Reports route keeps private no-store security and returns friendly access errors without leaking details', async () => {
  const headers = {};
  const res = {
    setHeader(name, value) { headers[name] = value; },
  };
  setWorkspaceReportsSecurityHeaders(res);
  assert.equal(headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(headers['X-Frame-Options'], 'DENY');

  const handler = createWorkspaceReportsHandler({
    env: {
      SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
      SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
    },
    service: {
      async buildReport() {
        const error = new Error('secret detail');
        error.code = 'WORKSPACE_REPORTS_FORBIDDEN';
        error.httpStatus = 403;
        throw error;
      },
    },
    renderUnavailable: ({ message }) => `safe:${message}`,
  });
  const routeRes = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
  };
  await handler({ staffBrowserSession: { adminId: 7 }, query: {} }, routeRes);
  assert.equal(routeRes.statusCode, 403);
  assert.match(routeRes.body, /You do not have access to this report/);
  assert.doesNotMatch(routeRes.body, /secret detail|scope|authority|canonical/i);
});
