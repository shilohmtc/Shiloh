-- A clinic iPad has a revocable client-only capability. No staff or client
-- browser session is retained when the device is handed to a visitor.
CREATE TABLE clinic_checkin_devices (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  activated_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE clinic_checkin_sessions (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES clinic_checkin_devices(id),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','needs_staff','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX clinic_checkin_sessions_device_active_idx
  ON clinic_checkin_sessions (device_id,expires_at) WHERE status='active';

CREATE TABLE clinic_checkin_form_handoffs (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES clinic_checkin_devices(id),
  assignment_id BIGINT NOT NULL REFERENCES consultation_form_assignments(id),
  queued_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','finished','cancelled')),
  form_token_hash TEXT UNIQUE CHECK (form_token_hash IS NULL OR form_token_hash ~ '^[0-9a-f]{64}$'),
  visit_token_hash TEXT UNIQUE CHECK (visit_token_hash IS NULL OR visit_token_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX clinic_checkin_form_handoffs_one_queued_per_device
  ON clinic_checkin_form_handoffs(device_id) WHERE status='queued';
