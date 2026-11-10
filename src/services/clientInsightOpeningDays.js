'use strict';
const { publicHolidayCalendarSql } = require('../config/publicHolidayCalendar');
const { getClinicWindowForDate } = require('./clinicHours');
const { insightAverageWindows } = require('../domain/clientInsights');

// Read only: reuse the existing clinic-hours resolver against one bounded snapshot
// of its inputs. Weekly rows are current settings, not historical effective dates.
async function readInsightOpeningDays(client, period) {
  const { rows } = await client.query(
    `/* clientInsights:opening-days */
    WITH clinic AS MATERIALIZED (SELECT id,timezone FROM locations WHERE status='active' ORDER BY id LIMIT 2)
    SELECT (SELECT jsonb_agg(c) FROM clinic c) AS locations,
      COALESCE((SELECT jsonb_agg(w) FROM location_working_hours w WHERE w.active=TRUE AND w.location_id=(SELECT MIN(id) FROM clinic)),'[]'::jsonb) AS weekly,
      COALESCE((SELECT jsonb_agg(e) FROM location_hours_exceptions e WHERE e.location_id=(SELECT MIN(id) FROM clinic)
        AND e.exception_date >= $1::date AND e.exception_date < $2::date),'[]'::jsonb) AS exceptions,
      COALESCE((SELECT jsonb_agg(h) FROM ${publicHolidayCalendarSql} h WHERE h.country_code='ZA'
        AND EXTRACT(YEAR FROM h.holiday_date) BETWEEN EXTRACT(YEAR FROM $1::date) AND EXTRACT(YEAR FROM $2::date)),'[]'::jsonb) AS holidays`,
    [period.startDate, period.endDate],
  );
  const row = rows[0];
  if (
    !row ||
    !Array.isArray(row.locations) ||
    row.locations.length !== 1 ||
    row.locations[0].timezone !== 'Africa/Johannesburg' ||
    ![row.weekly, row.exceptions, row.holidays].every(Array.isArray)
  )
    return { available: false };
  const windows = insightAverageWindows(period).filter((w) => w.kind === 'day');
  const days = [];
  const validTime = (value) => typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value);
  for (const window of windows) {
    const date = window.startDate,
      dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (!row.holidays.some((h) => String(h.holiday_date).slice(0, 4) === date.slice(0, 4)))
      return { available: false };
    const weekly = row.weekly.filter((w) => Number(w.day_of_week) === dow);
    const exceptions = row.exceptions.filter((e) => e.exception_date === date);
    const holiday = row.holidays.find((h) => h.holiday_date === date);
    if (
      weekly.length > 1 ||
      exceptions.length > 1 ||
      row.weekly.some(
        (w) =>
          !Number.isInteger(Number(w.day_of_week)) ||
          Number(w.day_of_week) < 0 ||
          Number(w.day_of_week) > 6,
      ) ||
      weekly.some(
        (w) =>
          !validTime(w.starts_local) || !validTime(w.ends_local) || w.ends_local <= w.starts_local,
      ) ||
      exceptions.some(
        (e) =>
          !['open', 'closed'].includes(e.exception_type) ||
          (e.exception_type === 'open' &&
            (!validTime(e.starts_local) ||
              !validTime(e.ends_local) ||
              e.ends_local <= e.starts_local)),
      )
    )
      return { available: false };
    const decision = exceptions[0];
    const resolved = await getClinicWindowForDate({
      locationId: row.locations[0].id,
      date,
      db: {
        query: async () => ({
          rows: [
            {
              requested_dow: dow,
              is_holiday: Boolean(holiday),
              holiday_name: holiday?.name,
              override_type: decision?.exception_type,
              override_start: decision?.starts_local,
              override_end: decision?.ends_local,
              weekly_start: weekly[0]?.starts_local,
              weekly_end: weekly[0]?.ends_local,
            },
          ],
        }),
      },
    });
    days.push({
      date,
      state:
        resolved.reason === 'holiday_unconfigured'
          ? 'unknown'
          : resolved.covered
            ? 'open'
            : 'closed',
      source:
        resolved.reason === 'sunday_closed'
          ? 'current_schedule'
          : decision
            ? 'saved_date'
            : resolved.annualDefault
              ? 'effective_rule'
              : 'current_schedule',
    });
  }
  return { available: true, days, asOf: period.asOf };
}
module.exports = { readInsightOpeningDays };
