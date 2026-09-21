const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calendarFirstPhoneStyles,
  goldieDensityPhoneStyles,
  renderCalendarPage,
} = require('../src/presentation/calendarReadOnlyUx');
const {
  decoratePhoneCalendarV2,
} = require('../src/presentation/calendarPhoneCompactV2');
const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');

function model() {
  const staff = [
    { id: 51, displayName: 'Amber Room' },
    { id: 52, displayName: 'Birch Room' },
  ];
  return {
    view: 'week',
    dateKey: '2026-09-11',
    period: { dateKeys: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'] },
    activeStaffId: 51,
    visibleStaffIds: [51, 52],
    permittedStaff: staff,
    timezone: 'Africa/Johannesburg',
    readOnly: true,
    publicHolidays: [],
    timeline: {
      staff,
      workingWindows: [],
      scheduleExceptions: [],
      recurringClosures: [],
      closures: [],
      appointments: [],
      blocks: [],
      leave: [],
      externalBusy: [],
      events: [],
    },
    mutationCapability: { enabled: false },
  };
}

test('production Calendar opts into one approved Phone presentation', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/calendarReadOnlyUx.js'), 'utf8');
  assert.match(routeSource, /approvedPhonePresentation: true/);
});

test('approved Phone HTML excludes superseded first-generation Phone CSS', () => {
  const raw = renderCalendarPage(model(), { approvedPhonePresentation: true });
  assert.equal(raw.includes(calendarFirstPhoneStyles()), false);
  assert.equal(raw.includes(goldieDensityPhoneStyles()), false);
  const html = decoratePhoneCalendarV2(raw, { model: model(), bookingAllowed: false });
  assert.match(html, /data-phone-calendar-utility-bar/);
  assert.match(html, /data-phone-week-navigation="true"/);
  assert.doesNotMatch(html, /data-phone-calendar-v2-controls|data-phone-calendar-v2-actions/);
});

test('bounded client enhancement no longer creates or relocates Calendar navigation', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotMatch(script, /function buildUtilityBar|function addMonthNavigation|function addWeekNavigation|function addMonthContext/);
  assert.doesNotMatch(script, /insertBefore\(bar|appendChild\(plus\)|document\.createElement\('details'\)/);
  assert.match(script, /function renderColumns\(\)/);
  assert.match(script, /function fitCalendarViewport\(\)/);
});
