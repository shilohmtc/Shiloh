'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkspaceDashboardError,
  createWorkspaceDashboardService,
  previousClinicDateKey,
  operationalDayWindow,
} = require('../src/services/workspaceDashboard');
const {
  createWorkspaceDashboardBacklogService,
} = require('../src/services/workspaceDashboardBacklog');
const {
  renderDashboardPage,
  dashboardClientScript,
} = require('../src/presentation/workspaceDashboardUx');

const NOW = new Date('2026-09-11T10:00:00.000Z');

function ownerPrincipal() {
  const principal = {
    id: 7,
    staff_id: 11,
    display_name: 'Jean-Pierre',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true, 'booking:update': true },
    admin_active: true,
    staff_status: 'active',
  };
  principal.calendarAuthority = {
    capabilities: ['appointment:view'],
    linkedStaffId: 11,
    businessRole: 'owner',
    calendarScope: 'all_business',
    serviceScope: 'all_services',
  };
  return principal;
}

function item(id, startsAt, endsAt, status = 'confirmed', staffIds = [11]) {
  return {
    id,
    kind: 'appointment',
    canonical: true,
    startsAt,
    endsAt,
    status,
    revision: startsAt,
    clientName: `Client ${id}`,
    serviceName: `Treatment ${id}`,
    staffIds,
    staff: staffIds.map(staffId => ({ staffId, nameSnapshot: staffId === 11 ? 'Abigail' : 'Christel' })),
  };
}

function day(dateKey, appointments) {
  return {
    dateKey,
    timeline: {
      staff: [
        { id: 11, displayName: 'Abigail' },
        { id: 22, displayName: 'Christel' },
      ],
      appointments,
      closures: [],
    },
  };
}

function messagesService() {
  return {
    async resolveAccess() { return null; },
    async buildModel() { throw new Error('not used'); },
  };
}

test('#849/#852 previous clinic day helper remains stable and skips permanently closed Sunday', () => {
  assert.equal(previousClinicDateKey('2026-09-10'), '2026-09-09');
  assert.equal(previousClinicDateKey('2026-09-07'), '2026-09-05');
});

test('#852 Dashboard keeps unresolved Wednesday and Thursday visits visible on Friday', async () => {
  const reads = [];
  const backlogReads = [];
  const certify = [];
  const today = day('2026-09-11', [
    item(501, '2026-09-11T06:00:00.000Z', '2026-09-11T07:00:00.000Z'),
  ]);
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => ownerPrincipal(),
    calendarService: {
      async buildModel(input) {
        reads.push(input);
        return today;
      },
    },
    backlogService: {
      async listUnresolvedPastAppointments(input) {
        backlogReads.push(input);
        return {
          staff: [{ id: 11, displayName: 'Abigail' }],
          appointments: [
            item(601, '2026-09-09T06:00:00.000Z', '2026-09-09T07:00:00.000Z'),
            item(602, '2026-09-10T08:00:00.000Z', '2026-09-10T09:00:00.000Z'),
            item(603, '2026-09-10T10:00:00.000Z', '2026-09-10T11:00:00.000Z', 'completed'),
            item(604, '2026-09-08T12:00:00.000Z', '2026-09-08T13:00:00.000Z', 'no_show'),
          ],
        };
      },
    },
    messagesService: messagesService(),
    bookingRequestService: { async listUnresolvedBookingRequests() { return []; } },
    finalizeAppointmentFn: async () => ({ status: 'updated' }),
    canCertifyAppointmentFn: async (_principal, appointmentId, _pool, options) => {
      certify.push({ appointmentId, options });
      return Number(appointmentId) !== 501;
    },
  });

  const model = await service.buildModel({
    adminId: 7,
    viewer: { calendarScope: 'business_all_staff' },
    now: NOW,
  });

  assert.equal(reads.length, 1);
  assert.equal(reads[0].date, '2026-09-11');
  assert.equal(reads[0].view, 'day');
  assert.equal(reads[0].viewer.calendarScope, 'all_business');
  assert.equal(backlogReads.length, 1);
  assert.equal(backlogReads[0].before, '2026-09-10T22:00:00.000Z');
  assert.equal(backlogReads[0].viewer.calendarScope, 'all_business');
  assert.deepEqual(model.carryOver.map(row => row.id), [601, 602]);
  assert.deepEqual(model.carryOver.map(row => row.operationalDateKey), ['2026-09-09', '2026-09-10']);
  assert.ok(model.carryOver.every(row => row.canFinalize === true));
  assert.deepEqual(certify.map(entry => entry.appointmentId).sort((a, b) => a - b), [501, 601, 602]);
  assert.ok(certify.every(entry => entry.options.workspace === true && entry.options.allowBusinessBackup === true));
});

test('#852 canonical backlog read scopes the historical queue through SchedulingTimeline viewer authority', async () => {
  const queries = [];
  const service = createWorkspaceDashboardBacklogService({
    async query(text, params) {
      queries.push({ text, params });
      if (text.includes('WorkspaceDashboardBacklog:staff')) {
        assert.deepEqual(params, [[11]]);
        return { rows: [{ id: 11, display_name: 'Abigail' }] };
      }
      assert.match(text, /a\.status NOT IN \('completed','cancelled','no_show'\)/);
      assert.match(text, /ast\.staff_id = ANY\(\$2::bigint\[\]\)/);
      assert.deepEqual(params[1], [11]);
      return {
        rows: [{
          appointment_id: 701,
          starts_at: '2026-09-09T06:00:00.000Z',
          ends_at: '2026-09-09T07:00:00.000Z',
          status: 'confirmed',
          record_source: 'workspace',
          updated_at: '2026-09-09T05:00:00.000Z',
          client_name: 'Scoped Client',
          service_name: 'Treatment',
          service_contexts: [],
          assigned_staff_id: 11,
          staff_name_snapshot: 'Abigail',
        }],
      };
    },
  });

  const result = await service.listUnresolvedPastAppointments({
    before: '2026-09-10T22:00:00.000Z',
    viewer: { calendarScope: 'own_appointments', staffId: 11 },
  });

  assert.equal(queries.length, 2);
  assert.deepEqual(result.appointments.map(row => row.id), [701]);
  assert.deepEqual(result.appointments[0].staffIds, [11]);
});

test('#852 presentation groups unfinished carry-over by original clinic day', () => {
  const model = {
    generatedAt: NOW.toISOString(),
    requestedDateKey: '2026-09-11',
    operationalDateKey: '2026-09-11',
    carryOverDateKey: '2026-09-10',
    displayName: 'Jean-Pierre',
    mode: 'owner_overview',
    canFinalizeAllBusiness: true,
    calendar: day('2026-09-11', []),
    closures: [],
    appointments: [],
    teamGroups: [],
    awaitingFinalization: [],
    bookingRequests: [],
    recentActivity: [],
    carryOver: [
      { ...item(601, '2026-09-09T06:00:00.000Z', '2026-09-09T07:00:00.000Z'), operationalDateKey: '2026-09-09', canFinalize: true, needsFinalization: true },
      { ...item(602, '2026-09-10T08:00:00.000Z', '2026-09-10T09:00:00.000Z'), operationalDateKey: '2026-09-10', canFinalize: true, needsFinalization: true },
    ],
    communications: null,
    communicationsUnavailable: false,
  };
  const html = renderDashboardPage(model);
  assert.match(html, /data-dashboard-carryover-panel/);
  assert.match(html, /Unfinished visits/);
  assert.match(html, /Past visits stay here until they are recorded as Completed or No-show/);
  assert.match(html, /data-dashboard-carryover-day="2026-09-09"/);
  assert.match(html, /data-dashboard-carryover-day="2026-09-10"/);
  assert.match(html, /Client 601/);
  assert.match(html, /Client 602/);
  assert.match(html, /data-operational-date-key="2026-09-09"/);
  assert.match(html, /data-dashboard-finalize="completed"/);
  assert.match(html, /data-dashboard-finalize="no_show"/);
  assert.match(html, /date=2026-09-09/);
  assert.match(dashboardClientScript(), /operationalDateKey:card\.dataset\.operationalDateKey/);
});

test('#852 carry-over row without canonical certification remains visible but has no outcome buttons', () => {
  const model = {
    generatedAt: NOW.toISOString(), requestedDateKey: '2026-09-11', operationalDateKey: '2026-09-11', carryOverDateKey: '2026-09-10',
    displayName: 'Reception', mode: 'business_overview', canFinalizeAllBusiness: true, calendar: day('2026-09-11', []), closures: [], appointments: [], teamGroups: [],
    awaitingFinalization: [], bookingRequests: [], recentActivity: [], communications: null, communicationsUnavailable: false,
    carryOver: [{ ...item(601, '2026-09-09T06:00:00.000Z', '2026-09-09T07:00:00.000Z'), operationalDateKey: '2026-09-09', canFinalize: false, needsFinalization: true }],
  };
  const html = renderDashboardPage(model);
  const carryPanel = require('./helpers/extractHtmlSection').extractHtmlSection(html, 'data-dashboard-carryover-panel');
  assert.match(carryPanel, /Client 601/);
  assert.doesNotMatch(carryPanel, /data-dashboard-finalize=/);
  assert.match(carryPanel, /Open \/ manage/);
});

test('#852 finalization accepts older operational backlog dates but rejects future/non-operational dates', async () => {
  const calls = [];
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => ownerPrincipal(),
    calendarService: { async buildModel() { return day('2026-09-11', []); } },
    backlogService: { async listUnresolvedPastAppointments() { return { staff: [], appointments: [] }; } },
    messagesService: messagesService(),
    bookingRequestService: { async listUnresolvedBookingRequests() { return []; } },
    canCertifyAppointmentFn: async () => true,
    finalizeAppointmentFn: async (...args) => { calls.push(args); return { status: 'updated' }; },
  });
  const common = {
    adminId: 7,
    viewer: { calendarScope: 'business_all_staff' },
    appointmentId: 601,
    expectedRevision: '2026-09-09T06:00:00.000Z',
    outcome: 'completed',
    now: NOW,
  };
  await service.finalizeVisit({ ...common, operationalDateKey: '2026-09-09' });
  assert.deepEqual(calls[0][3], {
    ...operationalDayWindow('2026-09-09'),
    expectedRevision: '2026-09-09T06:00:00.000Z',
    workspace: true,
    allowBusinessBackup: true,
  });
  await assert.rejects(
    service.finalizeVisit({ ...common, operationalDateKey: '2026-09-13' }),
    error => error instanceof WorkspaceDashboardError && error.httpStatus === 400,
  );
  await assert.rejects(
    service.finalizeVisit({ ...common, operationalDateKey: '2026-09-12'.replace('12', '13') }),
    error => error instanceof WorkspaceDashboardError && error.httpStatus === 400,
  );
  assert.equal(calls.length, 1);
});
