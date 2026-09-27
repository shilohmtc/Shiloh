-- One-use, short-lived code created by an authorised staff member on their own device.
-- Only its digest is retained; the iPad receives the client-only capability.
CREATE TABLE clinic_checkin_setup_codes (
  code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  device_id BIGINT REFERENCES clinic_checkin_devices(id),
  CHECK (expires_at > created_at)
);
CREATE INDEX clinic_checkin_setup_codes_expiry_idx ON clinic_checkin_setup_codes(expires_at);
