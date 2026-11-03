const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { holidayTiming, renderClinicHoursPage } = require('../src/presentation/workspaceClinicHoursUx');
const { annualClosureName, annualClosuresBetween } = require('../src/config/clinicAnnualClosures');
const { dateKeyInBusinessTimezone } = require('../src/services/operationalCalendar');
const { listHolidayDecisions } = require('../src/services/workspaceHolidayAttention');
const { createWorkspaceClinicHoursHolidayGuard } = require('../src/services/workspaceClinicHoursHolidayGuard');
const { createSchedulingEngine } = require('../src/services/schedulingEngine');
const { getClinicWindowForDate } = require('../src/services/clinicHours');
const { checkAssistantBookingHours } = require('../src/services/assistantBookingHours');
const { listAvailableSlots } = require('../src/services/availabilityService');
const { pool } = require('../src/db/pool');

test('Johannesburg midnight and exact 14/15/30/31-day presentation boundaries', () => {
  assert.equal(dateKeyInBusinessTimezone(new Date('2026-11-02T22:00:00Z')), '2026-11-03');
  assert.deepEqual(holidayTiming('2026-11-17', '2026-11-03'), { group: 'soon', urgent: true });
  assert.deepEqual(holidayTiming('2026-11-18', '2026-11-03'), { group: 'ahead', urgent: false });
  assert.equal(holidayTiming('2026-12-03', '2026-11-03').group, 'ahead');
  assert.equal(holidayTiming('2026-12-04', '2026-11-03').group, 'later');
  assert.equal(holidayTiming('2026-11-08', '2026-11-03').urgent, false);
});

test('annual defaults recur without rewriting earlier history or adjacent dates', () => {
  for (const year of [2026, 2027, 2035]) for (const date of ['12-24', '12-25']) assert.ok(annualClosureName(`${year}-${date}`));
  assert.ok(annualClosureName('2035-01-01'));
  for (const date of ['2025-12-24', '2026-01-01', '2027-01-02', '2026-12-26', '2026-02-30']) assert.equal(annualClosureName(date), null);
  assert.deepEqual(annualClosuresBetween('2026-12-23', '2027-01-02').map(x => x.holiday_date), ['2026-12-24', '2026-12-25', '2027-01-01']);
});

test('dashboard uses Johannesburg today and omits Sunday and known annual defaults without writes', async () => {
  const seen = [];
  const db = { query: async (sql, params) => {
    seen.push({ sql, params });
    return sql.includes('FROM locations') ? { rowCount: 1, rows: [{ id: 1 }] } : { rows: [
      { exception_date: '2026-12-20', holiday_name: 'Synthetic Sunday' },
      { exception_date: '2026-12-25', holiday_name: 'Christmas' },
      { exception_date: '2026-12-16', holiday_name: 'Synthetic pending holiday' },
    ] };
  } };
  const result = await listHolidayDecisions({ db, now: new Date('2026-12-14T22:05:00Z') });
  assert.deepEqual(seen[1].params, [1, '2026-12-15', 14]);
  assert.deepEqual(result.map(x => x.exceptionDate), ['2026-12-16']);
  assert.ok(seen.every(x => !/INSERT|UPDATE|DELETE/.test(x.sql)));
});

test('only the three approved annual dates bypass the loaded public-holiday requirement', async () => {
  let reads = 0;
  const guard = createWorkspaceClinicHoursHolidayGuard({ db: { query: async () => { reads++; return { rows: [] }; } } });
  for (const date of ['2026-12-24', '2027-12-25', '2030-01-01']) await guard.requireLoadedZaPublicHoliday(date);
  assert.equal(reads, 0);
  await assert.rejects(guard.requireLoadedZaPublicHoliday('2026-12-23'), /loaded South African/);
  await assert.rejects(guard.requireLoadedZaPublicHoliday('2026-02-30'), /valid YYYY-MM-DD/);
});

test('saved decisions remain visible and annual defaults never count as undecided warnings', () => {
  const html = renderClinicHoursPage({ today: '2026-12-15', days: [], holidays: [
    { exceptionDate: '2026-12-16', holidayName: 'Pending', decisionNeeded: true },
    { exceptionDate: '2026-12-24', holidayName: 'Annual', decisionNeeded: true },
    { exceptionDate: '2026-12-25', holidayName: 'Saved open', clinicExceptionType: 'open', clinicStartsLocal: '09:00', clinicEndsLocal: '12:00', decisionNeeded: false },
    { exceptionDate: '2027-03-22', holidayName: 'Later', decisionNeeded: true },
  ] });
  assert.equal((html.match(/data-holiday-needs-attention/g) || []).length, 1);
  assert.match(html, /Closed — annual default/);
  assert.match(html, /Clinic 09:00–12:00/);
  assert.match(html, /<details class="later-holidays" data-holiday-group="later"><summary>Later holidays/);
  assert.match(html, /Not decided/);
});

test('Calendar projects annual closure without hiding existing appointments; explicit opening wins', async () => {
  const data = { staff: [{ id: 1, display_name: 'Synthetic therapist', scheduling_type: 'regular', calendar_scope: 'all_business', business_role: 'employee_practitioner' }], location_hours_exceptions: [] };
  const engine = createSchedulingEngine({ query: async sql => ({ rows: data[sql.match(/SchedulingTimeline:([a-z_]+)/)[1]] || [] }) });
  const args = { from: '2026-12-24T06:00:00Z', to: '2026-12-24T16:00:00Z', viewer: { calendarScope: 'all_business' }, staffIds: [1] };
  const closed = await engine.listTimeline(args);
  assert.ok(closed.closures.some(x => x.date === '2026-12-24' && x.source === 'annual_clinic_closures'));
  data.location_hours_exceptions = [{ location_id: 1, exception_date: '2026-12-24', exception_type: 'open', starts_local: '08:00', ends_local: '14:00' }];
  assert.equal((await engine.listTimeline(args)).closures.length, 0);
});

test('synthetic SQL: default closure, explicit reopening, full duration, conflicts, online boundary and Sunday', async () => {
  const pg = new PGlite();
  const db = { query: async (sql, params) => { const r = await pg.query(sql, params); return { ...r, rowCount: r.rows.length }; } };
  const original = pool.query; pool.query = db.query;
  try {
    await pg.exec(`
      CREATE TABLE locations(id bigint, name text, status text, timezone text);
      INSERT INTO locations VALUES(1,'Synthetic','active','Africa/Johannesburg');
      CREATE TABLE public_holidays(holiday_date date,country_code text,name text,observed boolean);
      CREATE TABLE location_hours_exceptions(location_id bigint,exception_date date,exception_type text,starts_local time,ends_local time,reason text);
      CREATE TABLE location_working_hours(location_id bigint,day_of_week int,active boolean,starts_local time,ends_local time);
      INSERT INTO location_working_hours VALUES(1,4,true,'08:00','17:00');
      CREATE TABLE staff(id bigint,display_name text,status text,scheduling_type text);
      INSERT INTO staff VALUES(1,'Synthetic','active','regular');
      CREATE TABLE services(id bigint,name text,status text,duration_minutes int,processing_time_minutes int,extra_time_minutes int);
      INSERT INTO services VALUES(1,'Synthetic treatment','active',60,15,15);
      CREATE TABLE staff_services(staff_id bigint,service_id bigint); INSERT INTO staff_services VALUES(1,1);
      CREATE TABLE staff_working_hours(staff_id bigint,location_id bigint,day_of_week int,active boolean,starts_local time,ends_local time);
      CREATE TABLE staff_recurring_day_closures(staff_id bigint,location_id bigint,day_of_week int);
      CREATE TABLE staff_schedule_exceptions(staff_id bigint,location_id bigint,exception_date date,exception_type text,starts_local time,ends_local time);
      CREATE TABLE appointment_staff(staff_id bigint,appointment_id bigint);
      CREATE TABLE appointments(id bigint,status text,starts_at timestamptz,ends_at timestamptz);
      CREATE TABLE calendar_blocks(staff_id bigint,starts_at timestamptz,ends_at timestamptz);
      CREATE TABLE appointment_booking_approvals(appointment_id bigint,proposed_staff_ids bigint[],status text,proposal_expires_at timestamptz,proposed_starts_at timestamptz,proposed_ends_at timestamptz);
      CREATE TABLE location_assistant_hours_exceptions(location_id bigint,exception_date date,exception_type text,starts_local time,ends_local time);
      CREATE TABLE location_assistant_booking_hours(location_id bigint,day_of_week int,active boolean,starts_local time,ends_local time);
      INSERT INTO location_assistant_booking_hours VALUES(1,4,true,'08:00','17:00');
    `);
    const args = { staffId: 1, serviceId: 1, locationId: 1, date: '2026-12-24' };
    assert.equal((await listAvailableSlots(args)).slots.length, 0);
    assert.equal((await getClinicWindowForDate({ db, locationId: 1, date: '2030-01-01' })).reason, 'annual_closure');
    await pg.exec("INSERT INTO location_hours_exceptions VALUES(1,'2026-12-24','open','10:00','14:00',NULL)");
    const open = await listAvailableSlots(args);
    assert.ok(open.slots.length > 0); assert.equal(open.totalMinutes, 90);
    assert.equal(new Date(open.slots.at(-1).starts_at).toISOString(), '2026-12-24T10:30:00.000Z');
    await pg.exec("INSERT INTO staff_schedule_exceptions VALUES(1,1,'2026-12-24','unavailable',NULL,NULL)");
    assert.equal((await listAvailableSlots(args)).slots.length, 0);
    await pg.exec("DELETE FROM staff_schedule_exceptions");
    await pg.exec("INSERT INTO location_assistant_hours_exceptions VALUES(1,'2026-12-24','open','10:00','13:00')");
    assert.equal((await checkAssistantBookingHours({ db, locationId: 1, startsAt: '2026-12-24T10:30Z', endsAt: '2026-12-24T12:00Z' })).covered, false);
    await pg.exec("INSERT INTO appointments VALUES(1,'confirmed','2026-12-24T09:00Z','2026-12-24T10:00Z'); INSERT INTO appointment_staff VALUES(1,1)");
    const occupied = await listAvailableSlots(args);
    assert.ok(occupied.slots.every(s => new Date(s.ends_at) <= new Date('2026-12-24T09:00Z') || new Date(s.starts_at) >= new Date('2026-12-24T10:00Z')));
    await pg.exec("INSERT INTO calendar_blocks VALUES(1,'2026-12-24T10:30Z','2026-12-24T12:00Z')");
    assert.equal((await listAvailableSlots(args)).slots.length, 0);
    await pg.exec("UPDATE location_hours_exceptions SET exception_type='closed'");
    assert.equal((await listAvailableSlots(args)).slots.length, 0);
    assert.equal((await db.query('SELECT * FROM appointments')).rows.length, 1);
    await pg.exec("INSERT INTO location_hours_exceptions VALUES(1,'2028-12-24','open','10:00','14:00',NULL)");
    assert.equal((await getClinicWindowForDate({ db, locationId: 1, date: '2028-12-24' })).reason, 'sunday_closed');
  } finally { pool.query = original; await pg.close(); }
});

test('Workspace reads annual dates alongside loaded holidays and preserves explicit saved decisions without writes', async () => {
  const { createWorkspaceClinicHoursService } = require('../src/services/workspaceClinicHours');
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE public_holidays(holiday_date date,name text,country_code text,observed boolean DEFAULT FALSE);
      INSERT INTO public_holidays(holiday_date,name,country_code) VALUES('2026-12-25','Christmas Day','ZA'),('2027-01-01','New Year','ZA');
      CREATE TABLE location_hours_exceptions(location_id int,exception_date date,exception_type text,starts_local time,ends_local time);
      INSERT INTO location_hours_exceptions VALUES(1,'2026-12-25','open','09:00','12:00');
      CREATE TABLE location_assistant_hours_exceptions(location_id int,exception_date date,exception_type text,starts_local time,ends_local time);
      INSERT INTO location_assistant_hours_exceptions VALUES(1,'2026-12-25','closed',NULL,NULL);`);
    const seen = [];
    const db = { query: async (sql, params) => {
      seen.push(sql);
      if (sql.includes('workspaceClinicHours:principal')) return { rows: [{ id: 1, admin_active: true, permissions: { 'schedule:manage': true } }] };
      if (sql.includes('workspaceClinicHours:holidayRows')) return pg.query(sql, params);
      return { rows: [] };
    } };
    const service = createWorkspaceClinicHoursService({ db, locationResolver: async () => ({ id: 1, name: 'Synthetic', timezone: 'Africa/Johannesburg' }) });
    const model = await service.buildModel({ adminId: 1, now: new Date('2026-12-14T22:30Z') });
    assert.equal(model.today, '2026-12-15');
    assert.equal(model.holidays.filter(x => x.exceptionDate === '2026-12-25').length, 1);
    const saved = model.holidays.find(x => x.exceptionDate === '2026-12-25');
    assert.equal(saved.clinicExceptionType, 'open'); assert.equal(saved.clinicStartsLocal, '09:00');
    assert.equal(saved.assistantExceptionType, 'closed');
    assert.equal(model.holidays.find(x => x.exceptionDate === '2026-12-24').holidayName, 'Christmas Eve');
    assert.ok(model.holidays.some(x => x.exceptionDate === '2027-12-24'));
    assert.ok(seen.every(sql => !/INSERT|UPDATE|DELETE/.test(sql)));
  } finally { await pg.close(); }
});


test('saved decisions, annual defaults and Sundays stay in separate collapsed groups', () => {
  const html = renderClinicHoursPage({ today: '2026-12-15', days: [], holidays: [
    { exceptionDate: '2026-12-16', holidayName: 'Pending', decisionNeeded: true },
    { exceptionDate: '2026-12-24', holidayName: 'Annual', decisionNeeded: true },
    { exceptionDate: '2026-12-25', holidayName: 'Saved open', clinicExceptionType: 'open', clinicStartsLocal: '09:00', clinicEndsLocal: '12:00', decisionNeeded: false },
    { exceptionDate: '2027-03-21', holidayName: 'Sunday', decisionNeeded: true },
  ], exceptions: [{ exceptionDate: '2026-12-10', exceptionType: 'closed' }] });
  const saved = html.match(/<details[^>]*data-holiday-group="saved"[^>]*>([\s\S]*?)<details[^>]*data-holiday-group="sundays"/)[1];
  assert.match(saved, /2026-12-24/); assert.match(saved, /Clinic 09:00–12:00/); assert.match(saved, /2026-12-10/);
  assert.doesNotMatch(saved, /2026-12-16|2027-03-21/);
  assert.match(html, /data-holiday-group="sundays"><summary>Sundays — permanently closed/);
  assert.equal((html.match(/data-holiday-needs-attention/g) || []).length, 1);
  assert.doesNotMatch(html, /<details[^>]* open/);
});
