-- Short-lived registration claims for the single-recipient WhatsApp booking pilot.
-- Only keyed fingerprints are retained for the sending number and inbound callback.
CREATE TABLE whatsapp_booking_registration_grants (
  token_digest TEXT PRIMARY KEY CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  recipient_digest TEXT NOT NULL CHECK (recipient_digest ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  completion_digest TEXT CHECK (completion_digest ~ '^[a-f0-9]{64}$'),
  completed_client_id BIGINT,
  CHECK ((completion_digest IS NULL) = (completed_client_id IS NULL))
);
CREATE INDEX whatsapp_booking_registration_grants_expiry
  ON whatsapp_booking_registration_grants (expires_at);
