const { pool } = require('../db/pool');
const { checkClinicHours, getDefaultActiveLocation } = require('./clinicHours');

async function resolveLocationId(db, locationId) {
  if (locationId) return Number(locationId);
  return Number((await getDefaultActiveLocation(db))?.id) || null;
}

async function getAssistantWindowForDate({ db = pool, locationId = null, date }) {
  const resolvedLocationId = await resolveLocationId(db, locationId);
  if (!resolvedLocationId) return { covered: false, reason: 'location_unresolved', locationId: null };
  const result = await db.query(`
    WITH requested AS (SELECT $2::date AS local_date, EXTRACT(DOW FROM $2::date)::int AS dow),
    override AS (
      SELECT exception_type, starts_local, ends_local FROM location_assistant_hours_exceptions, requested
       WHERE location_id=$1 AND exception_date=requested.local_date LIMIT 1
    ), weekly AS (
      SELECT starts_local, ends_local FROM location_assistant_booking_hours, requested
       WHERE location_id=$1 AND day_of_week=requested.dow AND active=TRUE LIMIT 1
    )
    SELECT (SELECT exception_type FROM override) override_type,
           (SELECT starts_local FROM override) override_start,
           (SELECT ends_local FROM override) override_end,
           (SELECT starts_local FROM weekly) weekly_start,
           (SELECT ends_local FROM weekly) weekly_end`, [resolvedLocationId, date]);
  const row = result.rows[0] || {};
  if (row.override_type === 'closed') return { covered: false, reason: 'assistant_date_closed', locationId: resolvedLocationId };
  if (row.override_type === 'open') return { covered: true, reason: null, locationId: resolvedLocationId, startsLocal: row.override_start, endsLocal: row.override_end };
  if (row.weekly_start && row.weekly_end) return { covered: true, reason: null, locationId: resolvedLocationId, startsLocal: row.weekly_start, endsLocal: row.weekly_end };
  return { covered: false, reason: 'outside_assistant_hours', locationId: resolvedLocationId };
}

async function checkAssistantBookingHours({ db = pool, locationId = null, startsAt, endsAt }) {
  const clinic = await checkClinicHours({ db, locationId, startsAt, endsAt });
  if (!clinic.covered) return clinic;
  const requestedResult = await db.query(`SELECT ($1::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date::text local_date,
    ($1::timestamptz AT TIME ZONE 'Africa/Johannesburg')::time local_start,
    ($2::timestamptz AT TIME ZONE 'Africa/Johannesburg')::time local_end,
    ($2::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date::text local_end_date`, [startsAt, endsAt]);
  const requested = requestedResult.rows[0];
  if (!requested || requested.local_date !== requested.local_end_date) return { covered: false, reason: 'outside_assistant_hours', locationId: clinic.locationId };
  const window = await getAssistantWindowForDate({ db, locationId: clinic.locationId, date: requested.local_date });
  if (!window.covered) return window;
  const compare = await db.query('SELECT $1::time >= $3::time AND $2::time <= $4::time AS covered', [requested.local_start, requested.local_end, window.startsLocal, window.endsLocal]);
  const covered = compare.rows[0]?.covered === true;
  return { ...window, covered, reason: covered ? null : 'outside_assistant_hours' };
}

module.exports = { getAssistantWindowForDate, checkAssistantBookingHours };
