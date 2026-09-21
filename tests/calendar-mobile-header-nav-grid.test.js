const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  phoneCalendarV2Styles,
  renderPhoneCalendarUtilityBar,
  renderPhoneMonthNavigation,
  renderPhoneWeekPlannerHeader,
} = require('../src/presentation/calendarPhoneCompactV2');
const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');

function model(view = 'week') {
  const staff = [
    { id: 51, displayName: 'Amber Room' },
    { id: 52, displayName: 'Birch Room' },
  ];
  return {
    view,
    dateKey: '2026-09-11',
    period: view === 'month'
      ? { dateKeys: [], startKey: '2026-09-01', previousAnchor: '2026-08-01', nextAnchor: '2026-10-01' }
      : { dateKeys: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'] },
    activeStaffId: 51,
    visibleStaffIds: [51, 52],
    permittedStaff: staff,
    timeline: { staff },
    mutationCapability: { enabled: false },
  };
}

test('Phone Week navigation is server-rendered beside the dates', () => {
  const html = renderPhoneWeekPlannerHeader(model(), { basePath: '/calendar/read-only' });
  assert.match(html, /data-phone-week-month-context>Sept<\/span>/);
  assert.match(html, /data-phone-week-nav="previous"[^>]*date=2026-09-04/);
  assert.match(html, /data-phone-week-nav="next"[^>]*date=2026-09-18/);
  assert.match(html, /data-phone-week-navigation="true"/);
  assert.equal((html.match(/data-phone-week-date=/g) || []).length, 6);
});

test('Phone Month navigation is server-rendered with accessible adjacent-month links', () => {
  const html = renderPhoneMonthNavigation(model('month'), { basePath: '/calendar/read-only' });
  const css = phoneCalendarV2Styles();
  assert.match(html, /data-phone-month-navigation/);
  assert.match(html, /data-phone-month-label>September 2026<\/strong>/);
  assert.match(html, /data-phone-month-nav="previous"[^>]*date=2026-08-01/);
  assert.match(html, /data-phone-month-nav="next"[^>]*date=2026-10-01/);
  assert.match(css, /phone-month-nav\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /phone-month-nav\[data-phone-month-nav="previous"\]\{transform:translateX\(8px\)\}/);
});

test('approved Phone toolbar and staff dropdown are emitted directly by the server', () => {
  const html = renderPhoneCalendarUtilityBar(model(), { basePath: '/calendar/read-only', bookingAllowed: false });
  const script = calendarPhoneAllStaffClientScript();
  assert.match(html, /data-phone-calendar-utility-bar/);
  assert.match(html, /data-phone-calendar-direct-view="week"/);
  assert.match(html, /data-phone-calendar-direct-view="month"/);
  assert.match(html, /data-phone-staff-menu/);
  assert.match(html, /data-phone-week-staff-all="true"/);
  assert.match(html, /data-phone-week-staff-id="51"/);
  assert.doesNotMatch(script, /function buildUtilityBar|function addMonthNavigation|function addWeekNavigation/);
  assert.doesNotMatch(script, /document\.createElement\('details'\)/);
  assert.match(script, /function installStaffMenu\(\)/);
  assert.match(script, /querySelector\('\[data-phone-staff-menu\]'\)/);
});

test('Phone toolbar geometry is present before enhancement and behavior remains valid JavaScript', () => {
  const css = phoneCalendarV2Styles();
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(css, /phone-calendar-utility-bar\{[^}]*min-height:40px/);
  assert.match(css, /phone-calendar-view-nav\{[^}]*margin-left:10px/);
  assert.match(css, /phone-calendar-view-link,.phone-calendar-today-link\{[^}]*min-height:38px/);
  assert.match(css, /phone-week-nav\{[^}]*min-height:36px/);
  assert.match(css, /phone-week-date\{[^}]*min-height:36px/);
  assert.match(script, /phone-staff-column-name\{[^}]*min-height:30px/);
  assert.match(script, /Math\.max\(30,eventHeight\*ratio\)/);
});

test('Phone Week keeps staff identity tints and column geometry as bounded client behavior', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /const staffPalette=\[/);
  assert.match(script, /function staffTone\(id\)/);
  assert.match(script, /function applyStaffTone\(node,id\)/);
  assert.match(script, /--phone-staff-column-tints/);
  assert.match(script, /function layoutStaffGroup\(nodes,columnIndex,columnCount\)/);
});
