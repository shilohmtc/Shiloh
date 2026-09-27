-- Label client credentials and link verified sessions to their passkey for revocation.
ALTER TABLE client_auth_passkey_credentials
  ADD COLUMN device_label TEXT NOT NULL DEFAULT 'Shiloh device',
  ADD CONSTRAINT client_passkey_device_label_length CHECK (char_length(device_label) BETWEEN 1 AND 48);

ALTER TABLE client_browser_sessions
  ADD COLUMN passkey_credential_id BIGINT REFERENCES client_auth_passkey_credentials(id) ON DELETE RESTRICT;

CREATE INDEX idx_client_sessions_passkey_active
  ON client_browser_sessions(passkey_credential_id)
  WHERE passkey_credential_id IS NOT NULL AND revoked_at IS NULL;
