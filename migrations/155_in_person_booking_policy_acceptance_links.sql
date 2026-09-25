-- Link new Booking Policy acceptance evidence to canonical client and appointment records.
-- Existing historical acceptance rows remain untouched and continue to be identified by phone/version/channel.

ALTER TABLE booking_policy_acceptances
  ADD COLUMN IF NOT EXISTS crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_policy_acceptances_crm_v2_client
  ON booking_policy_acceptances(crm_v2_client_id, accepted_at DESC)
  WHERE crm_v2_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_policy_acceptances_appointment
  ON booking_policy_acceptances(appointment_id, accepted_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_policy_acceptance_appointment_channel_version
  ON booking_policy_acceptances(appointment_id, policy_version, channel)
  WHERE appointment_id IS NOT NULL
    AND channel IN ('clinic_device','payment_link');
