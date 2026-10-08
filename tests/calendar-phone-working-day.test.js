const test=require('node:test');
const assert=require('node:assert/strict');
const {phoneStaffDefaultIncluded,PHONE_SELECTED_DAY_START,PHONE_SELECTED_DAY_END}=require('../src/presentation/calendarPhoneDisplayRange');
const {renderPhoneCalendarUtilityBar}=require('../src/presentation/calendarPhoneCompactV2');
const {calendarPhoneRoomierStyles}=require('../src/presentation/calendarPhoneRoomierUx');
const vm=require('node:vm');
const postcss=require('postcss');
const {calendarPhoneAllStaffClientScript}=require('../src/presentation/calendarPhoneAllStaffUx');
test('phone enhancement CSS fragments close their media and rule blocks independently',()=>{
  const script=calendarPhoneAllStaffClientScript();
  const fragments=[...script.matchAll(/style\.textContent(?:\+)?=('(?:\\.|[^'\\])*');/g)].map(match=>vm.runInNewContext(match[1]));
  assert.ok(fragments.length>0,'generated styles must be inspected');
  assert.ok(fragments.some(css=>css.includes('.booking-notes-indicator{background:')),'include the separate Notes media rule');
  fragments.push(calendarPhoneRoomierStyles());
  for(const css of fragments)assert.doesNotThrow(()=>postcss.parse(css),css.slice(0,120));
});
test('phone display defaults use exact canonical identities without excluding similar names',()=>{
  assert.equal(PHONE_SELECTED_DAY_START,420);assert.equal(PHONE_SELECTED_DAY_END,1020);
  for(const displayName of ['Pieter','Savanna'])assert.equal(phoneStaffDefaultIncluded({displayName}),false);
  for(const displayName of ['Pieter Example','Savannah','Abigail',null])assert.equal(phoneStaffDefaultIncluded({displayName}),true);
});
test('authorized one-person phone roster retains a selectable menu, including excluded defaults',()=>{
  const model={view:'week',dateKey:'2026-10-07',permittedStaff:[{id:71,displayName:'Pieter'}],visibleStaffIds:[71],timeline:{staff:[{id:71,displayName:'Pieter'}]},period:{dateKeys:['2026-10-07']}};
  const html=renderPhoneCalendarUtilityBar(model,{});
  assert.match(html,/data-phone-week-staff-id="71" data-phone-week-staff-default="false"/);
  assert.match(html,/data-phone-week-staff-all/);
  assert.doesNotMatch(html,/Savanna/);
});
