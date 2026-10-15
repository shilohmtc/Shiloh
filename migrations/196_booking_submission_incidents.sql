-- Approved short-lived support links only. No historical reconstruction or business-data rewrite.
CREATE TABLE booking_submission_incidents (
  id BIGSERIAL PRIMARY KEY,
  reference UUID NOT NULL UNIQUE,
  crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE SET NULL,
  booking_kind TEXT NOT NULL CHECK (booking_kind IN ('ordinary','multiple','couples')),
  attempt_key UUID NOT NULL,
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 1 CHECK (failure_count > 0),
  technical_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_help' CHECK (status IN ('needs_help','retry_succeeded','resolved')),
  recovered_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(crm_v2_client_id, booking_kind, attempt_key, input_fingerprint),
  CHECK (expires_at = first_failed_at + INTERVAL '14 days'),
  CHECK (last_failed_at >= first_failed_at)
);
CREATE INDEX booking_submission_incidents_expiry ON booking_submission_incidents(expires_at);
CREATE INDEX booking_submission_incidents_attention ON booking_submission_incidents(status,last_failed_at DESC);
COMMENT ON TABLE booking_submission_incidents IS
  'Internal support links expire 14 days after first failure. No payloads, names, contact details, health answers or payment data. Staff audit uses reference only; never copy client/attempt links into audit or Sentry.';
