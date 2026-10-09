-- Draft only: separate typed names without guessing or backfilling existing names.
ALTER TABLE crm_v2_clients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE crm_v2_clients ADD COLUMN IF NOT EXISTS surname TEXT;
ALTER TABLE crm_v2_clients ADD CONSTRAINT crm_v2_explicit_names CHECK (
  (first_name IS NULL AND surname IS NULL) OR
  (NULLIF(BTRIM(first_name),'') IS NOT NULL AND NULLIF(BTRIM(surname),'') IS NOT NULL
   AND LENGTH(first_name)<=100 AND LENGTH(surname)<=100)
);
CREATE INDEX crm_v2_detail_auth_mobile ON crm_v2_clients(normalized_mobile);
CREATE INDEX crm_v2_detail_auth_dob ON crm_v2_clients(date_of_birth) WHERE date_of_birth IS NOT NULL;

-- Shared across processes/restarts; keys are HMACs, never phone/DOB/name/IP values.
CREATE TABLE client_crm_auth_rate_buckets (
  bucket_key TEXT PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  blocked_until TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX client_crm_auth_rate_expiry ON client_crm_auth_rate_buckets(expires_at);
