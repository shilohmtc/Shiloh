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
