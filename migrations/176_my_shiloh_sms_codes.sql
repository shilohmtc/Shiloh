-- One-time SMS enrollment and account recovery, bound to one browser and one mobile.
CREATE TABLE IF NOT EXISTS client_sms_auth_challenges (
  id BIGSERIAL PRIMARY KEY,
  browser_token_hash TEXT NOT NULL UNIQUE,
  normalized_mobile TEXT NOT NULL,
  client_name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  request_fingerprint_hash TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (browser_token_hash ~ '^[0-9a-f]{64}$'),
  CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CHECK (verify_attempts BETWEEN 0 AND 5),
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_client_sms_auth_mobile_issued
  ON client_sms_auth_challenges(normalized_mobile, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_sms_auth_fingerprint_issued
  ON client_sms_auth_challenges(request_fingerprint_hash, issued_at DESC)
  WHERE request_fingerprint_hash IS NOT NULL;
