const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const parserPath=path.join(__dirname,'..','src','services','adminClinicDateInput.js');
const { parseClinicDateInput }=require(parserPath);
const NOW=new Date('2026-08-16T10:00:00Z');

test('natural day-month input stays in the current Johannesburg calendar year unless a year is explicit',()=>{
  assert.equal(parseClinicDateInput('15 Aug',{now:NOW}),'2026-08-15');
  assert.equal(parseClinicDateInput('15 August',{now:NOW}),'2026-08-15');
  assert.equal(parseClinicDateInput('2 Jan',{now:NOW}),'2026-01-02');
  assert.equal(parseClinicDateInput('15 Aug 2027',{now:NOW}),'2027-08-15');
});

test('relative and weekday dates are supported without weakening invalid-date checks',()=>{
  assert.equal(parseClinicDateInput('today',{now:NOW}),'2026-08-16');
  assert.equal(parseClinicDateInput('tomorrow',{now:NOW}),'2026-08-17');
  assert.equal(parseClinicDateInput('Monday',{now:NOW}),'2026-08-17');
  assert.equal(parseClinicDateInput('next Monday',{now:NOW}),'2026-08-24');
  assert.equal(parseClinicDateInput('31 February',{now:NOW}),null);
  assert.equal(parseClinicDateInput('15/08/2026',{now:NOW}),'2026-08-15');
});
