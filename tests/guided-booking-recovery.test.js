'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bookingRecoveryFor } = require('../src/routes/calendarCreateBooking');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');
const { problemReportsClientScript } = require('../src/presentation/workspaceProblemReportsUx');

test('practitioner-hours refusal explains its isolation and gives safe recovery actions', () => {
  const recovery = bookingRecoveryFor('outside_working_hours');
  assert.match(recovery.message, /Only this practitioner’s availability is involved/);
  assert.match(recovery.message, /Other staff and Shiloh are not affected/);
  assert.deepEqual(recovery.actions, [
    'change_time',
    'change_date',
    'change_practitioner',
    'report_problem',
  ]);
  assert.match(recovery.steps.join(' '), /My availability/);
});

test('clinic-hours and conflict refusals give specific nontechnical next steps', () => {
  const clinic = bookingRecoveryFor('outside_clinic_hours');
  assert.match(clinic.title, /full treatment/);
  assert.doesNotMatch(clinic.title + clinic.message + clinic.steps.join(' '), /canonical|database|exception_type/i);
  assert.deepEqual(clinic.actions, ['change_time', 'change_date', 'report_problem']);

  const conflict = bookingRecoveryFor('conflict');
  assert.match(conflict.title, /not available/);
  assert.match(conflict.steps.join(' '), /Calendar shows this time as free/);

  const detailedConflict = bookingRecoveryFor('conflict', {
    reply: 'That time overlaps with Jean-Pierre Botha — appointment, 08:00–08:30',
  });
  assert.equal(detailedConflict.message, 'That time overlaps with Jean-Pierre Botha — appointment, 08:00–08:30');
});

test('staff booking page renders guided actions and a prefilled private report handoff', () => {
  const html = renderCalendarCreateBookingPage();
  const script = calendarCreateBookingClientScript();
  assert.match(html, /recovery-actions/);
  assert.match(script, /Choose another time/);
  assert.match(script, /Choose another date/);
  assert.match(script, /Choose another practitioner/);
  assert.match(script, /\/calendar\/problem-reports\?category=booking/);
  assert.match(script, /showBookingRecovery\(body\)/);
  assert.match(script, /recovery-detail/);
  assert.match(script, /body&&body\.reply/);
  assert.match(script, /String\(body&&body\.reply\|\|recovery\.title/);
  assert.doesNotThrow(() => new Function(script));
});

test('problem report accepts bounded friendly prefill values from a recovery handoff', () => {
  const script = problemReportsClientScript();
  assert.match(script, /new URLSearchParams\(location\.search\)/);
  assert.match(script, /description\.slice\(0,2000\)/);
  assert.match(script, /expected\.slice\(0,1000\)/);
  assert.doesNotThrow(() => new Function(script));
});

test('My Shiloh failed booking actions offer retry or a private problem report', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/my-shiloh/assets/app.js'), 'utf8');
  assert.match(source, /function appendClientRecovery/);
  assert.match(source, /Nothing has been changed\. Try once more/);
  assert.match(source, /Report a problem/);
  assert.match(source, /clientProblemReportForm\.elements\.category\.value = 'booking'/);
  assert.doesNotThrow(() => new Function(source));
});
