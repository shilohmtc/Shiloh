-- A short-lived, client-owned bridge for one WhatsApp AI exchange.
-- No full transcript, provider response ID, clinical record, or browser storage.
CREATE TABLE IF NOT EXISTS client_whatsapp_continuations (
  crm_v2_client_id BIGINT PRIMARY KEY REFERENCES crm_v2_clients(id) ON DELETE CASCADE,
  mobile_hash TEXT NOT NULL CHECK (mobile_hash ~ '^[0-9a-f]{64}$'),
  client_message TEXT NOT NULL CHECK (CHAR_LENGTH(client_message) BETWEEN 1 AND 500),
  shiloh_reply TEXT NOT NULL CHECK (CHAR_LENGTH(shiloh_reply) BETWEEN 1 AND 900),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_by_session_id BIGINT REFERENCES client_browser_sessions(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ,
  CONSTRAINT client_whatsapp_continuations_claim CHECK (
    (claimed_by_session_id IS NULL AND claimed_at IS NULL)
    OR (claimed_by_session_id IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT client_whatsapp_continuations_expiry CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS client_whatsapp_continuations_expiry
  ON client_whatsapp_continuations(expires_at);
