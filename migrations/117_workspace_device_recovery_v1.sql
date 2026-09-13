-- SHILOH-WORKSPACE-DEVICE-RECOVERY-V1
-- Add a purpose-isolated WebAuthn challenge for replacing a lost device through the
-- existing one-use WhatsApp bootstrap and canonical passkey/session authority.
-- No new identity, permission, provider, OTP, token, biometric or session store is added.

ALTER TABLE staff_auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS staff_auth_webauthn_purpose_check;
ALTER TABLE staff_auth_webauthn_challenges
  ADD CONSTRAINT staff_auth_webauthn_purpose_check CHECK (
    purpose IN (
      'registration',
      'registration_replacement',
      'authentication',
      'bootstrap_registration',
      'bootstrap_replacement_registration'
    )
  );

ALTER TABLE staff_auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS staff_auth_webauthn_registration_binding_check;
ALTER TABLE staff_auth_webauthn_challenges
  ADD CONSTRAINT staff_auth_webauthn_registration_binding_check CHECK (
    (purpose IN ('registration', 'registration_replacement')
        AND admin_id IS NOT NULL AND session_id IS NOT NULL)
    OR (purpose IN ('bootstrap_registration', 'bootstrap_replacement_registration')
        AND admin_id IS NOT NULL AND session_id IS NULL)
    OR (purpose = 'authentication' AND admin_id IS NOT NULL AND session_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_staff_auth_webauthn_bootstrap_replacement_admin
  ON staff_auth_webauthn_challenges(admin_id, expires_at DESC)
  WHERE purpose = 'bootstrap_replacement_registration' AND consumed_at IS NULL;
