const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAssistantBookingHours } = require('../src/services/assistantBookingHours');
const { canonicalHolidays } = require('../src/services/workspaceClinicHours');
const { listHolidayDecisions } = require('../src/services/workspaceHolidayAttention');

function availabilityDb({ assistantEnd = '16:00:00' } = {}) {
  let comparison = 0;
  return { query: async (sql) => {
    const text = String(sql);
    if (text.includes('WITH requested AS') && text.includes('public_holidays')) return { rows: [{ requested_dow: 4, is_holiday: false, weekly_start: '08:00:00', weekly_end: '18:00:00' }] };
    if (text.includes("local_date") && text.includes("local_end_date")) return { rows: [{ local_date: '2026-09-17', local_start: '15:00:00', local_end: '17:00:00', local_end_date: '2026-09-17' }] };
    if (text.includes('location_assistant_booking_hours')) return { rows: [{ weekly_start: '09:00:00', weekly_end: assistantEnd }] };
    if (text.includes('AS covered')) return { rows: [{ covered: comparison++ === 0 }] };
    throw new Error(`Unexpected SQL ${text}`);
  } };
}

test('internal clinic boundary and Shiloh Assistant boundary are separate', async () => {
  const result = await checkAssistantBookingHours({ db: availabilityDb(), locationId: 1, startsAt: '2026-09-17T13:00:00Z', endsAt: '2026-09-17T15:00:00Z' });
  assert.equal(result.covered, false);
  assert.equal(result.reason, 'outside_assistant_hours');
});

test('public holidays appear before a decision is recorded', () => {
  const holidays = canonicalHolidays([{ holiday_date: '2026-09-24', holiday_name: 'Heritage Day', clinic_exception_type: null }]);
  assert.deepEqual(holidays[0], { exceptionDate: '2026-09-24', holidayName: 'Heritage Day', clinicExceptionType: null, clinicStartsLocal: null, clinicEndsLocal: null, assistantExceptionType: null, assistantStartsLocal: null, assistantEndsLocal: null, decisionNeeded: true });
});

test('Dashboard holiday reminder is bounded to unresolved holidays in the next 14 days', async () => {
  const db = { query: async sql => String(sql).includes('FROM locations')
    ? { rowCount: 1, rows: [{ id: 1, name: 'Shiloh' }] }
    : { rows: [{ exception_date: '2026-09-24', holiday_name: 'Heritage Day' }] } };
  const reminders = await listHolidayDecisions({ db, now: new Date('2026-09-15T08:00:00Z') });
  assert.equal(reminders[0].holidayName, 'Heritage Day');
  assert.equal(reminders[0].href, '/calendar/clinic-hours?date=2026-09-24#special-dates');
});

test('client booking paths use Assistant hours while staff booking paths retain clinic hours', () => {
  for (const file of ['clientBookingApproval.js','clientBookingCommit.js','clientCouplesMassageBooking.js','clientRescheduleApproval.js']) {
    assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/services',file),'utf8'), /assistantBookingHours/);
  }
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/services/calendarGroupBooking.js'),'utf8'), /require\('\.\/clinicHours'\)/);
});
