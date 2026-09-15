const { pool } = require('../db/pool');
const { getDefaultActiveLocation } = require('./clinicHours');

async function listHolidayDecisions({ db = pool, now = new Date(), daysAhead = 14 } = {}) {
  const location = await getDefaultActiveLocation(db);
  if (!location?.id) return [];
  const date = now.toISOString().slice(0, 10);
  const result = await db.query(`/* workspaceHolidayAttention:list */
    SELECT h.holiday_date::text exception_date, h.name holiday_name
      FROM public_holidays h
      LEFT JOIN location_hours_exceptions e ON e.location_id=$1 AND e.exception_date=h.holiday_date
     WHERE h.country_code='ZA' AND h.holiday_date BETWEEN $2::date AND ($2::date + $3::int)
       AND e.id IS NULL ORDER BY h.holiday_date`, [location.id, date, daysAhead]);
  return result.rows.map(row => ({ exceptionDate: String(row.exception_date).slice(0,10), holidayName: String(row.holiday_name), href: `/calendar/clinic-hours?date=${String(row.exception_date).slice(0,10)}#special-dates` }));
}
module.exports = { listHolidayDecisions };
