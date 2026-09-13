-- WORKSPACE-SELF-PASSKEY-BOOTSTRAP
-- Reuse the existing hashed, short-lived, single-use bootstrap authority when a
-- strongly authenticated staff member sets up another device for their own account.

ALTER TABLE staff_auth_passkey_bootstraps
  DROP CONSTRAINT IF EXISTS staff_auth_passkey_bootstrap_source_check;

ALTER TABLE staff_auth_passkey_bootstraps
  ADD CONSTRAINT staff_auth_passkey_bootstrap_source_check
    CHECK (source IN ('whatsapp_self', 'workspace_self'));
