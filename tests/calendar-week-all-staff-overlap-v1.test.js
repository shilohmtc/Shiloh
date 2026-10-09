const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  allocateWeekOverlapLanes,
  staffCalendarAccessClientScript,
} = require('../src/presentation/staffCalendarAccessUx');
const { renderEventCard, calendarFirstPhoneStyles } = require('../src/presentation/calendarReadOnlyUx');

function rectangle(id, top, height) {
  return { id, top, height };
}

function appointment(overrides = {}) {
  return {
    id: 7401,
    kind: 'appointment',
    canonical: true,
    revision: 'rev-7401',
    status: 'scheduled',
    clientName: 'Week Client',
    clientMobile: '27821234567',
    serviceName: 'Full Body Swedish',
    startsAt: '2026-09-11T07:00:00.000Z',
    endsAt: '2026-09-11T08:30:00.000Z',
    staffIds: [12],
    staff: [{ staffId: 12, nameSnapshot: 'Christel' }],
    serviceContexts: [{ serviceId: 33, categoryName: 'Massage' }],
    ...overrides,
  };
}

function model(item = appointment()) {
  return {
    permittedStaff: [{ id: 12, displayName: 'Christel' }],
    mutationCapability: {
      enabled: true,
      operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      allowedServiceIds: null,
    },
    timeline: { events: [item] },
  };
}

test('Week overlap allocator makes simultaneous staff bookings separate deterministic lanes', () => {
  const layout = allocateWeekOverlapLanes([
    rectangle('helen', 144, 105),
    rectangle('melindi', 144, 105),
    rectangle('elani', 288, 105),
  ]);

  assert.equal(layout.laneCount, 2);
  assert.deepEqual(
    layout.entries.map(entry => [entry.id, entry.laneIndex]),
    [['helen', 0], ['melindi', 1], ['elani', 0]],
  );
});

test('Week overlap allocator keeps non-overlapping bookings in one full-width lane', () => {
  const layout = allocateWeekOverlapLanes([
    rectangle('first', 144, 69),
    rectangle('second', 213, 69),
    rectangle('third', 288, 69),
  ]);

  assert.equal(layout.laneCount, 1);
  assert.deepEqual(layout.entries.map(entry => entry.laneIndex), [0, 0, 0]);
});

test('Week overlap allocator handles partial visual overlaps and reuses the first available lane', () => {
  const layout = allocateWeekOverlapLanes([
    rectangle('long', 144, 180),
    rectangle('middle', 180, 54),
    rectangle('later', 234, 54),
  ]);

  assert.equal(layout.laneCount, 2);
  assert.deepEqual(
    layout.entries.map(entry => [entry.id, entry.laneIndex]),
    [['long', 0], ['middle', 1], ['later', 1]],
  );
});

test('Week client layout uses one allocator and expands tracks only on Desktop', () => {
  const script = staffCalendarAccessClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /\.week-view \.week-grid/);
  assert.match(script, /\(min-width: 701px\)/);
  assert.match(script, /data-week-overlap-layout/);
  assert.match(script, /gridTemplateColumns/);
  assert.match(script, /baseLaneWidth=190/);
  assert.match(script, /\.time-column > \.positioned-event/);
  assert.match(script, /removeProperty\('left'\)/);
  assert.match(script, /removeProperty\('width'\)/);
  assert.match(script, /--week-event-left/);
  assert.match(script, /--week-event-width/);
  assert.match(script, /data-week-overlap-layout','phone/);
});

test('spatial Phone appointments remain whole-card touch targets', () => {
  const phoneCss = calendarFirstPhoneStyles();
  assert.match(phoneCss, /@media\(max-width:700px\)/);
  assert.match(phoneCss, /\.positioned-event \.event-operation\{position:absolute!important;inset:0!important/);
  assert.match(phoneCss, /min-width:44px!important;min-height:44px!important/);
});

test('Week visibility layout keeps the card-bound management data contract', () => {
  const item = appointment();
  const html = renderEventCard(item, model(item));

  assert.match(html, /data-appointment-id="7401"/);
  assert.match(html, /data-revision="rev-7401"/);
  assert.match(html, /data-staff-ids="12"/);
  assert.match(html, /data-client-name="Week Client"/);
  assert.match(html, /data-service-name="Full Body Swedish"/);
  assert.match(html, /data-allowed-operations="appointment:reschedule,appointment:cancel,appointment:reassign"/);
  assert.match(html, /data-appointment-management-target="true"/);
  assert.doesNotMatch(html, /data-calendar-operation="manage-appointment">Manage<\/button>/);
  assert.match(html, /Week Client/);
  assert.match(html, /082 123 4567/);
  assert.match(html, /Full Body Swedish/);
});
