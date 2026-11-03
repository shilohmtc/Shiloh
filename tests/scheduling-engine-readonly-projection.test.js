const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSchedulingEngine } = require('../src/services/schedulingEngine');

function fixture(overrides = {}) {
  return {
    staff: [
      { id: 1, display_name: 'Julia', scheduling_type: 'regular', calendar_scope: 'all_business', business_role: 'employee_practitioner' },
      { id: 2, display_name: 'Christel', scheduling_type: 'regular', calendar_scope: 'all_business', business_role: 'owner' },
    ],
    appointments: [],
    calendar_blocks: [],
    staff_working_hours: [],
    staff_recurring_day_closures: [],
    staff_schedule_exceptions: [],
    location_working_hours: [
      { location_id: 10, day_of_week: 1, starts_local: '08:00:00', ends_local: '17:00:00', active: true },
    ],
    location_hours_exceptions: [],
    public_holidays: [],
    ...overrides,
  };
}

function fakeQuery(data, seen = []) {
  return async (sql, params) => {
    seen.push({ sql, params });
    const match = sql.match(/SchedulingTimeline:([a-z_]+)/);
    assert.ok(match, `Every projection query must have a SchedulingTimeline source tag: ${sql}`);
    const key = match[1];
    let rows = data[key] || [];
    if (key === 'staff' && Array.isArray(params?.[0])) {
      const permitted = new Set(params[0].map(Number));
      rows = rows.filter(row => permitted.has(Number(row.id)));
    }
    return { rows, rowCount: rows.length };
  };
}

function googleClear() {
  return { enabled: true, available: true, conflicts: [] };
}

function repoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const range = {
  from: '2026-08-24T06:00:00.000Z',
  to: '2026-08-25T06:00:00.000Z',
};

const allBusinessViewer = { staffId: 99, calendarScope: 'all_business' };

test('listAvailability delegates to the existing authoritative availability service unchanged', async () => {
  const expected = { status: 'available', marker: 'delegated-authority' };
  const calls = [];
  const engine = createSchedulingEngine({
    query: async () => { throw new Error('Timeline SQL must not run for listAvailability.'); },
    checkAvailability: async input => { calls.push(input); return expected; },
    checkCalendarAvailability: async () => googleClear(),
  });
  const input = { staffName: 'Julia', serviceName: 'Massage', localDateTime: '24/08/2026 10:00' };
  const result = await engine.listAvailability(input);
  assert.equal(result, expected);
  assert.deepEqual(calls, [input]);
});

test('single-practitioner projection preserves canonical appointment_staff assignment and performs SELECT-only reads', async () => {
  const seen = [];
  const data = fixture({
    appointments: [{
      appointment_id: 501,
      starts_at: '2026-08-24T08:00:00.000Z',
      ends_at: '2026-08-24T09:00:00.000Z',
      status: 'booked',
      record_source: 'whatsapp',
      assigned_staff_id: 1,
      staff_name_snapshot: 'Julia',
    }],
    calendar_blocks: [{
      id: 601,
      staff_id: 1,
      starts_at: '2026-08-24T10:00:00.000Z',
      ends_at: '2026-08-24T11:00:00.000Z',
      block_type: 'manual',
      title: 'Blocked time',
      record_source: 'admin_whatsapp',
    }],
    staff_schedule_exceptions: [
      {
        id: 699, staff_id: 1, exception_date: '2026-08-24', location_id: 10, exception_type: 'available', starts_local: '08:00:00', ends_local: '12:00:00', reason: 'Special opening',
      },
      {
        id: 700, staff_id: 1, exception_date: '2026-08-24', location_id: 10, exception_type: 'unavailable', starts_local: null, ends_local: null, reason: 'Approved leave request #700: Annual leave',
      },
    ],
  });
  const engine = createSchedulingEngine({
    query: fakeQuery(data, seen),
    checkAvailability: async () => ({ status: 'available' }),
    checkCalendarAvailability: async () => googleClear(),
  });

  const timeline = await engine.listTimeline({ ...range, viewer: allBusinessViewer, staffIds: [1] });
  assert.equal(timeline.appointments.length, 1);
  assert.equal(timeline.appointments[0].canonical, true);
  assert.equal(timeline.appointments[0].source, 'appointments');
  assert.deepEqual(timeline.appointments[0].staffIds, [1]);
  assert.deepEqual(timeline.appointments[0].staff, [{ staffId: 1, nameSnapshot: 'Julia', source: 'appointment_staff' }]);
  assert.equal(timeline.blocks.length, 1);
  assert.equal(timeline.blocks[0].source, 'calendar_blocks');
  assert.equal(timeline.blocks[0].allDay, false, 'canonical Shiloh blocks are explicit starts_at/ends_at intervals, not stored all-day records');
  assert.equal(timeline.leave.length, 1);
  assert.equal(timeline.leave[0].source, 'staff_schedule_exceptions');
  assert.equal(timeline.leave[0].date, '2026-08-24');
  assert.equal(timeline.leave[0].allDay, true);
  assert.equal(timeline.leave[0].reason, 'Annual leave');
  assert.ok(timeline.scheduleExceptions.every(item => item.canonical === true));
  assert.equal(timeline.meta.canonicalSources.includes('staff_leave_requests'), false);
  assert.ok(seen.length >= 9);
  for (const { sql } of seen) {
    assert.match(sql, /^\/\* SchedulingTimeline:[a-z_]+ \*\/[\s\S]*\bSELECT\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /\bstaff_leave_requests\b/i);
  }

  const appointmentSql = seen.find(item => /SchedulingTimeline:appointments/.test(item.sql))?.sql || '';
  assert.match(appointmentSql, /\bJOIN\s+appointment_staff\s+ast\b/i);
  assert.match(appointmentSql, /ast\.staff_id\s*=\s*ANY\(\$3::bigint\[\]\)/i);
  assert.doesNotMatch(appointmentSql, /\ba\.staff_id\b/i);
  assert.doesNotMatch(appointmentSql, /\ba\.staff_name\b/i);

  const blockSql = seen.find(item => /SchedulingTimeline:calendar_blocks/.test(item.sql))?.sql || '';
  assert.match(blockSql, /\bSELECT\s+id,\s*staff_id,\s*location_id,\s*starts_at,\s*ends_at,\s*block_type,\s*title,\s*source\s+AS\s+record_source,\s*updated_at\b/i);
  assert.doesNotMatch(blockSql, /\ball_day\b/i);

  const staffExceptionSql = seen.find(item => /SchedulingTimeline:staff_schedule_exceptions/.test(item.sql))?.sql || '';
  assert.match(staffExceptionSql, /\bSELECT\s+id,\s*staff_id,\s*exception_date,\s*location_id,\s*exception_type,\s*starts_local,\s*ends_local,\s*reason\b/i);
});

test('multi-practitioner projection preserves PR #380 appointment_staff fan-out without collapsing the appointment', async () => {
  const data = fixture({
    appointments: [
      {
        appointment_id: 880,
        starts_at: '2026-08-24T09:00:00.000Z',
        ends_at: '2026-08-24T10:30:00.000Z',
        status: 'booked',
        record_source: 'whatsapp',
        assigned_staff_id: 1,
        staff_name_snapshot: 'Julia',
      },
      {
        appointment_id: 880,
        starts_at: '2026-08-24T09:00:00.000Z',
        ends_at: '2026-08-24T10:30:00.000Z',
        status: 'booked',
        record_source: 'whatsapp',
        assigned_staff_id: 2,
        staff_name_snapshot: 'Christel',
      },
    ],
  });
  const engine = createSchedulingEngine({
    query: fakeQuery(data),
    checkAvailability: async () => ({ status: 'available' }),
    checkCalendarAvailability: async () => googleClear(),
  });

  const timeline = await engine.listTimeline({ ...range, viewer: allBusinessViewer, staffIds: [1, 2] });
  assert.equal(timeline.appointments.length, 1);
  assert.deepEqual(timeline.appointments[0].staffIds, [1, 2]);
  assert.deepEqual(timeline.appointments[0].staff.map(item => item.source), ['appointment_staff', 'appointment_staff']);
});

test('external provider events are ignored even when an injected provider reports conflicts', async () => {
  const sharedClinicEvent = {
    id: 'shared-clinic-busy',
    summary: 'Clinic maintenance',
    start: { dateTime: '2026-08-24T11:00:00.000Z' },
    end: { dateTime: '2026-08-24T12:00:00.000Z' },
  };
  const juliaOnlyEvent = {
    id: 'julia-busy',
    summary: 'External busy',
    extendedProperties: { private: { shilohStaffName: 'Julia' } },
    start: { dateTime: '2026-08-24T13:00:00.000Z' },
    end: { dateTime: '2026-08-24T14:00:00.000Z' },
  };
  const allDaySharedEvent = {
    id: 'shared-all-day-busy',
    summary: 'External all-day busy',
    start: { date: '2026-08-24' },
    end: { date: '2026-08-25' },
  };
  const events = [sharedClinicEvent, juliaOnlyEvent, allDaySharedEvent];
  const data = fixture();
  const engine = createSchedulingEngine({
    query: fakeQuery(data),
    checkAvailability: async () => ({ status: 'available' }),
    checkCalendarAvailability: async () => ({
      enabled: true,
      available: false,
      conflicts: events,
    }),
  });

  const timeline = await engine.listTimeline({ ...range, viewer: allBusinessViewer, staffIds: [1, 2] });
  assert.deepEqual(timeline.externalBusy, []);
  assert.deepEqual(timeline.meta.nonCanonicalSources, []);
  assert.equal(timeline.meta.schedulingAuthority, 'shiloh_canonical');
  assert.equal(timeline.meta.googleCalendarRequired, false);
});

test('viewer calendar scope fails closed and own-scope viewers cannot request another practitioner timeline', async () => {
  const data = fixture();
  const googleCalls = [];
  const engine = createSchedulingEngine({
    query: fakeQuery(data),
    checkAvailability: async () => ({ status: 'available' }),
    checkCalendarAvailability: async input => { googleCalls.push(input); return googleClear(); },
  });

  await assert.rejects(
    engine.listTimeline({ ...range, viewer: { staffId: 1 }, staffIds: [1] }),
    error => error.code === 'SCHEDULING_TIMELINE_FORBIDDEN',
  );

  const deniedOtherStaff = await engine.listTimeline({
    ...range,
    viewer: { staffId: 1, calendarScope: 'own_appointments' },
    staffIds: [2],
  });
  assert.deepEqual(deniedOtherStaff.staff, []);
  assert.deepEqual(deniedOtherStaff.events, []);
  assert.equal(googleCalls.length, 0);

  const own = await engine.listTimeline({
    ...range,
    viewer: { staffId: 1, calendarScope: 'own_appointments' },
    staffIds: [1, 2],
  });
  assert.deepEqual(own.staff.map(item => item.id), [1]);
  assert.equal(googleCalls.length, 0);
});

test('read-only projection remains available when Google Calendar is disabled', async () => {
  const engine = createSchedulingEngine({
    query: fakeQuery(fixture()),
    checkAvailability: async () => ({ status: 'available' }),
    checkCalendarAvailability: async () => ({ enabled: false, available: true, conflicts: [] }),
  });
  const timeline = await engine.listTimeline({ ...range, viewer: allBusinessViewer, staffIds: [1] });
  assert.equal(timeline.meta.schedulingAuthority, 'shiloh_canonical');
  assert.equal(timeline.meta.googleCalendarRequired, false);
});

test('SchedulingTimeline SQL projection is locked to canonical production schema migrations', () => {
  const source = repoFile('src/services/schedulingEngine.js');
  const migration003 = repoFile('migrations/003_crm_catalogue_resources.sql');
  const migration005 = repoFile('migrations/005_crm_appointments_calendar.sql');
  const migration015 = repoFile('migrations/015_staff_working_hours.sql');
  const migration020 = repoFile('migrations/020_staff_scheduling_classification.sql');
  const migration021 = repoFile('migrations/021_location_working_hours.sql');
  const migration022 = repoFile('migrations/022_sa_public_holidays_and_location_exceptions.sql');
  const migration024 = repoFile('migrations/024_regular_staff_clinic_hours_inheritance.sql');
  const migration033 = repoFile('migrations/033_staff_business_roles_calendar_scope.sql');

  assert.doesNotMatch(source, /SchedulingTimeline:staff_leave_requests/i);
  assert.doesNotMatch(source, /\bFROM\s+staff_leave_requests\b/i);

  assert.match(migration003, /CREATE TABLE IF NOT EXISTS staff[\s\S]*\bdisplay_name\s+TEXT/i);
  assert.match(migration020, /ADD COLUMN IF NOT EXISTS scheduling_type\s+TEXT/i);
  assert.match(migration033, /ADD COLUMN IF NOT EXISTS business_role\s+TEXT[\s\S]*ADD COLUMN IF NOT EXISTS calendar_scope\s+TEXT/i);
  assert.match(source, /SchedulingTimeline:staff[\s\S]*SELECT id, display_name, scheduling_type, calendar_scope, business_role[\s\S]*FROM staff/i);

  assert.match(migration005, /CREATE TABLE IF NOT EXISTS appointments[\s\S]*\bstarts_at\s+TIMESTAMPTZ[\s\S]*\bends_at\s+TIMESTAMPTZ[\s\S]*\bstatus\s+TEXT[\s\S]*\bsource\s+TEXT/i);
  assert.match(migration005, /CREATE TABLE IF NOT EXISTS appointment_staff[\s\S]*\bstaff_id\s+BIGINT[\s\S]*\bstaff_name_snapshot\s+TEXT/i);
  assert.match(migration005, /CREATE TABLE IF NOT EXISTS calendar_blocks[\s\S]*\bstaff_id\s+BIGINT[\s\S]*\bblock_type\s+TEXT[\s\S]*\bstarts_at\s+TIMESTAMPTZ[\s\S]*\bends_at\s+TIMESTAMPTZ[\s\S]*\btitle\s+TEXT[\s\S]*\bsource\s+TEXT/i);

  assert.match(migration015, /CREATE TABLE IF NOT EXISTS staff_working_hours[\s\S]*\bstaff_id\s+BIGINT[\s\S]*\blocation_id\s+BIGINT[\s\S]*\bday_of_week\s+SMALLINT[\s\S]*\bstarts_local\s+TIME[\s\S]*\bends_local\s+TIME[\s\S]*\bactive\s+BOOLEAN/i);
  assert.match(source, /SchedulingTimeline:staff_working_hours[\s\S]*SELECT id, staff_id, day_of_week, starts_local, ends_local, location_id, active, updated_at[\s\S]*FROM staff_working_hours/i);

  assert.match(migration024, /CREATE TABLE IF NOT EXISTS staff_recurring_day_closures[\s\S]*\bstaff_id\s+BIGINT[\s\S]*\blocation_id\s+BIGINT[\s\S]*\bday_of_week\s+SMALLINT/i);
  assert.match(source, /SchedulingTimeline:staff_recurring_day_closures[\s\S]*SELECT id, staff_id, day_of_week, location_id, updated_at[\s\S]*FROM staff_recurring_day_closures/i);

  assert.match(migration015, /CREATE TABLE IF NOT EXISTS staff_schedule_exceptions[\s\S]*\bid\s+BIGINT[\s\S]*\bstaff_id\s+BIGINT[\s\S]*\blocation_id\s+BIGINT[\s\S]*\bexception_date\s+DATE[\s\S]*\bexception_type\s+TEXT[\s\S]*\bstarts_local\s+TIME[\s\S]*\bends_local\s+TIME[\s\S]*\breason\s+TEXT/i);
  assert.match(source, /SchedulingTimeline:staff_schedule_exceptions[\s\S]*SELECT id, staff_id, exception_date, location_id, exception_type, starts_local, ends_local, reason, updated_at[\s\S]*FROM staff_schedule_exceptions/i);

  assert.match(migration021, /CREATE TABLE IF NOT EXISTS location_working_hours[\s\S]*\blocation_id\s+BIGINT[\s\S]*\bday_of_week\s+INTEGER[\s\S]*\bstarts_local\s+TIME[\s\S]*\bends_local\s+TIME[\s\S]*\bactive\s+BOOLEAN/i);
  assert.match(source, /SchedulingTimeline:location_working_hours[\s\S]*SELECT lwh\.location_id, lwh\.day_of_week, lwh\.starts_local, lwh\.ends_local, lwh\.active[\s\S]*FROM location_working_hours lwh/i);

  assert.match(migration022, /CREATE TABLE IF NOT EXISTS location_hours_exceptions[\s\S]*\blocation_id\s+BIGINT[\s\S]*\bexception_date\s+DATE[\s\S]*\bexception_type\s+TEXT[\s\S]*\bstarts_local\s+TIME[\s\S]*\bends_local\s+TIME[\s\S]*\breason\s+TEXT/i);
  assert.match(source, /SchedulingTimeline:location_hours_exceptions[\s\S]*SELECT lhe\.location_id, lhe\.exception_date, lhe\.exception_type, lhe\.starts_local, lhe\.ends_local, lhe\.reason[\s\S]*FROM location_hours_exceptions lhe/i);

  assert.match(migration022, /CREATE TABLE IF NOT EXISTS public_holidays[\s\S]*\bholiday_date\s+DATE[\s\S]*\bname\s+TEXT[\s\S]*\bcountry_code\s+TEXT[\s\S]*\bobserved\s+BOOLEAN/i);
  assert.match(source, /SchedulingTimeline:public_holidays[\s\S]*SELECT holiday_date, name, observed[\s\S]*FROM \$\{publicHolidayCalendarSql\}/i);
  const calendar = repoFile('src/config/publicHolidayCalendar.js');
  assert.match(calendar, /SELECT holiday_date, name, country_code, observed FROM public_holidays/);
  assert.match(calendar, /WHERE NOT EXISTS[\s\S]*FROM public_holidays WHERE holiday_date=DATE '2026-11-04'/);
  assert.doesNotMatch(calendar, /\b(?:INSERT|UPDATE|DELETE|ALTER)\b/);
});
