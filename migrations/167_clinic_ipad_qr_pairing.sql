-- A short-lived pairing reference scanned on a staff phone. The actual iPad
-- capability stays in its own HttpOnly cookie and is stored only as a digest.
CREATE TABLE clinic_checkin_pairings (
  pair_id TEXT PRIMARY KEY CHECK (pair_id ~ '^[A-Za-z0-9_-]{22}$'),
  device_token_hash TEXT NOT NULL UNIQUE CHECK (device_token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  approved_at TIMESTAMPTZ,
  device_id BIGINT REFERENCES clinic_checkin_devices(id),
  CHECK (expires_at > created_at),
  CHECK ((approved_at IS NULL AND approved_by_admin_id IS NULL AND device_id IS NULL)
      OR (approved_at IS NOT NULL AND approved_by_admin_id IS NOT NULL AND device_id IS NOT NULL))
);
CREATE INDEX clinic_checkin_pairings_expiry_idx ON clinic_checkin_pairings(expires_at);
