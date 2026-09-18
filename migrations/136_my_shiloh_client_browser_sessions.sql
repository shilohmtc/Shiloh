-- My Shiloh client browser-session authority.
-- Separate from staff/Admin browser authentication and bound only to canonical CRM V2 clients.

CREATE TABLE IF NOT EXISTS client_browser_auth_challenges (
  id BIGSERIAL PRIMARY KEY,
  browser_token_hash TEXT NOT NULL UNIQUE,
  whatsapp_token_hash TEXT NOT NULL UNIQUE,
  crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  request_fingerprint_hash TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT client_browser_auth_challenge_browser_hash CHECK (browser_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_browser_auth_challenge_whatsapp_hash CHECK (whatsapp_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_browser_auth_challenge_attempts CHECK (verify_attempts >= 0 AND verify_attempts <= 5),
  CONSTRAINT client_browser_auth_challenge_expiry CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_client_browser_auth_challenges_expiry
  ON client_browser_auth_challenges(expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_browser_auth_challenges_fingerprint
  ON client_browser_auth_challenges(request_fingerprint_hash, issued_at DESC)
  WHERE request_fingerprint_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_browser_sessions (
  id BIGSERIAL PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  reauthenticated_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  auth_method TEXT NOT NULL DEFAULT 'whatsapp_challenge',
  client_fingerprint_hash TEXT,
  CONSTRAINT client_browser_session_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_browser_session_csrf_hash CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_browser_session_expiry CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_client_browser_sessions_client_active
  ON client_browser_sessions(crm_v2_client_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS client_auth_security_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE SET NULL,
  challenge_id BIGINT REFERENCES client_browser_auth_challenges(id) ON DELETE SET NULL,
  session_id BIGINT REFERENCES client_browser_sessions(id) ON DELETE SET NULL,
  request_fingerprint_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_auth_security_events_client_created
  ON client_auth_security_events(crm_v2_client_id, created_at DESC);
