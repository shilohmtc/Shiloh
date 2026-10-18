-- Staff-only WhatsApp pilot. Client authentication remains unmounted/unmigrated.
-- Controlled executor owns the transaction; preserve every existing auth method.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE old_expression TEXT;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO old_expression FROM pg_constraint
    WHERE conrelid='staff_browser_sessions'::regclass
      AND conname='staff_browser_session_auth_method_check' AND contype='c';
  IF old_expression IS NULL THEN RAISE EXCEPTION 'Staff session auth-method constraint is missing'; END IF;
  ALTER TABLE staff_browser_sessions DROP CONSTRAINT staff_browser_session_auth_method_check;
  EXECUTE format('ALTER TABLE staff_browser_sessions ADD CONSTRAINT staff_browser_session_auth_method_check CHECK ((%s) OR auth_method IN (''workspace_whatsapp'',''workspace_sms''))',old_expression);
END $$;

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

CREATE INDEX IF NOT EXISTS code_auth_invitation_visits_expiry ON code_auth_invitation_visits(expires_at);
