'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');

const options = {
  authority: { serviceScope: 'all_business:all_services', bookingFlow: 'practitioner_first' },
  staff: [
    { id: 11, displayName: 'Abigail' },
    { id: 12, displayName: 'Christel' },
    { id: 13, displayName: 'Marietjie' },
  ],
  services: [
    { id: 81, name: 'Shared massage', categoryName: 'Massage', staffIds: [11, 12] },
    { id: 82, name: 'Marietjie treatment', categoryName: 'Specialist', staffIds: [13] },
  ],
};

test('#963 receptionist booking exposes a practitioner-first production surface', () => {
  const html = renderCalendarCreateBookingPage({ options });
  const script = calendarCreateBookingClientScript();
  assert.match(html, /data-practitioner-picker hidden/);
  assert.match(html, /data-practitioner-choices/);
  assert.match(html, /Choose a practitioner to see only their treatments/);
  assert.match(html, /"bookingFlow":"practitioner_first"/);
  assert.match(script, /bookingFlow==='practitioner_first'/);
  assert.match(script, /filteredServices\(\)/);
  assert.match(script, /data-practitioner-choice/);
  assert.match(script, /Any available/);
  assert.match(script, /service\.categoryName\|\|'Other treatments'/);
});

test('#963 switching practitioners retains shared services and clears incompatible services explicitly', () => {
  const script = calendarCreateBookingClientScript();
  assert.match(script, /services\.some\(function\(service\)\{return Number\(service\.id\)===previous;\}\)/);
  assert.match(script, /previous treatment is not offered by them/);
  assert.match(script, /\(service\.staffIds\|\|\[\]\)\.map\(Number\)\.includes\(staffId\)/);
  assert.match(script, /if\(prefill&&staffById\(prefill\)\)choosePractitioner/);
});

test('#963 final prepare continues to submit one exact treatment and practitioner for server recheck', () => {
  const script = calendarCreateBookingClientScript();
  assert.match(script, /var serviceId=Number\(el\('#service-select'\)\.value\);var staffId=Number\(el\('#staff-select'\)\.value\)/);
  assert.match(script, /var payload=\{serviceId:serviceId,staffId:staffId,date:date,time:time\}/);
  assert.match(script, /Rechecking the client, treatment, practitioner and availability/);
});
