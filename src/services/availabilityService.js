const { pool } = require('../db/pool');

const TZ = 'Africa/Johannesburg';

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function localDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function canonicalServiceTotalMinutes(resource) {
  return Number(resource?.duration_minutes || 0)
    + Number(resource?.processing_time_minutes || 0)
    + Number(resource?.extra_time_minutes || 0);
}

async function getServiceAndStaff(staffId, serviceId) {
  const result = await pool.query(
    `SELECT st.id AS staff_id, st.display_name AS staff_name, st.status AS staff_status,
            st.scheduling_type,
            s.id AS service_id, s.name AS service_name, s.status AS service_status,
            s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes
       FROM staff st
       CROSS JOIN services s
      WHERE st.id = $1 AND s.id = $2`,
    [staffId, serviceId]
  );
  return result.rows[0] || null;
}

async function listAvailableSlots({
  staffId,
  serviceId,
  date,
  locationId,
  intervalMinutes = 15,
  excludeAppointmentId = null,
  ignoreEventId = null,
}) {
  staffId = positiveInt(staffId);
  serviceId = positiveInt(serviceId);
  locationId = locationId == null ? null : positiveInt(locationId);
  intervalMinutes = positiveInt(intervalMinutes) || 15;
  excludeAppointmentId = excludeAppointmentId == null ? null : positiveInt(excludeAppointmentId);
  date = localDate(date);
  if (!staffId || !serviceId || !date) return { status: 'invalid_request', slots: [] };

  const resource = await getServiceAndStaff(staffId, serviceId);
  if (!resource || resource.staff_status !== 'active' || resource.service_status !== 'active') {
    return { status: 'inactive_or_missing', slots: [], resource };
  }

  const eligible = await pool.query(
    `SELECT 1 FROM staff_services WHERE staff_id = $1 AND service_id = $2 LIMIT 1`,
    [staffId, serviceId]
  );
  if (!eligible.rowCount) return { status: 'not_eligible', slots: [], resource };

  const totalMinutes = canonicalServiceTotalMinutes(resource);
  if (totalMinutes <= 0) return { status: 'invalid_duration', slots: [], resource };

  const result = await pool.query(
    `WITH requested AS (
       SELECT $1::date AS local_date,
              EXTRACT(DOW FROM $1::date)::int AS dow,
              COALESCE($3::bigint, (
                SELECT id FROM locations WHERE status='active' ORDER BY id LIMIT 1
              )) AS location_id
     ),
     holiday AS (
       SELECT ph.holiday_date
         FROM public_holidays ph, requested r
        WHERE ph.country_code='ZA' AND ph.holiday_date=r.local_date
     ),
     clinic_override AS (
       SELECT lhe.exception_type, lhe.starts_local, lhe.ends_local
         FROM location_hours_exceptions lhe, requested r
        WHERE lhe.location_id=r.location_id AND lhe.exception_date=r.local_date
        LIMIT 1
     ),
     clinic_windows AS (
       SELECT co.starts_local, co.ends_local
         FROM clinic_override co, requested r
        WHERE r.dow <> 0
          AND co.exception_type='open'
       UNION ALL
       SELECT lwh.starts_local, lwh.ends_local
         FROM location_working_hours lwh, requested r
        WHERE lwh.location_id = r.location_id
          AND r.dow <> 0
          AND lwh.day_of_week = r.dow
          AND lwh.active = TRUE
          AND NOT EXISTS (SELECT 1 FROM clinic_override)
          AND NOT EXISTS (SELECT 1 FROM holiday)
     ),
     base_windows AS (
       SELECT wh.starts_local, wh.ends_local
         FROM staff_working_hours wh
         JOIN requested r ON TRUE
         JOIN staff st ON st.id = wh.staff_id
        WHERE wh.staff_id = $2
          AND st.scheduling_type <> 'regular'
          AND wh.day_of_week = r.dow
          AND wh.active = TRUE
          AND (wh.location_id IS NULL OR wh.location_id = r.location_id)
     ),
     recurring_closed AS (
       SELECT 1
         FROM staff_recurring_day_closures c
         JOIN requested r ON TRUE
         JOIN staff st ON st.id = c.staff_id
        WHERE c.staff_id = $2
          AND st.scheduling_type <> 'regular'
          AND c.day_of_week = r.dow
          AND (c.location_id IS NULL OR c.location_id = r.location_id)
        LIMIT 1
     ),
     exception_windows AS (
       SELECT ex.exception_type, ex.starts_local, ex.ends_local
         FROM staff_schedule_exceptions ex, requested r
        WHERE ex.staff_id = $2
          AND ex.exception_date = r.local_date
          AND (ex.location_id IS NULL OR ex.location_id = r.location_id)
     ),
     inherited_windows AS (
       SELECT cw.starts_local, cw.ends_local
         FROM clinic_windows cw
         JOIN staff st ON st.id = $2
        WHERE st.scheduling_type = 'regular'
     ),
     staff_windows AS (
       SELECT starts_local, ends_local FROM base_windows
        WHERE NOT EXISTS (
          SELECT 1 FROM exception_windows ex
           WHERE ex.exception_type = 'unavailable'
             AND ex.starts_local IS NULL AND ex.ends_local IS NULL
        )
       UNION ALL
       SELECT starts_local, ends_local FROM inherited_windows
        WHERE NOT EXISTS (
          SELECT 1 FROM exception_windows ex
           WHERE ex.exception_type = 'unavailable'
             AND ex.starts_local IS NULL AND ex.ends_local IS NULL
        )
       UNION ALL
       SELECT starts_local, ends_local FROM exception_windows
        WHERE exception_type = 'available'
          AND starts_local IS NOT NULL AND ends_local IS NOT NULL
     ),
     effective_windows AS (
       SELECT GREATEST(sw.starts_local, cw.starts_local) AS starts_local,
              LEAST(sw.ends_local, cw.ends_local) AS ends_local
         FROM staff_windows sw
         JOIN clinic_windows cw
           ON sw.starts_local < cw.ends_local
          AND sw.ends_local > cw.starts_local
     ),
     candidates AS (
       SELECT (r.local_date + ew.starts_local + (gs.n * ($5::text || ' minutes')::interval)) AS local_start,
              (r.local_date + ew.starts_local + (gs.n * ($5::text || ' minutes')::interval) + ($4::text || ' minutes')::interval) AS local_end
         FROM requested r
         JOIN effective_windows ew ON ew.ends_local > ew.starts_local
         CROSS JOIN LATERAL generate_series(
           0,
           GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ew.ends_local - ew.starts_local)) / 60 / $5)::int)
         ) AS gs(n)
        WHERE r.local_date + ew.starts_local + (gs.n * ($5::text || ' minutes')::interval) + ($4::text || ' minutes')::interval
              <= r.local_date + ew.ends_local
     )
     SELECT DISTINCT (c.local_start AT TIME ZONE '${TZ}') AS starts_at,
            (c.local_end AT TIME ZONE '${TZ}') AS ends_at
       FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM exception_windows ex
         WHERE ex.exception_type = 'unavailable'
           AND ex.starts_local IS NOT NULL AND ex.ends_local IS NOT NULL
           AND c.local_start < ($1::date + ex.ends_local)
           AND c.local_end > ($1::date + ex.starts_local)
      )
        AND NOT EXISTS (
          SELECT 1
            FROM appointment_staff ast
            JOIN appointments a ON a.id = ast.appointment_id
           WHERE ast.staff_id = $2
             AND a.status NOT IN ('cancelled','no_show')
             AND ($6::bigint IS NULL OR a.id <> $6)
             AND a.starts_at < (c.local_end AT TIME ZONE '${TZ}')
             AND a.ends_at > (c.local_start AT TIME ZONE '${TZ}')
        )
        AND NOT EXISTS (
          SELECT 1 FROM calendar_blocks cb
           WHERE cb.staff_id = $2
             AND cb.starts_at < (c.local_end AT TIME ZONE '${TZ}')
             AND cb.ends_at > (c.local_start AT TIME ZONE '${TZ}')
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointment_booking_approvals aba
           WHERE aba.proposed_staff_ids @> ARRAY[$2::bigint]
             AND aba.status = 'awaiting_client_confirmation'
             AND aba.proposal_expires_at > NOW()
             AND ($6::bigint IS NULL OR aba.appointment_id <> $6)
             AND aba.proposed_starts_at < (c.local_end AT TIME ZONE '${TZ}')
             AND aba.proposed_ends_at > (c.local_start AT TIME ZONE '${TZ}')
        )
      ORDER BY starts_at`,
    [date, staffId, locationId, totalMinutes, intervalMinutes, excludeAppointmentId]
  );

  return {
    status: result.rows.length ? 'available' : 'no_slots',
    resource,
    date,
    totalMinutes,
    intervalMinutes,
    schedulingAuthority: 'shiloh_canonical',
    calendarEnabled: false,
    calendarConflictCount: 0,
    slots: result.rows,
  };
}

module.exports = { canonicalServiceTotalMinutes, listAvailableSlots };
