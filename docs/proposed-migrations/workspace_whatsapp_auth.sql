-- REVIEW ONLY. Outside migrations/ deliberately: startup cannot apply this.
-- Assign a migration number and obtain execution authority before promotion.
ALTER TABLE staff_browser_sessions DROP CONSTRAINT staff_browser_session_auth_method_check;
ALTER TABLE staff_browser_sessions ADD CONSTRAINT staff_browser_session_auth_method_check
  CHECK (auth_method IN ('whatsapp_otp','totp','recovery_code','emergency_bootstrap','break_glass','passkey','staff_details','workspace_whatsapp','workspace_sms'));

CREATE TABLE workspace_whatsapp_records (
  record_hash TEXT PRIMARY KEY CHECK (record_hash ~ '^[a-f0-9]{64}$'),
  kind TEXT NOT NULL CHECK (kind IN ('challenge','intent','grant')),
  admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin','enroll','recover')),
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX workspace_whatsapp_records_admin ON workspace_whatsapp_records(admin_id,kind,purpose);
CREATE INDEX workspace_whatsapp_records_expiry ON workspace_whatsapp_records(expires_at);
CREATE TABLE workspace_whatsapp_rate_buckets (
  bucket_key TEXT PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX workspace_whatsapp_rate_expiry ON workspace_whatsapp_rate_buckets(expires_at);

-- Durable intake includes decoys; it is deliberately not tied to an account.
-- Mobile is authenticated ciphertext, references are hashes. No code is queued.
CREATE TABLE workspace_whatsapp_dispatch (
  request_hash TEXT PRIMARY KEY CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX workspace_whatsapp_dispatch_queue ON workspace_whatsapp_dispatch(queued_at)
  WHERE payload->>'state'='queued';
CREATE INDEX workspace_whatsapp_dispatch_expiry ON workspace_whatsapp_dispatch(expires_at);

-- One invitation visit per issued session; a new sign-in gets a fresh visit.
CREATE TABLE IF NOT EXISTS code_auth_invitation_visits (
  audience TEXT NOT NULL CHECK(audience IN ('staff','client')),
  session_id BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(audience,session_id)
);
