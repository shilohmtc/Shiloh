const { publicHolidayCalendarSql } = require('../config/publicHolidayCalendar');
const { annualClosureName } = require('../config/clinicAnnualClosures');
const { pool } = require('../db/pool');
const { isSundayDateKey } = require('./operationalCalendar');

async function getDefaultActiveLocation(db = pool) {
  const result = await db.query(`
    SELECT id, name, timezone
      FROM locations
     WHERE status = 'active'
     ORDER BY id
     LIMIT 2
  `);
  return result.rowCount === 1 ? result.rows[0] : null;
}

async function resolveLocationId(db, locationId) {
  if (locationId) return Number(locationId);
  const location = await getDefaultActiveLocation(db);
  return location?.id || null;
}

async function getClinicWindowForDate({ db = pool, locationId = null, date }) {
  const resolvedLocationId = await resolveLocationId(db, locationId);
  if (!resolvedLocationId) return { covered: false, reason: 'location_unresolved', locationId: null };

  const result = await db.query(`
    WITH requested AS (
      SELECT $2::date AS local_date,
             EXTRACT(DOW FROM $2::date)::int AS dow
    ), holiday AS (
      SELECT ph.name, ph.observed
        FROM ${publicHolidayCalendarSql} ph, requested r
       WHERE ph.country_code='ZA' AND ph.holiday_date=r.local_date
       LIMIT 1
    ), override AS (
      SELECT lhe.exception_type, lhe.starts_local, lhe.ends_local, lhe.reason
        FROM location_hours_exceptions lhe, requested r
       WHERE lhe.location_id=$1 AND lhe.exception_date=r.local_date
       LIMIT 1
    ), weekly AS (
      SELECT lwh.starts_local, lwh.ends_local
        FROM location_working_hours lwh, requested r
       WHERE lwh.location_id=$1
         AND lwh.day_of_week=r.dow
         AND lwh.active=TRUE
       ORDER BY lwh.starts_local
       LIMIT 1
    )
    SELECT
      (SELECT dow FROM requested) AS requested_dow,
      EXISTS(SELECT 1 FROM holiday) AS is_holiday,
      (SELECT name FROM holiday) AS holiday_name,
      (SELECT observed FROM holiday) AS holiday_observed,
      (SELECT exception_type FROM override) AS override_type,
      (SELECT starts_local FROM override) AS override_start,
      (SELECT ends_local FROM override) AS override_end,
      (SELECT reason FROM override) AS override_reason,
      (SELECT starts_local FROM weekly) AS weekly_start,
      (SELECT ends_local FROM weekly) AS weekly_end
  `, [resolvedLocationId, date]);

  const row = result.rows[0] || {};
  if (isSundayDateKey(date) || Number(row.requested_dow) === 0) {
    return {
      covered: false,
      reason: 'sunday_closed',
      locationId: resolvedLocationId,
      isHoliday: row.is_holiday === true,
      holidayName: row.holiday_name || null,
      configured: true,
      permanent: true,
    };
  }
  if (row.override_type === 'closed') {
    return { covered: false, reason: 'date_closed', locationId: resolvedLocationId, isHoliday: row.is_holiday, holidayName: row.holiday_name, configured: true };
  }
  if (row.override_type === 'open') {
    return { covered: true, reason: null, locationId: resolvedLocationId, isHoliday: row.is_holiday, holidayName: row.holiday_name, configured: true, startsLocal: row.override_start, endsLocal: row.override_end };
  }
  if (annualClosureName(date)) {
    return { covered: false, reason: 'annual_closure', locationId: resolvedLocationId, isHoliday: row.is_holiday === true, holidayName: row.holiday_name || null, configured: true, annualDefault: true };
  }
  if (row.is_holiday) {
    return { covered: false, reason: 'holiday_unconfigured', locationId: resolvedLocationId, isHoliday: true, holidayName: row.holiday_name, configured: false };
  }
  if (row.weekly_start && row.weekly_end) {
    return { covered: true, reason: null, locationId: resolvedLocationId, isHoliday: false, configured: true, startsLocal: row.weekly_start, endsLocal: row.weekly_end };
  }
  return { covered: false, reason: 'clinic_closed', locationId: resolvedLocationId, isHoliday: false, configured: true };
}

async function checkClinicHours({ db = pool, locationId = null, startsAt, endsAt }) {
  const resolvedLocationId = await resolveLocationId(db, locationId);
  if (!resolvedLocationId) return { covered: false, reason: 'location_unresolved', locationId: null };

  const dateResult = await db.query(`
    SELECT ($1::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date::text AS local_date,
           ($1::timestamptz AT TIME ZONE 'Africa/Johannesburg')::time AS local_start,
           ($2::timestamptz AT TIME ZONE 'Africa/Johannesburg')::time AS local_end,
           ($2::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date::text AS local_end_date
  `, [startsAt, endsAt]);
  const requested = dateResult.rows[0];
  if (!requested || requested.local_date !== requested.local_end_date) {
    return { covered: false, reason: 'outside_clinic_hours', locationId: resolvedLocationId };
  }

  const window = await getClinicWindowForDate({ db, locationId: resolvedLocationId, date: requested.local_date });
  if (!window.covered) return window;

  const compare = await db.query(`SELECT $1::time >= $3::time AND $2::time <= $4::time AS covered`, [requested.local_start, requested.local_end, window.startsLocal, window.endsLocal]);
  return { ...window, covered: compare.rows[0]?.covered === true, reason: compare.rows[0]?.covered === true ? null : 'outside_clinic_hours' };
}

module.exports = { checkClinicHours, getDefaultActiveLocation, getClinicWindowForDate };
