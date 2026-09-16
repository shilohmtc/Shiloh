-- Private, explicitly enabled consultation-form trials.
-- No client, appointment, financial, scheduling or message-delivery rows are
-- created by this feature. Test answers must never enter a real client record.
CREATE TABLE IF NOT EXISTS consultation_form_trials (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  template_version_id BIGINT NOT NULL REFERENCES consultation_form_template_versions(id) ON DELETE RESTRICT,
  template_snapshot JSONB NOT NULL CHECK (jsonb_typeof(template_snapshot) = 'object'),
  consent_text_snapshot TEXT NOT NULL CHECK (BTRIM(consent_text_snapshot) <> ''),
  expires_at TIMESTAMPTZ NOT NULL,
  payload_ciphertext TEXT CHECK (CHAR_LENGTH(payload_ciphertext) BETWEEN 1 AND 131072),
  payload_iv TEXT CHECK (payload_iv ~ '^[A-Za-z0-9_-]{16}$'),
  payload_auth_tag TEXT CHECK (payload_auth_tag ~ '^[A-Za-z0-9_-]{22}$'),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consultation_form_trial_envelope_complete CHECK (
    (submitted_at IS NULL AND payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL)
    OR (submitted_at IS NOT NULL AND payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_consultation_form_trials_expiry ON consultation_form_trials(expires_at);
COMMENT ON TABLE consultation_form_trials IS
  'Isolated user-authorized form tests. No CRM or booking identity. Answers and signature are encrypted. Access is limited to one configured expiring token hash; completed answers are never returned by the public route.';
