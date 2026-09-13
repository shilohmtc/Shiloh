const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAvailabilityReply } = require('../src/services/adminAvailability');
const fs = require('node:fs');
const vm = require('node:vm');

const unavailable = {
  status: 'outside_clinic_hours',
  staff: { display_name: 'Practitioner A' },
  service: { name: 'Treatment' },
  startsAt: '2026-09-24T08:00:00Z', endsAt: '2026-09-24T09:00:00Z',
};

test('booking refusal distinguishes holiday, closure, Sunday and treatment outside opening hours', () => {
  for (const [clinic, expected] of [
    [{ reason: 'holiday_unconfigured', holidayName: 'Heritage Day' }, /public holiday \(Heritage Day\).*not been configured/],
    [{ reason: 'date_closed', isHoliday: true, holidayName: 'Heritage Day' }, /closed for this public holiday \(Heritage Day\)/],
    [{ reason: 'date_closed' }, /closed on this date/],
    [{ reason: 'sunday_closed' }, /closed on Sundays/],
    [{ reason: 'clinic_closed' }, /closed on this day/],
    [{ reason: 'outside_clinic_hours', startsLocal: '08:00:00', endsLocal: '17:00:00' }, /full treatment.*08:00–17:00/],
  ]) {
    assert.match(formatAvailabilityReply({ ...unavailable, clinic }), expected);
  }
});

test('practitioner and conflict refusals give specific, actionable explanations', () => {
  assert.match(formatAvailabilityReply({ ...unavailable, status: 'schedule_exception' }), /schedule exception/);
  assert.match(formatAvailabilityReply({ ...unavailable, status: 'outside_working_hours' }), /practitioner/);

  const conflictReply = formatAvailabilityReply({ ...unavailable, status: 'conflict', conflicts: [
    { starts_at: unavailable.startsAt, ends_at: unavailable.endsAt, conflict_type: 'calendar_block', label: 'Unavailable' },
  ] });
  assert.match(conflictReply, /That time overlaps with:/);
  assert.match(conflictReply, /Unavailable — calendar block,/);
  assert.match(conflictReply, /Please choose another start time\./);
  assert.doesNotMatch(conflictReply, /Do not create a booking/);
});

test('canonical availability carries the actual holiday reason to its reply', async () => {
  const clinic = { covered: false, reason: 'holiday_unconfigured', holidayName: 'Heritage Day' };
  const results = [
    [{ id: 1, display_name: 'Practitioner A' }],
    [{ id: 2, name: 'Treatment', duration_minutes: 60 }],
    [{}],
    [{ starts_at: unavailable.startsAt, ends_at: unavailable.endsAt }],
  ];
  const context = { module: { exports: {} }, require(name) {
    if (name === '../db/pool') return { pool: { async query() {
      assert.ok(results.length, 'No further booking or schedule queries after clinic refusal');
      const rows = results.shift(); return { rows, rowCount: rows.length };
    } } };
    if (name === './clinicHours') return { checkClinicHours: async () => clinic };
    if (name === './bookingRequestHolds') return {};
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/adminAvailability'), 'utf8'), context);
  const result = await context.module.exports.checkAvailability({ staffName: 'Practitioner A', serviceName: 'Treatment', localDateTime: '24/09/2026 10:00', locationId: 1 });
  assert.equal(result.clinic, clinic);
  assert.match(context.module.exports.formatAvailabilityReply(result), /Heritage Day/);
  assert.equal(results.length, 0);
});
