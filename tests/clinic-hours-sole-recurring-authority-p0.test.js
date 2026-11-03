const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSchedulingEngine } = require('../src/services/schedulingEngine');
const { createCalendarOperationalMutationService } = require('../src/services/calendarOperationalMutations');

const ROOT = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const availability = source('src/services/availabilityService.js');
const finalSchedule = source('src/services/adminAvailability.js');
const staffSchedule = source('src/services/staffScheduleService.js');
const calendarMutations = source('src/services/calendarOperationalMutations.js');
const calendarPresentation = source('src/presentation/calendarReadOnlyUx.js');
const adminFlow = source('src/services/adminStaffScheduleFlow.js');
const ownSchedule = source('src/services/adminOwnSchedule.js');

function result(rows = []) { return { rows, rowCount: rows.length }; }

test('ordinary slot availability always selects clinic hours despite stale recurring staff rows', () => {
  assert.match(availability, /st\.scheduling_type <> 'regular'/);
  assert.match(availability, /WHERE st\.scheduling_type = 'regular'/);
  assert.doesNotMatch(availability, /st\.scheduling_type = 'regular'[\s\S]{0,160}NOT EXISTS \(SELECT 1 FROM (?:base_windows|recurring_closed)\)/);
  assert.match(availability, /staff_schedule_exceptions/);
  assert.match(availability, /FROM \$\{publicHolidayCalendarSql\} ph/);
  assert.match(source('src/config/publicHolidayCalendar.js'), /SELECT holiday_date, name, country_code, observed FROM public_holidays/);
  assert.match(availability, /location_hours_exceptions/);
  assert.match(availability, /appointment_staff/);
  assert.match(availability, /calendar_blocks/);
  assert.match(availability, /staff_services/);
});

test('prepare and final commit revalidation share the clinic-hours invariant and retain dated constraints', () => {
  assert.match(finalSchedule, /const inherited=row\.scheduling_type==='regular';/);
  assert.doesNotMatch(finalSchedule, /has_base_override|recurring_closed/);
  assert.match(finalSchedule, /staff_schedule_exceptions/);
  for (const file of ['src/services/adminBooking.js', 'src/services/clientBookingCommit.js', 'src/services/adminBookingUpdate.js']) {
    const text = source(file);
    assert.match(text, /checkAvailability|checkAuthoritativeSchedule|listAvailableSlots/, `${file} must retain canonical scheduling revalidation`);
  }
});

test('timeline projects clinic hours and suppresses stale ordinary recurring closures without a named exception', async () => {
  const data = {
    staff: [{ id: 1, display_name: 'Any Practitioner', scheduling_type: 'regular', calendar_scope: 'all_business', business_role: 'employee_practitioner' }],
    appointments: [], calendar_blocks: [], staff_schedule_exceptions: [], location_hours_exceptions: [], public_holidays: [],
    staff_working_hours: [{ id: 7, staff_id: 1, day_of_week: 1, starts_local: '10:00:00', ends_local: '11:00:00', active: true }],
    staff_recurring_day_closures: [{ id: 8, staff_id: 1, day_of_week: 1 }],
    location_working_hours: [{ location_id: 1, day_of_week: 1, starts_local: '08:00:00', ends_local: '17:00:00', active: true }],
  };
  const engine = createSchedulingEngine({
    query: async (sql) => {
      const tag = sql.match(/SchedulingTimeline:([a-z_]+)/)?.[1];
      return result(data[tag] || []);
    },
    checkAvailability: async () => ({ status: 'available' }),
  });
  const timeline = await engine.listTimeline({
    from: '2026-08-31T06:00:00.000Z', to: '2026-09-01T06:00:00.000Z',
    viewer: { calendarScope: 'all_business' }, staffIds: [1],
  });
  assert.deepEqual(timeline.workingWindows.map(row => [row.source, row.startsLocal, row.endsLocal]), [['location_working_hours', '08:00:00', '17:00:00']]);
  assert.deepEqual(timeline.recurringClosures, []);
  assert.doesNotMatch(source('src/services/schedulingEngine.js'), /Christel|Abigail|Marietjie|Jean-Pierre/);
});

test('ordinary recurring schedule writes fail closed before any schedule row mutation', async () => {
  const calls = [];
  const query = async text => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push(sql);
    if (['BEGIN', 'ROLLBACK'].includes(sql)) return result();
    if (sql.includes('calendarAuthorization:principal')) return result([{
      id: 71, staff_id: 1, display_name: 'Admin', business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services',
      permissions: { 'schedule:manage': true }, admin_active: true, staff_status: 'active',
    }]);
    if (sql.includes('calendarAuthorization:services')) return result();
    if (sql.includes('calendarOperational:idempotency')) return result();
    if (sql.includes('pg_advisory_xact_lock')) return result([{}]);
    if (sql.includes("resource_type='practitioner'")) return result([{ id: 1, display_name: 'Any Practitioner', scheduling_type: 'regular' }]);
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release() {} };
  const service = createCalendarOperationalMutationService({ db: { query, async connect() { return client; } } });
  await assert.rejects(service.setWorkingSchedule({
    adminId: 71, requestId: 'clinic_hours_authority_1', staffId: 1, dayOfWeek: 1,
    mode: 'window', startsLocal: '10:00', endsLocal: '11:00', expectedRevision: 'stale-is-irrelevant',
  }), error => error.code === 'CALENDAR_OPERATION_CLINIC_HOURS_AUTHORITATIVE');
  assert.equal(calls.some(sql => /^(?:DELETE FROM|INSERT INTO) staff_(?:working_hours|recurring_day_closures)/.test(sql)), false);
  assert.match(staffSchedule, /scheduling_type === 'regular'[\s\S]{0,220}clinic_hours_authoritative/);
  assert.match(calendarPresentation, /person\.schedulingType !== 'regular'/);
  assert.doesNotMatch(adminFlow, /2️⃣ Change a day/);
  assert.doesNotMatch(ownSchedule, /Set my hours DAY/);
  assert.match(calendarMutations, /CALENDAR_OPERATION_CLINIC_HOURS_AUTHORITATIVE/);
});

test('the correction is non-mutating and creates no per-staff clinic-hour copies', () => {
  const changedRuntime = [availability, finalSchedule, staffSchedule, calendarMutations, adminFlow, ownSchedule].join('\n');
  assert.doesNotMatch(changedRuntime, /INSERT INTO staff_working_hours[\s\S]{0,240}(?:location_working_hours|Clinic hours)/i);
  assert.doesNotMatch(changedRuntime, /UPDATE staff_working_hours[\s\S]{0,240}location_working_hours/i);
});
