-- SHILOH-STAFF-DISCOVERABLE-PASSKEY-HANDOFF
-- Allow WebAuthn authentication without a browser-side credential hint when the
-- platform can present a discoverable Shiloh passkey.
-- Identity still comes only from a successfully verified credential assertion.

ALTER TABLE staff_auth_webauthn_challenges
  DROP CONSTRAINT IF EXISTS staff_auth_webauthn_registration_binding_check;

ALTER TABLE staff_auth_webauthn_challenges
  ADD CONSTRAINT staff_auth_webauthn_registration_binding_check CHECK (
    (purpose IN ('registration', 'registration_replacement')
        AND admin_id IS NOT NULL AND session_id IS NOT NULL)
    OR (purpose IN ('bootstrap_registration', 'bootstrap_replacement_registration')
        AND admin_id IS NOT NULL AND session_id IS NULL)
    OR (purpose = 'authentication' AND session_id IS NULL)
  );

COMMENT ON TABLE staff_auth_webauthn_challenges IS
  'WebAuthn challenge state. Authentication challenges may be targeted to a known credential/admin or unbound until a discoverable passkey assertion identifies the credential.';
