-- Add a privacy-safe, user-editable name for each Workspace passkey.
ALTER TABLE staff_auth_passkey_credentials
  ADD COLUMN IF NOT EXISTS device_label TEXT;

ALTER TABLE staff_auth_passkey_credentials
  DROP CONSTRAINT IF EXISTS staff_auth_passkey_credentials_device_label_check;

ALTER TABLE staff_auth_passkey_credentials
  ADD CONSTRAINT staff_auth_passkey_credentials_device_label_check
  CHECK (
    device_label IS NULL OR (
      char_length(device_label) BETWEEN 1 AND 48
      AND device_label = btrim(device_label)
      AND device_label !~ '[[:cntrl:]]'
    )
  );
