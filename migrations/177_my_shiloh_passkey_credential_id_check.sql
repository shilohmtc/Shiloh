-- PostgreSQL rejects the upper bound in the original credential-id regex.
-- Keep the WebAuthn length limit separate from the base64url character check.
ALTER TABLE client_auth_passkey_credentials
  DROP CONSTRAINT IF EXISTS client_passkey_credential_id;

ALTER TABLE client_auth_passkey_credentials
  ADD CONSTRAINT client_passkey_credential_id CHECK (
    char_length(credential_id) BETWEEN 16 AND 1366
    AND credential_id ~ '^[A-Za-z0-9_-]+$'
  );
