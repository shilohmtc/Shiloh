-- A client visit with several treatments keeps one logical booking/payment while
-- each treatment remains an independently scheduled canonical appointment.
ALTER TABLE appointment_groups DROP CONSTRAINT IF EXISTS appointment_groups_group_type_check;
ALTER TABLE appointment_groups ADD CONSTRAINT appointment_groups_group_type_check
  CHECK (group_type IN ('couples_massage','group_booking','multi_service_booking'));

CREATE TABLE IF NOT EXISTS admin_multi_service_booking_sessions (
  admin_id BIGINT PRIMARY KEY REFERENCES staff_admin_accounts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL DEFAULT 'confirm' CHECK (state IN ('confirm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE admin_multi_service_booking_sessions IS
  'Short-lived review draft for one CRM V2 client and 2-10 linked treatment appointments; all writes occur at atomic confirmation.';
