const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOperationalDays,
  createCalendarReadOnlyUxService,
  normalizeOperationalDateKey,
  normalizeView,
  periodFor,
} = require('../src/services/calendarReadOnlyUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const {
  CALENDAR_VIEWER_CONTEXT,
  applyCalendarResponsivePolish,
  createCalendarReadOnlyHandler,
} = require('../src/routes/calendarReadOnlyUx');

const STAFF = [
  { id: 21, displayName: 'Amber Studio', schedulingType: 'regular' },
  { id: 22, displayName: 'Birch Studio', schedulingType: 'regular' },
  { id: 23, displayName: 'Cedar Studio', schedulingType: 'regular' },
];

function appointment(id, staffIds, day, hour, clientName = `Client ${id}`) {
  const startsAt = `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
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
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
    staffIds,
    staff: staffIds.map(staffId => ({
      staffId,
      nameSnapshot: STAFF.find(person => person.id === staffId)?.displayName,
    })),
  };
}

function timelineFixture() {
  const appointments = [
    appointment(9201, [21], '2026-09-02', 6, 'Amber Client'),
    appointment(9202, [21, 22], '2026-09-18', 7, 'Shared Client'),
    appointment(9203, [23], '2026-09-18', 8, 'Cedar Client'),
  ];
  const blocks = [{
    id: 9301,
    kind: 'calendar_block',
    canonical: true,
    startsAt: '2026-09-18T10:00:00.000Z',
    endsAt: '2026-09-18T11:00:00.000Z',
    staffIds: [23],
    blockType: 'admin',
    title: 'Planning block',
  }];
  return {
    staff: STAFF,
    workingWindows: STAFF.map(person => ({ staffId: person.id, dayOfWeek: 3, startsLocal: '08:00:00', endsLocal: '17:00:00' })),
    scheduleExceptions: [],
    recurringClosures: [],
    closures: [],
    appointments,
    blocks,
    leave: [],
    externalBusy: [],
    events: [...appointments, ...blocks],
  };
}

function fakeResponse() {
  return {
    statusCode: null,
    body: '',
    headersSent: false,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(value) { this.body = String(value); this.headersSent = true; return this; },
  };
}

function model(view, visibleStaffIds = [21, 22, 23], timeline = timelineFixture()) {
  const visible = new Set(visibleStaffIds);
  const filteredAppointments = timeline.appointments.filter(item => item.staffIds.some(id => visible.has(id)));
  const filteredBlocks = timeline.blocks.filter(item => item.staffIds.some(id => visible.has(id)));
  return {
    view,
    dateKey: '2026-09-18',
    period: periodFor(view, '2026-09-18'),
    selectedStaffId: visibleStaffIds.length === 1 ? visibleStaffIds[0] : null,
    visibleStaffIds,
    visibleStaffSelectionExplicit: true,
    permittedStaff: STAFF,
    timeline: {
      ...timeline,
      staff: STAFF.filter(person => visible.has(person.id)),
      workingWindows: timeline.workingWindows.filter(item => visible.has(item.staffId)),
      appointments: filteredAppointments,
      blocks: filteredBlocks,
      events: [...filteredAppointments, ...filteredBlocks],
    },
    publicHolidays: [],
    mutationCapability: { enabled: false },
  };
}

test('Month is a canonical view while unknown views still fail closed', () => {
  assert.equal(normalizeView('MONTH'), 'month');
  assert.throws(() => normalizeView('quarter'), error => error.code === 'CALENDAR_UX_INVALID_VIEW');
});

test('Month period uses a deterministic Monday-aligned Monday-Saturday grid and calendar-month navigation', () => {
  const period = periodFor('month', '2026-09-18');
  assert.equal(period.startKey, '2026-09-01');
  assert.equal(period.endKey, '2026-10-01');
  assert.equal(period.displayStartKey, '2026-08-31');
  assert.equal(period.displayEndKey, '2026-10-05');
  assert.equal(period.previousAnchor, '2026-08-01');
  assert.equal(period.nextAnchor, '2026-10-01');
  assert.equal(period.dateKeys.length, 30);
  assert.equal(period.dateKeys[0], '2026-08-31');
  assert.equal(period.dateKeys.at(-1), '2026-10-03');
  assert.equal(period.dateKeys.some(day => new Date(`${day}T12:00:00Z`).getUTCDay() === 0), false);
  assert.equal(period.from, '2026-08-31T22:00:00.000Z');
  assert.equal(period.to, '2026-09-30T22:00:00.000Z');

  const sixWeekPeriod = periodFor('month', '2026-08-15');
  assert.equal(sixWeekPeriod.dateKeys.length, 36);
  assert.equal(sixWeekPeriod.displayStartKey, '2026-07-27');
  assert.equal(sixWeekPeriod.displayEndKey, '2026-09-07');

  const yearBoundary = periodFor('month', '2027-01-20');
  assert.equal(yearBoundary.previousAnchor, '2026-12-01');
  assert.equal(yearBoundary.nextAnchor, '2027-02-01');
});

test('Day, Week and Agenda navigation skips Sunday deterministically', () => {
  assert.equal(normalizeOperationalDateKey('2026-09-20'), '2026-09-21');
  assert.equal(addOperationalDays('2026-09-21', -1), '2026-09-19');

  const day = periodFor('day', '2026-09-20');
  assert.deepEqual(day.dateKeys, ['2026-09-21']);
  assert.equal(day.previousAnchor, '2026-09-19');
  assert.equal(day.nextAnchor, '2026-09-22');

  const week = periodFor('week', '2026-09-20');
  assert.deepEqual(week.dateKeys, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  assert.equal(week.previousAnchor, '2026-09-14');
  assert.equal(week.nextAnchor, '2026-09-28');

  const agenda = periodFor('agenda', '2026-09-20');
  assert.deepEqual(agenda.dateKeys, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28']);
  assert.equal(agenda.previousAnchor, '2026-09-12');
  assert.equal(agenda.nextAnchor, '2026-09-29');
});

test('Month resolution follows the Africa/Johannesburg calendar date at the UTC boundary', async () => {
  const calls = [];
  const service = createCalendarReadOnlyUxService({
    listTimeline: async input => { calls.push(input); return timelineFixture(); },
    query: async () => ({ rows: [] }),
  });
  const result = await service.buildModel({
    view: 'month',
    now: new Date('2026-08-31T22:30:00.000Z'),
    staff: ['21', '22'],
    viewer: { staffId: 99, calendarScope: 'all_business' },
  });
  assert.equal(result.dateKey, '2026-09-01');
  assert.equal(result.period.startKey, '2026-09-01');
  assert.equal(calls[0].from, '2026-08-31T22:00:00.000Z');
  assert.equal(calls[0].to, '2026-09-30T22:00:00.000Z');
});

test('Month reuses the server-permitted People filter and rejects a crafted unauthorized practitioner', async () => {
  const permittedTimeline = { ...timelineFixture(), staff: STAFF.slice(0, 2) };
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => permittedTimeline,
    query: async () => ({ rows: [] }),
  });
  await assert.rejects(
    service.buildModel({
      view: 'month', date: '2026-09-18', staff: ['21', '999'],
      viewer: { staffId: 99, calendarScope: 'all_business' },
    }),
    error => error.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN',
  );

  const handler = createCalendarReadOnlyHandler({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true' },
    buildModel: input => service.buildModel(input),
  });
  const request = {
    query: { view: 'month', date: '2026-09-18', staff: ['21', '999'] },
    baseUrl: '/calendar/read-only',
  };
  request[CALENDAR_VIEWER_CONTEXT] = {
    authenticated: true,
    source: 'server_staff_session',
    viewer: { staffId: 99, calendarScope: 'all_business' },
  };
  const response = fakeResponse();
  await handler(request, response, () => {});
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /outside your Calendar access/i);
  assert.doesNotMatch(response.body, /Amber Client|Shared Client|Birch Studio/);
});

test('practitioner attribution never exposes an assignment outside the server-permitted staff set', () => {
  const timeline = timelineFixture();
  const shared = appointment(9250, [21, 999], '2026-09-18', 7, 'Scoped Client');
  shared.staff = [
    { staffId: 21, nameSnapshot: 'Amber Studio' },
    { staffId: 999, nameSnapshot: 'Outside Scope' },
  ];
  timeline.appointments = [shared];
  timeline.blocks = [];
  timeline.events = [shared];
  const scoped = model('month', [21], timeline);
  scoped.permittedStaff = [STAFF[0]];
  const html = renderCalendarPage(scoped);
  assert.match(html, /Amber Studio/);
  assert.doesNotMatch(html, /Outside Scope|Staff 999/);
});

test('Month filters canonical timeline collections to selected permitted practitioners server-side', async () => {
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => timelineFixture(),
    query: async () => ({ rows: [] }),
  });
  const result = await service.buildModel({
    view: 'month', date: '2026-09-18', staff: ['23'],
    viewer: { staffId: 99, calendarScope: 'all_business' },
  });
  assert.deepEqual(result.visibleStaffIds, [23]);
  assert.deepEqual(result.timeline.staff.map(person => person.id), [23]);
  assert.deepEqual(result.timeline.appointments.map(item => item.id), [9203]);
  assert.deepEqual(result.timeline.blocks.map(item => item.id), [9301]);
  assert.deepEqual(result.timeline.events.map(item => item.id), [9203, 9301]);
});

test('Week, Agenda and Month navigation preserve the complete selected People set while Day remains compatibility-renderable', () => {
  for (const view of ['day', 'week', 'agenda', 'month']) {
    const html = renderCalendarPage(model(view, [21, 23]));
    for (const target of ['week', 'agenda', 'month']) {
      assert.match(html, new RegExp(`view=${target}&amp;date=2026-09-18&amp;staff=21&amp;staff=23`));
    }
    assert.doesNotMatch(html, /data-calendar-view-option="day"/);
    assert.match(html, /staff=21&amp;staff=23/);
  }
});

test('Week retains top People selector plus date lanes and practitioner attribution', () => {
  const week = renderCalendarPage(model('week', [21, 22, 23]));
  assert.match(week, /data-view-practitioner-context|People in view/);
  assert.equal((week.match(/data-week-date-lane(?=[ >])/g) || []).length, 6);
  assert.doesNotMatch(week, /<section class="week-day week-practitioner-lane"/);
  assert.match(week, /data-people-selection-summary>All staff<\/strong>/);
  assert.match(week, /class="event-practitioners"/);
  assert.match(week, /Amber Studio \+ Birch Studio/);

  const agenda = renderCalendarPage(model('agenda', [21, 22, 23]));
  assert.match(agenda, /data-view-practitioner-context/);
  assert.equal((agenda.match(/class="view-practitioner"/g) || []).length, 3);
  assert.match(agenda, /Amber Studio \+ Birch Studio/);
});

test('A shared appointment remains one canonical booking in Week, Agenda and Month', () => {
  for (const view of ['week', 'agenda', 'month']) {
    const html = renderCalendarPage(model(view));
    assert.equal((html.match(/data-event-id="appointment-9202"/g) || []).length, 1, `${view} duplicated a shared appointment`);
    assert.match(html, /Amber Studio \+ Birch Studio/);
  }
});

test('Month renders a Monday-aligned Monday-Saturday grid with subdued outside dates and practitioner ownership', () => {
  const html = renderCalendarPage(model('month'));
  assert.match(html, /data-view="month" data-month="2026-09"/);
  assert.match(html, /<h2>September 2026<\/h2>/);
  assert.match(html, /Mon<\/span><span>Tue/);
  assert.doesNotMatch(html, /<span>Sun<\/span>/);
  assert.equal((html.match(/class="month-day(?: outside-month)?"/g) || []).length, 30);
  assert.doesNotMatch(html, /data-date="2026-09-20"/);
  assert.match(html, /class="month-day outside-month" data-date="2026-08-31"/);
  assert.match(html, /class="event-practitioners"/);
  assert.match(html, /Amber Studio \+ Birch Studio/);
  assert.match(html, /view=week&amp;date=2026-09-18&amp;staff=21&amp;staff=22&amp;staff=23/);
});

test('Every Month cell is a full-cell link and canonical South African holidays are visible and accessible', () => {
  const holidayModel = model('month');
  holidayModel.publicHolidays = [{ date: '2026-09-24', name: 'Heritage Day', observed: false, countryCode: 'ZA' }];
  const html = renderCalendarPage(holidayModel);
  assert.equal((html.match(/class="month-day-link"/g) || []).length, holidayModel.period.dateKeys.length);
  assert.match(html, /class="month-day public-holiday" data-date="2026-09-24" data-item-count="0" data-public-holiday="Heritage Day"/);
  assert.match(html, /aria-label="Open Thursday, 24 September 2026, 0 items\. South African public holiday: Heritage Day"/);
  assert.match(html, /class="month-holiday"[^>]*>.*Heritage Day/);
  assert.match(html, /\.month-day-link\{position:absolute;inset:0;z-index:1/);
  assert.match(html, /\.month-events\{position:relative;z-index:3/);
});

test('Sunday public holiday remains canonical while its observed Monday is visible', async () => {
  const timeline = timelineFixture();
  timeline.closures = [
    { id: 'holiday:2026-08-09', kind: 'clinic_closure', canonical: true, date: '2026-08-09', reason: "National Women's Day", observed: false },
    { id: 'holiday:2026-08-10', kind: 'clinic_closure', canonical: true, date: '2026-08-10', reason: "National Women's Day observed", observed: true },
  ];
  timeline.events = [...timeline.appointments, ...timeline.blocks, ...timeline.closures];
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => timeline,
    query: async () => ({ rows: [] }),
  });
  const result = await service.buildModel({
    view: 'month', date: '2026-08-10', staff: ['21'],
    viewer: { staffId: 99, calendarScope: 'all_business' },
  });
  assert.equal(result.authorizedTimeline.closures.length, 2);
  assert.deepEqual(result.timeline.closures.map(item => item.date), ['2026-08-10']);
  const html = renderCalendarPage(result);
  assert.match(html, /National Women&#39;s Day observed/);
  assert.match(html, /data-date="2026-08-10"/);
  assert.doesNotMatch(html, /data-date="2026-08-09"/);
});

test('Month density is bounded truthfully with a deterministic day drill-in', () => {
  const timeline = timelineFixture();
  timeline.appointments = [
    appointment(9401, [21], '2026-09-18', 6),
    appointment(9402, [21], '2026-09-18', 7),
    appointment(9403, [22], '2026-09-18', 8),
    appointment(9404, [23], '2026-09-18', 9),
  ];
  timeline.blocks = [];
  timeline.events = timeline.appointments;
  const html = renderCalendarPage(model('month', [21, 22, 23], timeline));
  assert.equal((html.match(/data-event-id="appointment-940[1-4]"/g) || []).length, 3);
  assert.match(html, /class="month-more"[^>]*>\+1 more<\/a>/);
  assert.match(html, /view=week&amp;date=2026-09-18&amp;staff=21&amp;staff=22&amp;staff=23/);
});

test('Phone Week, Agenda and Month retain scan-first layouts and touch-safe Month dates', () => {
  for (const view of ['week', 'agenda', 'month']) {
    const source = renderCalendarPage(model(view));
    const html = applyCalendarResponsivePolish(source, model(view));
    assert.match(html, new RegExp(`data-calendar-view="${view}"`));
    if (view === 'week') {
      assert.match(html, /data-view-practitioner-context|People in view/);
      assert.equal((html.match(/data-week-date-lane(?=[ >])/g) || []).length, 6);
      assert.match(html, /data-spatial-week="true"/);
      assert.doesNotMatch(html, /<section class="week-day week-practitioner-lane"/);
    } else {
      assert.match(html, /data-view-practitioner-context/);
    }
    if (view === 'agenda') {
      assert.match(html, /\.view-tabs\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
    } else {
      assert.match(html, /\.view-tabs\{display:grid!important;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
    }
  }
  const monthHtml = renderCalendarPage(model('month'));
  assert.match(monthHtml, /\.month-day-link\{position:absolute;inset:0;z-index:1/);
  assert.match(monthHtml, /\.month-events\{display:grid;padding:0 2px 3px;gap:2px\}/);
  assert.match(monthHtml, /\.month-event \.event-time-start\{display:inline\}/);
  assert.match(monthHtml, /class="month-day-owners" aria-label="Practitioners: Amber Studio \+ Birch Studio \+ Cedar Studio">AS · BS \+1<\/span>/);
});
