-- Account-bound names/DOB; keep the existing recorded mobile as identity authority.
-- Do not guess staff surnames or birthdays, or backfill from client records.
ALTER TABLE staff_admin_accounts
  ADD COLUMN sign_in_first_name TEXT,
  ADD COLUMN sign_in_surname TEXT,
  ADD COLUMN sign_in_date_of_birth DATE,
  ADD CONSTRAINT staff_sign_in_details_check CHECK (
    (sign_in_first_name IS NULL AND sign_in_surname IS NULL AND sign_in_date_of_birth IS NULL)
    OR (NULLIF(BTRIM(sign_in_first_name),'') IS NOT NULL
      AND NULLIF(BTRIM(sign_in_surname),'') IS NOT NULL
      AND LENGTH(sign_in_first_name)<=100 AND LENGTH(sign_in_surname)<=100
      AND sign_in_date_of_birth IS NOT NULL AND sign_in_date_of_birth >= DATE '1900-01-01')
  );
ALTER TABLE staff_browser_sessions
  ADD COLUMN detail_identity_revision TEXT CHECK (detail_identity_revision IS NULL OR detail_identity_revision ~ '^[a-f0-9]{64}$');
ALTER TABLE staff_browser_sessions DROP CONSTRAINT staff_browser_session_auth_method_check;
ALTER TABLE staff_browser_sessions ADD CONSTRAINT staff_browser_session_auth_method_check
  CHECK (auth_method IN ('whatsapp_otp','totp','recovery_code','emergency_bootstrap','break_glass','passkey','staff_details'));
ALTER TABLE staff_auth_security_events DROP CONSTRAINT staff_auth_event_method_check;
ALTER TABLE staff_auth_security_events ADD CONSTRAINT staff_auth_event_method_check
  CHECK (auth_method IS NULL OR auth_method IN ('whatsapp_otp','totp','recovery_code','emergency_bootstrap','break_glass','control','passkey','staff_details'));
CREATE TABLE staff_detail_auth_rate_buckets (
  bucket_key TEXT PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  blocked_until TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX staff_detail_auth_rate_expiry ON staff_detail_auth_rate_buckets(expires_at);
