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

test('Phone Week staff controls use a four-column no-scroll grid', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-week-staff-strip\{[^}]*display:grid!important/);
  assert.match(script, /grid-template-columns:44px repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(script, /phone-week-staff-strip:before\{[^}]*grid-row:1\/3/);
  assert.match(script, /phone-week-staff-toggle\{[^}]*width:100%[^}]*min-width:0!important/);
  assert.match(script, /phone-week-staff-strip\{[^}]*overflow:visible!important/);
  assert.doesNotMatch(script, /phone-week-staff-strip\{[^}]*overflow:auto/);
});
