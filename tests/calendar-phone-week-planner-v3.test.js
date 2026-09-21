const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCalendarReadOnlyUxService,
  normalizeView,
} = require('../src/services/calendarReadOnlyUx');
const {
  decoratePhoneCalendarV2,
  renderPhoneCalendarUtilityBar,
  renderPhoneMonthNavigation,
  phoneCalendarV2Styles,
  phoneFirstPaintStyles,
  calendarPhoneCompactV2ClientScript,
} = require('../src/presentation/calendarPhoneCompactV2');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { workspaceShellStyles } = require('../src/presentation/workspaceShell');

const STAFF = [
  { id: 51, displayName: 'Amber Room', schedulingType: 'regular' },
  { id: 52, displayName: 'Birch Room', schedulingType: 'regular' },
  { id: 53, displayName: 'Cedar Room', schedulingType: 'regular' },
];

function timeline() {
  const appointments = [{
    id: 1, kind: 'appointment', canonical: true, staffIds: [51],
    startsAt: '2026-09-11T08:00:00.000Z', endsAt: '2026-09-11T09:00:00.000Z',
    clientName: 'Client', serviceName: 'Treatment', status: 'scheduled',
  }];
  return {
    staff: STAFF,
    workingWindows: STAFF.flatMap(person => [1,2,3,4,5,6].map(dayOfWeek => ({
      staffId: person.id, dayOfWeek, startsLocal: '08:00:00', endsLocal: '17:00:00',
    }))),
    scheduleExceptions: [], recurringClosures: [], closures: [], appointments,
    blocks: [], leave: [], externalBusy: [], events: appointments,
  };
}

function model(view = 'week') {
  return {
    view,
    dateKey: '2026-09-11',
    period: view === 'month'
      ? { dateKeys: ['2026-09-11', '2026-09-24'], startKey: '2026-09-01', previousAnchor: '2026-08-01', nextAnchor: '2026-10-01' }
      : { dateKeys: ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12'] },
    activeStaffId: 51,
    visibleStaffIds: [51,52,53],
    permittedStaff: STAFF,
    publicHolidays: [{ date: '2026-09-24', name: 'Heritage Day', observed: false, source: 'public_holidays' }],
    timeline: timeline(),
    mutationCapability: { enabled: true, operations: ['calendar_block:manage','operational_leave:manage'], calendarScope: 'all_business' },
  };
}

test('Week is the default view and Week/Month default to all server-permitted practitioners', async () => {
  assert.equal(normalizeView(), 'week');
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => timeline(),
    query: async (_text, params) => ({ rows: Array.isArray(params?.[0]) ? params[0].map(id => ({ appointment_id: id, client_mobile: '27820000000' })) : [] }),
    listPublicHolidays: async () => [{ date: '2026-09-24', name: 'Heritage Day', observed: false, source: 'public_holidays' }],
  });
  const week = await service.buildModel({ date: '2026-09-11', viewer: { calendarScope: 'all_business' } });
  assert.equal(week.view, 'week');
  assert.deepEqual(week.visibleStaffIds, [51,52,53]);
  assert.equal(week.publicHolidays[0].name, 'Heritage Day');
  const month = await service.buildModel({ view: 'month', date: '2026-09-11', viewer: { calendarScope: 'all_business' } });
  assert.deepEqual(month.visibleStaffIds, [51,52,53]);
});

test('normal Calendar selectors retire Day while compatibility rendering remains available', () => {
  const weekHtml = renderCalendarPage({ ...model('week'), readOnly: true, timezone: 'Africa/Johannesburg' }, { basePath: '/calendar/read-only' });
  assert.doesNotMatch(weekHtml, /data-calendar-view-option="day"/);
  assert.match(weekHtml, /data-calendar-view-option="week"/);
  assert.match(weekHtml, /data-calendar-view-option="month"/);
  const dayHtml = renderCalendarPage({ ...model('day'), period: { dateKeys: ['2026-09-11'], startKey: '2026-09-11', previousAnchor: '2026-09-10', nextAnchor: '2026-09-12' }, readOnly: true, timezone: 'Africa/Johannesburg' }, { basePath: '/calendar/read-only' });
  assert.match(dayHtml, /data-view="day"/);
});

test('Phone toolbar exposes the approved Week and Month views while preserving visible staff', () => {
  const html = renderPhoneCalendarUtilityBar(model('week'), { basePath: '/calendar/read-only' });
  assert.doesNotMatch(html, /data-phone-calendar-view="day"/);
  assert.match(html, /data-phone-calendar-view="week"/);
  assert.match(html, /data-phone-calendar-view="month"/);
  assert.match(html, /staff=51&amp;staff=52&amp;staff=53&amp;activeStaff=51/);
  assert.match(html, /data-phone-week-staff-id="52"/);
});

test('Phone Month navigation is server-rendered with canonical adjacent-month anchors', () => {
  const html = renderPhoneMonthNavigation(model('month'), { basePath: '/calendar/read-only' });
  assert.match(html, /data-phone-month-navigation/);
  assert.match(html, /data-phone-month-label>September 2026<\/strong>/);
  assert.match(html, /data-phone-month-nav="previous"[^>]*date=2026-08-01/);
  assert.match(html, /data-phone-month-nav="next"[^>]*date=2026-10-01/);
  assert.match(html, /staff=51&amp;staff=52&amp;staff=53&amp;activeStaff=51/);
  assert.match(phoneCalendarV2Styles(), /phone-month-nav\{[^}]*min-width:44px;min-height:44px/);
  assert.match(phoneCalendarV2Styles(), /phone-month-nav\[data-phone-month-nav="previous"\]\{transform:translateX\(8px\)\}/);
});

test('Phone Week Planner renders Mon-Sat strip and all permitted practitioner toggles without creating scheduling authority', () => {
  const source = '<!doctype html><html><head></head><body data-calendar-view="week"><div class="shell"><main class="calendar-view week-view"><div class="time-grid week-time-grid"><div class="week-grid"></div></div></main><div class="footer-note">footer</div></div></body></html>';
  const html = decoratePhoneCalendarV2(source, { model: model('week'), basePath: '/calendar/read-only', bookingAllowed: false });
  assert.match(html, /data-phone-week-planner/);
  assert.equal((html.match(/data-phone-week-date=/g) || []).length, 6);
  assert.equal((html.match(/data-phone-week-staff-id=/g) || []).length, 3);
  assert.match(html, /data-phone-active-date="2026-09-11"/);
  const script = calendarPhoneCompactV2ClientScript();
  assert.match(script, /\[data-week-date-lane\]/);
  assert.match(script, /eventStaffIds/);
  assert.match(script, /body\.dataset\.phoneActiveStaffId/);
  assert.match(script, /activeStaff=id;applyPlanner\(\)/);
  assert.match(script, /node\.dataset\.bookingStaffId=activeStaff/);
  assert.match(script, /selectedIds\(\)/);
  assert.doesNotMatch(script, /fetch\(/);
});

test('Phone Calendar withholds the legacy first paint until compact enhancement is ready', () => {
  const source = '<!doctype html><html><head></head><body data-calendar-view="week"><div class="workspace-main"><div class="shell"><main class="calendar-view week-view"><div class="time-grid week-time-grid"><div class="week-grid"></div></div></main></div></div></body></html>';
  const html = decoratePhoneCalendarV2(source, { model: model('week'), basePath: '/calendar/read-only', bookingAllowed: false });
  const css = phoneFirstPaintStyles();
  const script = calendarPhoneCompactV2ClientScript();
  assert.match(html, /data-calendar-phone-pending="true"/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /opacity:0;visibility:hidden/);
  assert.match(css, /1500ms forwards/);
  assert.match(script, /body\.removeAttribute\('data-calendar-phone-pending'\)/);
});

test('Phone Month receives one capacity band per date and retains public-holiday annotation separately from closure authority', () => {
  const source = '<!doctype html><html><head></head><body data-calendar-view="month"><div class="shell"><main class="calendar-view month-view"><section class="month-day" data-date="2026-09-11" data-item-count="1"><a class="month-day-link"></a></section><section class="month-day" data-date="2026-09-24" data-item-count="0"><a class="month-day-link"></a></section></main><div class="footer-note">footer</div></div></body></html>';
  const html = decoratePhoneCalendarV2(source, { model: model('month'), basePath: '/calendar/read-only', bookingAllowed: false });
  assert.match(html, /data-phone-capacity-band="(?:light|medium|busy|closed)"/);
  assert.match(html, /data-phone-public-holiday="Heritage Day"/);
  assert.doesNotMatch(html, /data-phone-public-holiday="Heritage Day"[^>]*data-kind="clinic_closure"/);
});

test('Phone Week layout is active-practitioner filtered inside one date lane and drawer stays compact', () => {
  const css = phoneCalendarV2Styles();
  assert.match(css, /week-date-lane\[data-phone-active-day="true"\]/);
  assert.match(css, /positioned-event\[data-phone-staff-visible="false"\]/);
  assert.match(css, /phone-week-date-strip/);
  assert.match(css, /phone-week-staff-toggle/);
  assert.doesNotMatch(css, /\.week-day-date\{display:grid!important/);
  const shellCss = workspaceShellStyles();
  assert.match(shellCss, /width:min\(60vw,220px\);max-width:calc\(100vw - 16px\)/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'presentation', 'calendarReadOnlyUx.js'), 'utf8');
  assert.match(source, /data-week-date-lane/);
});
