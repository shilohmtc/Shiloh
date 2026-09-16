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

test('Phone Week moves multi-select staff controls into a compact dropdown beside Month', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-staff-menu-mount/);
  assert.match(script, /phone-week-staff-strip\{display:none!important\}/);
  assert.match(script, /function installStaffMenu\(\)/);
  assert.match(script, /summary\.textContent='Staff'/);
  assert.match(script, /panel\.appendChild\(allButton\)/);
  assert.match(script, /staffButtons\.forEach\(button=>panel\.appendChild\(button\)\)/);
  assert.match(script, /phone-staff-menu-panel\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(script, /phone-staff-menu-panel \.phone-week-staff-toggle\{[^}]*min-height:40px!important/);
  assert.match(script, /staffMenuSummary\.setAttribute\('aria-label'/);
});

test('Phone Week keeps compact controls, offset tabs, subtle hourly guides, and named staff columns', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-calendar-utility-bar\{[^}]*min-height:40px/);
  assert.match(script, /phone-calendar-view-nav\{[^}]*margin-left:10px/);
  assert.match(script, /phone-calendar-view-link,.phone-calendar-today-link\{[^}]*min-height:38px/);
  assert.match(script, /phone-week-nav\{[^}]*min-height:36px/);
  assert.match(script, /phone-week-date\{[^}]*min-height:36px!important/);
  assert.match(script, /phone-staff-column-name\{[^}]*min-height:30px/);
  assert.match(script, /week-time-grid\{[^}]*border-top:1px solid var\(--line-strong\)!important[^}]*border-bottom:1px solid var\(--line-strong\)!important/);
  assert.match(script, /time-column\{[^}]*background:var\(--phone-staff-column-tints,#fff\)!important[^}]*border-right:1px solid var\(--line-strong\)!important/);
  assert.match(script, /time-column:before\{[^}]*repeating-linear-gradient\(to bottom[^}]*var\(--line\)[^}]*calc\(100% \/ 11\)[^}]*!important/);
  assert.match(script, /Math\.max\(30,eventHeight\*ratio\)/);
});

test('Phone Week uses subtle staff identity tints in the dropdown, headers, and column backgrounds', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /const staffPalette=\[/);
  assert.match(script, /function staffTone\(id\)/);
  assert.match(script, /function applyStaffTone\(node,id\)/);
  assert.match(script, /data-phone-staff-toned="true"/);
  assert.match(script, /phone-staff-menu-panel \.phone-week-staff-toggle\[data-phone-staff-toned="true"\]/);
  assert.match(script, /phone-staff-column-name\[data-phone-staff-toned="true"\]/);
  assert.match(script, /--phone-staff-column-tints/);
  assert.match(script, /tints\.length\?'linear-gradient\(to right,'\+tints\.join\(','\)\+'\)'/);
});