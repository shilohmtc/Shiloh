const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  appointmentCanBeFinalized,
  appointmentCanBeMarkedNoShow,
  createWorkspaceDashboardService,
} = require('../src/services/workspaceDashboard');
const { renderDashboardPage, dashboardClientScript } = require('../src/presentation/workspaceDashboardUx');

function appointment(overrides = {}) {
  return {
    id: 7001,
    startsAt: '2026-09-22T12:00:00.000Z',
    endsAt: '2026-09-22T13:00:00.000Z',
    status: 'confirmed',
    revision: '2026-09-22T11:30:00.000Z',
    staffIds: [11],
    clientName: 'No-show proof client',
    serviceName: 'Treatment',
    ...overrides,
  };
}

const ownAuthority = { canFinalize: true, canFinalizeAllBusiness: false, linkedStaffId: 11 };

test('No-show becomes available at appointment start while Completed waits for the end', () => {
  const item = appointment();
  assert.equal(appointmentCanBeMarkedNoShow(item, ownAuthority, new Date('2026-09-22T11:59:59.999Z')), false);
  assert.equal(appointmentCanBeMarkedNoShow(item, ownAuthority, new Date('2026-09-22T12:00:00.000Z')), true);
  assert.equal(appointmentCanBeMarkedNoShow(item, ownAuthority, new Date('2026-09-22T12:30:00.000Z')), true);
  assert.equal(appointmentCanBeFinalized(item, ownAuthority, new Date('2026-09-22T12:30:00.000Z')), false);
  assert.equal(appointmentCanBeFinalized(item, ownAuthority, new Date('2026-09-22T13:00:00.000Z')), true);
  assert.equal(appointmentCanBeMarkedNoShow(appointment({ status: 'no_show' }), ownAuthority, new Date('2026-09-22T12:30:00.000Z')), false);
});

test('No-show keeps existing practitioner scope and business-backup authority', () => {
  const shared = appointment({ staffIds: [11, 22] });
  assert.equal(appointmentCanBeMarkedNoShow(shared, ownAuthority, new Date('2026-09-22T12:10:00.000Z')), false);
  assert.equal(appointmentCanBeMarkedNoShow(shared, { canFinalize: true, canFinalizeAllBusiness: true, linkedStaffId: null }, new Date('2026-09-22T12:10:00.000Z')), true);
});

test('active no-show presentation exposes only No-show and explains slot release', () => {
  const item = { ...appointment(), canFinalize: false, canMarkNoShow: true, operationalDateKey: '2026-09-22' };
  const html = renderDashboardPage({
    requestedDateKey: '2026-09-22', operationalDateKey: '2026-09-22', displayName: 'Staff', mode: 'my_day',
    calendar: { timeline: { staff: [{ id: 11, displayName: 'Staff' }], appointments: [], closures: [] } },
    closures: [], appointments: [item], teamGroups: [], carryOver: [], awaitingFinalization: [], bookingRequests: [],
    communications: null, communicationsUnavailable: false, recentActivity: [],
  });
  assert.match(html, /data-dashboard-finalize="no_show"/);
  assert.doesNotMatch(html, /data-dashboard-finalize="completed"/);
  assert.match(dashboardClientScript(), /release the remaining appointment time for booking/);
});

test('canonical availability and active mutation conflicts treat no-show as non-blocking', () => {
  const files = [
    'availabilityService.js',
    'adminAvailability.js',
    'calendarOperationalMutations.js',
    'adminBookingUpdate.js',
    'adminBookingUpdateStateless.js',
    'clientBookingApproval.js',
    'clientRescheduleApproval.js',
    'appointmentChange.js',
    'calendarAppointmentEndTime.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8');
    assert.match(source, /NOT IN \('cancelled','no_show'\)/, file);
  }
  const timeline = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'schedulingEngine.js'), 'utf8');
  assert.match(timeline, /a\.status <> 'cancelled'/);
});

test('Workspace delegates an active No-show with the explicit start-boundary guard', async () => {
  const calls = [];
  const principal = {
    id: 7,
    staff_id: 11,
    display_name: 'Staff',
    business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments',
    service_scope: 'own_services',
    permissions: { 'appointment:view': true, 'booking:update': true },
    calendarAuthority: {
      capabilities: ['appointment:view'],
      linkedStaffId: 11,
      businessRole: 'employee_practitioner',
      calendarScope: 'own_appointments',
      serviceScope: 'own_services',
    },
  };
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => principal,
    calendarService: { async buildModel() { return {}; } },
    messagesService: { async resolveAccess() { return false; }, async buildModel() { return {}; } },
    finalizeAppointmentFn: async (...args) => { calls.push(args); return { status: 'updated' }; },
    canCertifyAppointmentFn: async () => true,
  });

  const result = await service.finalizeVisit({
    adminId: 7,
    viewer: { calendarScope: 'own_staff', staffId: 11 },
    appointmentId: 7001,
    expectedRevision: '2026-09-22T11:30:00.000Z',
    outcome: 'no_show',
    operationalDateKey: '2026-09-22',
    now: new Date('2026-09-22T12:30:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'no_show');
  assert.equal(calls[0][3].allowStartedNoShow, true);
});

test('canonical finalizer uses the start boundary only for explicitly-enabled Workspace no-show', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminAppointmentFinalization.js'), 'utf8');
  assert.match(source, /allowStartedNoShow = false/);
  assert.match(source, /allowStartedNoShow \? 'a\.starts_at <= NOW\(\)' : 'a\.ends_at < NOW\(\)'/);
  assert.match(source, /allowStartedNoShow: workspace && targetStatus === 'no_show'/);
});
