CREATE TABLE IF NOT EXISTS location_assistant_booking_hours (
  id BIGSERIAL PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  starts_local TIME NOT NULL,
  ends_local TIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_local > starts_local),
  UNIQUE (location_id, day_of_week, starts_local, ends_local)
);

CREATE UNIQUE INDEX IF NOT EXISTS location_assistant_booking_hours_one_active_day
  ON location_assistant_booking_hours(location_id, day_of_week) WHERE active=TRUE;

CREATE TABLE IF NOT EXISTS location_assistant_hours_exceptions (
  id BIGSERIAL PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('open','closed')),
  starts_local TIME,
  ends_local TIME,
  actor_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, exception_date),
  CHECK ((exception_type='closed' AND starts_local IS NULL AND ends_local IS NULL)
      OR (exception_type='open' AND starts_local IS NOT NULL AND ends_local IS NOT NULL AND ends_local > starts_local))
);

-- Preserve current client-facing behaviour on rollout, then allow the two schedules to diverge deliberately.
INSERT INTO location_assistant_booking_hours(location_id, day_of_week, starts_local, ends_local, active)
SELECT location_id, day_of_week, starts_local, ends_local, TRUE
  FROM location_working_hours
 WHERE active=TRUE AND day_of_week BETWEEN 1 AND 6
ON CONFLICT (location_id, day_of_week, starts_local, ends_local)
DO UPDATE SET active=TRUE, updated_at=NOW();

COMMENT ON TABLE location_assistant_booking_hours IS
  'Recurring client-facing availability for Shiloh Assistant; clinic operating hours remain the hard outer boundary.';
COMMENT ON TABLE location_assistant_hours_exceptions IS
  'Date-specific Shiloh Assistant availability, evaluated only after the clinic-wide date is open.';
