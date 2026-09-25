-- Owner-authorized client-language refinement for Shiloh Booking Policy & Terms.
-- No deposit, cancellation, rescheduling, no-show or practitioner-exemption rule changes.
-- Existing acceptance/deposit history remains on the policy version that was in force when recorded.

DO $$
DECLARE
  policy_row clinic_booking_deposit_policy%ROWTYPE;
BEGIN
  SELECT *
    INTO policy_row
    FROM clinic_booking_deposit_policy
   WHERE id=1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking Policy wording v3 requires the existing deposit policy row';
  END IF;

  IF policy_row.rate_basis_points <> 5000
     OR policy_row.free_notice_hours <> 48
     OR policy_row.partial_notice_hours <> 24
     OR policy_row.partial_forfeit_basis_points <> 5000
     OR policy_row.late_forfeit_basis_points <> 10000
     OR policy_row.no_show_forfeit_basis_points <> 10000 THEN
    RAISE EXCEPTION 'Booking Policy wording v3 refused because deposit-rule values drifted';
  END IF;

  IF policy_row.policy_version NOT IN ('2026-09-23-v2','2026-09-25-v3') THEN
    RAISE EXCEPTION 'Booking Policy wording v3 refused because policy version drifted: %', policy_row.policy_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM staff
     WHERE id=policy_row.exempt_staff_id
       AND status='active'
       AND LOWER(TRIM(display_name))='marietjie'
  ) THEN
    RAISE EXCEPTION 'Booking Policy wording v3 refused because the existing deposit exemption authority drifted';
  END IF;

  UPDATE clinic_booking_deposit_policy
     SET policy_version='2026-09-25-v3',
         updated_at=NOW()
   WHERE id=1
     AND policy_version='2026-09-23-v2';
END $$;

COMMENT ON TABLE clinic_booking_deposit_policy IS
  'Technical deposit-enforcement mirror of the single Shiloh Booking Policy & Terms. Current version: 2026-09-25-v3.';
