-- Prepared only: production migration and tablet authentication activation
-- require separate explicit approval and the controlled migration release gate.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE clinic_tablet_visit_grants (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  device_id BIGINT NOT NULL REFERENCES clinic_checkin_devices(id),
  assignment_id BIGINT REFERENCES consultation_form_assignments(id),
  state TEXT NOT NULL CHECK (state IN ('code','choose','form','help','finished','cancelled')),
  payload_ciphertext TEXT NOT NULL CHECK (CHAR_LENGTH(payload_ciphertext) BETWEEN 40 AND 65536),
  created_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK ((state='form') = (assignment_id IS NOT NULL)),
  CHECK (expires_at > created_at),
  CHECK (last_activity_at >= created_at)
);
CREATE UNIQUE INDEX clinic_tablet_one_active_visit_per_device ON clinic_tablet_visit_grants(device_id)
  WHERE state IN ('code','choose','form','help');
CREATE INDEX clinic_tablet_visit_expiry ON clinic_tablet_visit_grants(expires_at);

CREATE INDEX clinic_tablet_visit_idle_expiry ON clinic_tablet_visit_grants(last_activity_at);

CREATE UNIQUE INDEX clinic_tablet_one_active_assignment ON clinic_tablet_visit_grants(assignment_id) WHERE state='form';
