'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const { createClientInsightsService } = require('../src/services/clientInsights');
const { insightPeriod } = require('../src/domain/clientInsights');
const { readInsightOpeningDays } = require('../src/services/clientInsightOpeningDays');
const { projectOpenDayAverage } = require('../src/domain/clientInsightOpenDays');
const asOf = '2026-11-08T08:00:00Z';
async function fixture(t) {
  const f = await clientRecordedVisitsFixture({
    nativeUrl: process.env.TEST_RECORDED_VISITS_DATABASE_URL || null,
  });
  t.after(f.close);
  await f.sql.exec(`CREATE TABLE locations(id bigint,status text,timezone text);
    CREATE TABLE location_working_hours(location_id bigint,day_of_week int,starts_local time,ends_local time,active boolean);
    CREATE TABLE location_hours_exceptions(location_id bigint,exception_date date,exception_type text,starts_local time,ends_local time);
    CREATE TABLE public_holidays(holiday_date date,name text,country_code text,observed boolean);
    INSERT INTO locations VALUES(1,'active','Africa/Johannesburg');
    INSERT INTO location_working_hours SELECT 1,n,'08:00'::time,'17:00'::time,true FROM generate_series(1,6) n;
    INSERT INTO public_holidays VALUES('2026-01-01','Synthetic holiday','ZA',false);
    INSERT INTO location_hours_exceptions VALUES(1,'2026-11-04','open','08:00','12:00'),(1,'2026-10-02','closed',NULL,NULL);`);
  f.insights = () =>
    createClientInsightsService({
      db: f.db,
      accessService: f.service,
      now: () => new Date(asOf),
    }).getModel({ adminId: 41 });
  return f;
}
test('open days include zero-client dates, dedupe clients and preserve closed-day and outside-clock activity', async (t) => {
  const f = await fixture(t);
  for (const [id, client, date, time] of [
    [1, 1, '2026-10-01', '09:00'],
    [2, 1, '2026-10-01', '11:00'],
    [3, 2, '2026-10-01', '10:00'],
    [4, 1, '2026-10-02', '09:00'],
    [5, 1, '2026-10-04', '09:00'],
    [6, 1, '2026-11-04', '16:00'],
    [7, 1, '2026-11-08', '08:00'],
  ])
    await f.add({ id, client, date, time });
  const model = await f.insights(),
    day = model.averages.items[0];
  assert.equal(model.totalVisits, 7);
  assert.deepEqual(
    [
      day.available,
      day.periods,
      day.clientPeriods,
      day.savedDays,
      day.assumedDays,
      day.outsideDates,
      day.outsideClientDays,
    ],
    [true, 32, 3, 1, 31, 2, 2],
  );
  assert.equal(day.average, 3 / 32);
  assert.equal(model.monthly[0].visits, 5);
  assert.equal(model.averages.items[2].clientPeriods, 2);
  assert.ok(f.calls.some((c) => c.text.includes('clientInsights:opening-days')));
  assert.equal(f.calls.at(-1).text, 'ROLLBACK');
});
test('unresolved holiday and ambiguous hours affect only the daily estimate; no open days is not zero', async (t) => {
  const f = await fixture(t);
  await f.add({ id: 1 });
  await f.db.query("DELETE FROM location_hours_exceptions WHERE exception_date='2026-11-04'");
  let model = await f.insights();
  assert.equal(model.averages.items[0].available, false);
  assert.match(model.averages.items[0].reason, /holiday/);
  assert.equal(model.averages.items[2].average, 1);
  await f.db.query(
    "INSERT INTO location_hours_exceptions VALUES(1,'2026-11-04','closed',NULL,NULL)",
  );
  await f.db.query("INSERT INTO location_working_hours VALUES(1,1,'18:00','19:00',true)");
  model = await f.insights();
  assert.equal(model.averages.items[0].available, false);
  await f.db.query('DELETE FROM location_working_hours');
  model = await f.insights();
  assert.equal(model.averages.items[0].available, true);
  assert.equal(model.averages.items[0].periods, 0);
  assert.equal(model.averages.items[0].average, null);
  assert.equal(model.averages.items[0].outsideClientDays, 1);
});
test('annual closure effective date and explicit saved opening retain canonical precedence', async (t) => {
  const f = await fixture(t);
  await f.db.query(
    "INSERT INTO public_holidays VALUES('2025-01-01','Synthetic prior year','ZA',false)",
  );
  const read = async (date) =>
    readInsightOpeningDays({ query: (...args) => f.db.query(...args) }, insightPeriod(2, date));
  let opening = await read('2026-01-31T08:00:00Z');
  assert.equal(opening.available, true);
  assert.equal(opening.days.find((d) => d.date === '2025-12-24').state, 'open');
  opening = await read('2027-01-01T08:00:00Z');
  assert.equal(opening.days.find((d) => d.date === '2026-12-24').state, 'closed');
  assert.equal(opening.days.find((d) => d.date === '2026-12-24').source, 'effective_rule');
  await f.db.query(
    "INSERT INTO location_hours_exceptions VALUES(1,'2026-12-24','open','08:00','09:00')",
  );
  opening = await read('2027-01-01T08:00:00Z');
  assert.equal(opening.days.find((d) => d.date === '2026-12-24').state, 'open');
  assert.equal(opening.days.find((d) => d.date === '2026-12-24').source, 'saved_date');
});
test('opening projection refuses incomplete, reordered or invented counts', () => {
  const period = insightPeriod(2, asOf);
  assert.equal(
    projectOpenDayAverage([], { available: true, days: [] }, period, 0).available,
    false,
  );
  assert.equal(projectOpenDayAverage(null, null, period, 0).available, false);
});
