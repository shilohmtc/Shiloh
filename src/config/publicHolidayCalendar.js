// Read-only supplement for an officially proclaimed date absent from the original seed.
// Source: https://thepresidency.gov.za/president-ramaphosa-declares-election-day-4-november-2026-public-holiday
// Proclaimed 15 September 2026. This is a single date, never an annual default.
// Stored calendar rows win. Clinic/online decisions, appointments and blocks are
// still evaluated by their existing authorities; this relation never writes data.
const publicHolidayCalendarSql = `(
  SELECT holiday_date, name, country_code, observed FROM public_holidays
  UNION ALL
  SELECT DATE '2026-11-04', 'Local Government Election Day'::text, 'ZA'::text, FALSE
   WHERE NOT EXISTS (
     SELECT 1 FROM public_holidays WHERE holiday_date=DATE '2026-11-04'
   )
)`;

module.exports = { publicHolidayCalendarSql };
