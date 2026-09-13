const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const {
  renderCalendarPage,
  calendarFirstPhoneStyles,
} = require('../src/presentation/calendarReadOnlyUx');
const { periodFor } = require('../src/services/calendarReadOnlyUx');
const { resolveActiveWeekStaffId } = require('../src/routes/calendarReadOnlyUx');
const { staffCalendarAccessClientScript } = require('../src/presentation/staffCalendarAccessUx');

const STAFF = [
  { id: 31, displayName: 'Amber Room', schedulingType: 'regular' },
  { id: 32, displayName: 'Birch Room', schedulingType: 'regular' },
  { id: 33, displayName: 'Cedar Room', schedulingType: 'regular' },
];

function appointment(id, staffIds, startsAt, durationMinutes, clientName = `Client ${id}`) {
  return {
    id,
    kind: 'appointment',
    canonical: true,
    revision: `rev-${id}`,
    status: 'scheduled',
    clientName,
    clientMobile: '27821234567',
    serviceName: 'Synthetic treatment',
    serviceContexts: [{ serviceId: 81, categoryName: 'Massage' }],
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000).toISOString(),
    staffIds,
    staff: staffIds.map(staffId => ({
      staffId,
      nameSnapshot: STAFF.find(person => person.id === staffId)?.displayName,
    })),
  };
}

function model(view = 'week', visibleStaffIds = STAFF.map(person => person.id), {
  permittedStaff = STAFF,
  includeSundayInCraftedPeriod = false,
  mutationEnabled = false,
  activeStaffId = visibleStaffIds[0],
} = {}) {
  const visible = new Set(visibleStaffIds);
  const appointments = [
    appointment(9701, [31], '2026-09-07T06:00:00.000Z', 60, 'Short Client'),
    appointment(9702, [31, 32], '2026-09-11T07:00:00.000Z', 120, 'Shared Client'),
    appointment(9703, [33], '2026-09-12T09:00:00.000Z', 45, 'Saturday Client'),
    appointment(9799, [31], '2026-09-13T07:00:00.000Z', 60, 'Crafted Sunday Client'),
  ].filter(item => item.staffIds.some(staffId => visible.has(staffId)));
  const period = periodFor(view, '2026-09-11');
  if (view === 'week' && includeSundayInCraftedPeriod) period.dateKeys = [...period.dateKeys, '2026-09-13'];
  return {
    view,
    dateKey: '2026-09-11',
    period,
    selectedStaffId: visibleStaffIds.length === 1 ? visibleStaffIds[0] : null,
    visibleStaffIds,
    visibleStaffSelectionExplicit: true,
    activeStaffId,
    permittedStaff,
    timeline: {
      staff: STAFF.filter(person => visible.has(person.id)),
      workingWindows: [],
      scheduleExceptions: [],
      recurringClosures: [],
      closures: [],
      leave: [],
      externalBusy: [],
      blocks: [],
      appointments,
      events: appointments,
    },
    mutationCapability: mutationEnabled ? {
      enabled: true,
      operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      allowedServiceIds: null,
    } : { enabled: false },
  };
}

function peopleSummary(html) {
  return html.match(/data-people-selection-summary>([^<]+)<\/strong>/)?.[1];
}

test('top People selector truthfully summarizes all, one, and multiple permitted selections', () => {
  assert.equal(peopleSummary(renderCalendarPage(model('week', [31, 32, 33]))), 'All staff');
  assert.equal(peopleSummary(renderCalendarPage(model('week', [32]))), 'Birch Room');
  assert.equal(peopleSummary(renderCalendarPage(model('week', [31, 33]))), '2 staff');
});

test('People summary and controls never disclose a crafted unauthorized practitioner', () => {
  const html = renderCalendarPage(model('week', [31, 999], {
    permittedStaff: [STAFF[0], STAFF[1]],
  }));
  assert.equal(peopleSummary(html), 'Amber Room');
  assert.doesNotMatch(html, /Staff 999|Outside Scope|value="999"/);
});

test('Week retains practitioner context and lane headers while Agenda and Month retain attribution context', () => {
  const week = renderCalendarPage(model('week'));
  assert.match(week, /data-view-practitioner-context|People in view/);
  assert.equal((week.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.doesNotMatch(week, /data-week-practitioner-name/);
  assert.match(week, /class="event-practitioners"/);
  for (const view of ['agenda', 'month']) {
    assert.match(renderCalendarPage(model(view)), /data-view-practitioner-context/);
  }
});

test('Week stays Monday-Saturday even when handed a crafted Sunday display key', () => {
  const html = renderCalendarPage(model('week', [31, 32, 33], { includeSundayInCraftedPeriod: true }));
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.equal(new Set(Array.from(html.matchAll(/data-week-date-lane data-date="([^"]+)"/g), match => match[1])).size, 6);
  assert.match(html, /data-date="2026-09-07"/);
  assert.match(html, /data-date="2026-09-12"/);
  assert.doesNotMatch(html, /data-date="2026-09-13"|Crafted Sunday Client/);
});

test('Week event position and visual height continue to derive from canonical start and duration', () => {
  const html = renderCalendarPage(model('week'));
  assert.match(html, /--event-top:72px;--event-height:69px[\s\S]*?data-event-id="appointment-9701"/);
  assert.match(html, /--event-top:144px;--event-height:141px[\s\S]*?data-event-id="appointment-9702"/);
});

test('Week server markup carries only authorized availability actions for the desktop New menu', () => {
  const capable = renderCalendarPage(model('week', [31, 32], { mutationEnabled: true }));
  assert.match(capable, /data-desktop-availability-sources/);
  assert.equal((capable.match(/data-calendar-operation="add-block"/g) || []).length, 2);
  assert.equal((capable.match(/data-calendar-operation="add-leave"/g) || []).length, 2);
  assert.match(capable, /data-calendar-desktop-pending="true"/);

  const readOnly = renderCalendarPage(model('week', [31, 32]));
  assert.doesNotMatch(readOnly, /data-desktop-availability-sources|data-calendar-operation="add-block"|data-calendar-operation="add-leave"/);
});

test('shared Week appointments remain one canonical event with compact practitioner attribution', () => {
  const html = renderCalendarPage(model('week'));
  assert.equal((html.match(/data-event-id="appointment-9702"/g) || []).length, 1);
  assert.match(html, /aria-label="Practitioners: Amber Room \+ Birch Room"/);
  assert.match(html, /class="event-practitioner-compact" aria-hidden="true">AR\+BR<\/span>/);
});

test('Phone Week active practitioner is bounded to selected server-permitted People state', () => {
  const selected = model('week', [31, 32], { activeStaffId: 32 });
  const html = renderCalendarPage(selected);
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.match(html, /data-compact-week-active-staff="32">Birch Room/);
  assert.match(html, /data-compact-week-practitioner-option="31"/);
  assert.match(html, /activeStaff=31/);
  assert.match(html, /activeStaff=32/);
  assert.equal((html.match(/data-event-id="appointment-9702"/g) || []).length, 1);
  assert.match(html, /data-week-date-lane data-date="2026-09-11"[\s\S]*?data-event-id="appointment-9702"/);

  assert.equal(resolveActiveWeekStaffId('32', selected), 32);
  assert.equal(resolveActiveWeekStaffId('999', selected), 31);
  assert.equal(resolveActiveWeekStaffId(['31', '32'], selected), 31);
  const restricted = model('week', [31], { permittedStaff: [STAFF[0]], activeStaffId: 31 });
  assert.equal(resolveActiveWeekStaffId('999', restricted), 31);
  assert.doesNotMatch(renderCalendarPage(restricted), /Staff 999|value="999"|activeStaff=999/);
});

test('Day keeps the established practitioner lane model unchanged', () => {
  const html = renderCalendarPage(model('day', [31, 32]));
  assert.match(html, /class="time-grid day-time-grid" data-visible-lane-count="2"/);
  assert.equal((html.match(/class="lane" style="overflow:visible"/g) || []).length, 2);
  assert.doesNotMatch(html, /data-spatial-week/);
});

test('spatial Phone Week uses the canonical card as the whole-event management target', () => {
  const html = renderCalendarPage(model('week', [31, 32], { mutationEnabled: true }));
  const css = calendarFirstPhoneStyles();
  assert.match(html, /data-appointment-management-target="true"/);
  assert.doesNotMatch(html, /data-calendar-operation="manage-appointment">Manage<\/button>/);
  assert.match(html, /data-calendar-management-panel/);
  assert.match(css, /\.event-operation\{position:absolute!important;inset:0!important/);
  assert.match(css, /min-width:44px!important;min-height:44px!important/);
  assert.match(css, /opacity:0!important;cursor:pointer!important/);
});

test('Week overlap allocation remains one implementation with Phone-specific presentation variables', () => {
  const script = staffCalendarAccessClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /--week-event-left/);
  assert.match(script, /--week-event-width/);
  assert.match(script, /data-week-overlap-layout','phone/);
  assert.match(script, /data-week-overlap-layout','desktop/);
});

test('authenticated browser proof mounts canonical Calendar and Create Booking router factories', () => {
  const source = fs.readFileSync(require.resolve('../scripts/calendar-spatial-phone-week-browser-proof'), 'utf8');
  assert.match(source, /createCalendarReadOnlyRouter\(\{/);
  assert.match(source, /createCalendarCreateBookingRouter\(\{/);
  assert.match(source, /retrospectiveBookingService:\s*\{\s*async resolveOperator\(\)/);
  assert.doesNotMatch(source, /phone-day-empty-time-prefill/);
  assert.match(source, /phone-week-empty-slot-booking/);
  assert.match(source, /phone-narrow-direct-drawer/);
  assert.match(source, /phone-plus-actions/);
  assert.match(source, /phone-week-planner-all-practitioners/);
  assert.match(source, /phone-week-active-practitioner-switch/);
  assert.match(source, /phone-appointment-manage-sheet/);
  assert.match(source, /calendarViewportShare >= 0\.70/);
  assert.match(source, /\['week', 'agenda', 'month'\]/);
  assert.match(source, /time: '11:00', staff: '52'/);
  assert.match(source, /data-week-date-lane/);
  assert.match(source, /practitionerLaneCount, 0/);
  assert.match(source, /phone-month-appointment-overview/);
  assert.match(source, /visibleAppointmentCards > 0/);
  assert.match(source, /densityCount, 0/);
  assert.match(source, /desktop-approved-calendar-contract/);
  assert.match(source, /desktop-first-paint-pending/);
  assert.match(source, /desktop-new-menu-complete/);
  assert.match(source, /calendarDesktopApprovedClientScript/);
  assert.match(source, /workspaceIconClientScript/);
  assert.doesNotMatch(source, /calendarReadOnlyRoutes\(\{/);
});
