-- In-person future-booking policy acceptance linkage.
-- The canonical acceptance authority remains booking_policy_acceptances.
-- This migration only links acceptance evidence to CRM V2 clients/appointments and
-- adds opaque, single-booking request keys for clinic-device / client-phone review.

ALTER TABLE booking_policy_acceptances
  ADD COLUMN IF NOT EXISTS crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_policy_acceptances_crm_v2_client
  ON booking_policy_acceptances(crm_v2_client_id, accepted_at DESC)
  WHERE crm_v2_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_policy_acceptances_appointment
  ON booking_policy_acceptances(appointment_id, accepted_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_policy_acceptances_appointment_version
  ON booking_policy_acceptances(appointment_id, policy_version)
  WHERE appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS booking_policy_acceptance_requests (
  appointment_id BIGINT PRIMARY KEY REFERENCES appointments(id) ON DELETE RESTRICT,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  phone_snapshot VARCHAR(32) NOT NULL,
  policy_version TEXT NOT NULL,
  policy_text_snapshot TEXT NOT NULL,
  policy_updated_snapshot TEXT,
  clinic_request_key VARCHAR(80) NOT NULL UNIQUE,
  client_request_key VARCHAR(80) NOT NULL UNIQUE,
  created_by_admin_id BIGINT REFERENCES staff_admin_accounts(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (clinic_request_key ~ '^[A-Za-z0-9_-]{32,80}$'),
  CHECK (client_request_key ~ '^[A-Za-z0-9_-]{32,80}$'),
  CHECK (clinic_request_key <> client_request_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_policy_acceptance_requests_client
  ON booking_policy_acceptance_requests(crm_v2_client_id, created_at DESC);

COMMENT ON TABLE booking_policy_acceptance_requests IS
  'Opaque review links for one future booking. Acceptance truth remains in booking_policy_acceptances; this table is only a bounded client-review gate.';
