-- #985: Couples-discount authority is narrower than general service pricing.
-- Grant the dedicated capability by canonical role/scope only: active owners
-- and the active all-business booking operator (Reception). Business admins
-- and practitioners are deliberately excluded.

UPDATE staff_admin_accounts
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || '{"appointment:couples:discount":true}'::jsonb,
       updated_at = NOW()
 WHERE active = TRUE
   AND business_role IN ('owner','booking_operator')
   AND calendar_scope = 'all_business'
   AND service_scope = 'all_services'
   AND COALESCE((permissions ->> 'appointment:couples:discount')::boolean, FALSE) IS NOT TRUE;

COMMENT ON COLUMN appointment_groups.discounted_by_admin_id IS
  'Canonical staff-admin principal whose appointment:couples:discount capability authorized the discretionary discount.';
