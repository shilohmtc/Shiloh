-- Extend the linked-booking model from Couples to staff-created groups.
ALTER TABLE appointment_groups DROP CONSTRAINT IF EXISTS appointment_groups_group_type_check;
ALTER TABLE appointment_groups ADD CONSTRAINT appointment_groups_group_type_check
  CHECK (group_type IN ('couples_massage','group_booking'));

ALTER TABLE appointment_groups ALTER COLUMN service_id DROP NOT NULL;

ALTER TABLE appointment_group_members DROP CONSTRAINT IF EXISTS appointment_group_members_guest_position_check;
ALTER TABLE appointment_group_members ADD CONSTRAINT appointment_group_members_guest_position_check
  CHECK (guest_position BETWEEN 1 AND 10);

ALTER TABLE appointment_groups DROP CONSTRAINT IF EXISTS appointment_groups_discount_audit_complete;
ALTER TABLE appointment_groups ADD CONSTRAINT appointment_groups_discount_audit_complete
  CHECK (
    canonical_subtotal IS NULL
    OR (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount = 0
        AND discount_reason IS NULL AND discounted_by_admin_id IS NULL)
      OR
      (discount_type IN ('amount','percent') AND discount_value > 0
        AND discount_amount > 0 AND discounted_by_admin_id IS NOT NULL)
    )
  );

CREATE TABLE IF NOT EXISTS admin_group_booking_sessions (
  admin_id BIGINT PRIMARY KEY REFERENCES staff_admin_accounts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL DEFAULT 'confirm' CHECK (state IN ('confirm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE staff_admin_accounts
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || '{"appointment:group:discount":true}'::jsonb,
       updated_at = NOW()
 WHERE active = TRUE
   AND business_role IN ('owner','booking_operator')
   AND calendar_scope = 'all_business'
   AND service_scope = 'all_services'
   AND COALESCE((permissions ->> 'appointment:group:discount')::boolean, FALSE) IS NOT TRUE;

COMMENT ON TABLE admin_group_booking_sessions IS
  'Short-lived 3-10 guest group review draft; all client and appointment writes occur at atomic confirmation.';
COMMENT ON COLUMN appointment_groups.discount_reason IS
  'Optional operator note for a capability-authorized booking-level discount.';
COMMENT ON COLUMN appointment_groups.discounted_by_admin_id IS
  'Canonical staff-admin principal whose linked-booking discount capability authorized the adjustment.';
