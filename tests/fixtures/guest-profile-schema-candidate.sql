-- Proposed guest storage. Production execution requires specific owner approval.
-- Keep guest creation disabled; verify recovery, inventory and rollback before release.
ALTER TABLE crm_v2_clients ADD COLUMN contact_mode TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE crm_v2_clients ADD CONSTRAINT crm_v2_contact_mode_valid
  CHECK (contact_mode IN ('direct','organiser'));
ALTER TABLE crm_v2_clients ALTER COLUMN normalized_mobile DROP NOT NULL;
ALTER TABLE crm_v2_clients ADD CONSTRAINT crm_v2_contact_identity_valid CHECK (
  (contact_mode='direct' AND normalized_mobile IS NOT NULL)
  OR (contact_mode='organiser' AND normalized_mobile IS NULL
      AND profile_status='minimal' AND mobile_verified_at IS NULL)
);
-- Existing mobile-format and active-mobile uniqueness constraints remain in force.
-- Contact is booking-specific; never an identity alias or private-record access grant.
CREATE TABLE appointment_group_booking_contacts (
  appointment_group_id BIGINT PRIMARY KEY REFERENCES appointment_groups(id) ON DELETE RESTRICT,
  organiser_crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The application must lock/revalidate an active direct-contact organiser before every send.
-- Do not store a duplicate mobile snapshot here as a substitute recipient authority.

-- Guest lifecycle delivery: explicit booking recipient, never a guest phone alias.
-- Existing direct/legacy rows keep their phone and default role unchanged.
ALTER TABLE appointment_lifecycle
  ADD COLUMN delivery_recipient_role TEXT NOT NULL DEFAULT 'client',
  ADD COLUMN organiser_group_id BIGINT REFERENCES appointment_group_booking_contacts(appointment_group_id) ON DELETE RESTRICT;
ALTER TABLE appointment_lifecycle ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE appointment_lifecycle ADD CONSTRAINT appointment_lifecycle_recipient_valid CHECK (
  (delivery_recipient_role='client' AND phone IS NOT NULL AND organiser_group_id IS NULL)
  OR (delivery_recipient_role='organiser' AND phone IS NULL AND organiser_group_id IS NOT NULL
      AND appointment_id IS NOT NULL AND crm_v2_client_id IS NOT NULL AND client_id IS NULL)
);
