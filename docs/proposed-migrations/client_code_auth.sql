-- REVIEW ONLY. Not in automatic migrations; no production execution authorized.
ALTER TABLE client_browser_sessions ADD COLUMN code_identity_revision TEXT;
CREATE TABLE client_code_records (
  record_hash TEXT PRIMARY KEY CHECK(record_hash ~ '^[a-f0-9]{64}$'),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object')
);
CREATE INDEX client_code_records_expiry ON client_code_records(expires_at);
CREATE INDEX client_code_queue ON client_code_records(queued_at) WHERE payload->>'state'='queued';
CREATE INDEX client_code_person ON client_code_records((payload->>'personKey'));
CREATE TABLE client_code_rates (
  bucket_key TEXT PRIMARY KEY CHECK(bucket_key ~ '^[a-f0-9]{64}$'),
  attempts INTEGER NOT NULL CHECK(attempts>=0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX client_code_rates_expiry ON client_code_rates(expires_at);
CREATE TABLE IF NOT EXISTS code_auth_invitation_visits (
  audience TEXT NOT NULL CHECK(audience IN ('staff','client')),
  session_id BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(audience,session_id)
);
