-- Old queued handoffs lack explicit physical handover and fail closed.
ALTER TABLE clinic_checkin_form_handoffs
  ADD COLUMN crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id),
  ADD COLUMN appointment_id BIGINT REFERENCES appointments(id),
  ADD COLUMN identity_revision TEXT CHECK (identity_revision IS NULL OR identity_revision ~ '^[0-9a-f]{64}$'),
  ADD COLUMN handed_over_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  ADD COLUMN handed_over_at TIMESTAMPTZ;
ALTER TABLE clinic_checkin_form_handoffs ADD CONSTRAINT clinic_handover_confirmation_pair
  CHECK ((handed_over_at IS NULL) = (handed_over_by_admin_id IS NULL));
