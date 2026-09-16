const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');

test('Phone Week adds previous and next week navigation beside the dates', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /function addWeekNavigation\(\)/);
  assert.match(script, /function shiftedWeekHref\(offset\)/);
  assert.match(script, /date\.setUTCDate\(date\.getUTCDate\(\)\+offset\)/);
  assert.match(script, /make\('previous',-7,'Previous week','‹'\)/);
  assert.match(script, /make\('next',7,'Next week','›'\)/);
  assert.match(script, /data-phone-week-navigation/);
  assert.match(script, /\[data-phone-week-nav\]/);
});

test('Phone Week staff controls use a compact four-column no-scroll grid', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-week-staff-strip\{[^}]*display:grid!important/);
  assert.match(script, /grid-template-columns:40px repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(script, /grid-template-rows:repeat\(2,minmax\(34px,auto\)\)/);
  assert.match(script, /phone-week-staff-strip:before\{[^}]*grid-row:1\/3/);
  assert.match(script, /phone-week-staff-toggle\{[^}]*width:100%[^}]*min-height:34px!important/);
  assert.match(script, /phone-week-staff-strip\{[^}]*overflow:visible!important/);
  assert.doesNotMatch(script, /phone-week-staff-strip\{[^}]*overflow:auto/);
});

test('Phone Week keeps compact controls, offsets view tabs, and uses subtle hourly guides', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-calendar-utility-bar\{[^}]*min-height:40px/);
  assert.match(script, /phone-calendar-view-nav\{[^}]*margin-left:10px/);
  assert.match(script, /phone-calendar-view-link,.phone-calendar-today-link\{[^}]*min-height:38px/);
  assert.match(script, /phone-week-nav\{[^}]*min-height:36px/);
  assert.match(script, /phone-week-date\{[^}]*min-height:36px!important/);
  assert.match(script, /phone-staff-column-name\{[^}]*min-height:30px/);
  assert.match(script, /week-time-grid\{[^}]*border-top:1px solid var\(--line-strong\)!important[^}]*border-bottom:1px solid var\(--line-strong\)!important/);
  assert.match(script, /time-column\{[^}]*background:#fff!important[^}]*border-right:1px solid var\(--line-strong\)!important/);
  assert.match(script, /time-column:before\{[^}]*repeating-linear-gradient\(to bottom[^}]*var\(--line\)[^}]*calc\(100% \/ 11\)[^}]*!important/);
  assert.doesNotMatch(script, /time-column:before\{[^}]*background:none!important/);
  assert.match(script, /Math\.max\(30,eventHeight\*ratio\)/);
});