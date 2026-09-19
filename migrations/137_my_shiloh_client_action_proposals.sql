-- My Shiloh confirmed client actions.
--
-- Durable one-time proposals separate AI understanding from consequential client
-- mutations. A proposal does not change an appointment. It only records the exact
-- authenticated session/client/appointment revision that may be confirmed within
-- a short bounded window.

CREATE TABLE IF NOT EXISTS client_action_proposals (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES client_browser_sessions(id) ON DELETE RESTRICT,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('cancel_appointment')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  appointment_revision TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'confirmed','declined','appointment_changed','appointment_started',
    'already_cancelled','ownership_changed','complex_booking','failed'
  )),
  CONSTRAINT client_action_proposal_expiry CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_client_action_proposals_session_active
  ON client_action_proposals(session_id, issued_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_action_proposals_client_appointment
  ON client_action_proposals(crm_v2_client_id, appointment_id, issued_at DESC);

COMMENT ON TABLE client_action_proposals IS
  'One-time authenticated My Shiloh action proposals. Rows authorize no mutation by themselves; canonical domain guards must revalidate ownership and appointment revision at confirmation time.';
