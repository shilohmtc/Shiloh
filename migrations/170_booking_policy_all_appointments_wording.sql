-- Owner-authorized wording: 50% deposit for all appointments booked under the current policy.
-- Preserve the original effective date, earlier booking exceptions, and all acceptance/payment history.
DO $$
DECLARE
  policy_row clinic_booking_deposit_policy%ROWTYPE;
BEGIN
  SELECT * INTO policy_row FROM clinic_booking_deposit_policy WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking Policy wording v4 requires the existing deposit policy row';
  END IF;

  IF policy_row.enabled IS DISTINCT FROM TRUE
     OR policy_row.rate_basis_points <> 5000
     OR policy_row.free_notice_hours <> 48
     OR policy_row.partial_notice_hours <> 24
     OR policy_row.partial_forfeit_basis_points <> 5000
     OR policy_row.late_forfeit_basis_points <> 10000
     OR policy_row.no_show_forfeit_basis_points <> 10000
     OR policy_row.policy_version <> '2026-09-25-v3' THEN
    RAISE EXCEPTION 'Booking Policy wording v4 refused because the existing deposit policy drifted';
  END IF;

  UPDATE clinic_booking_deposit_policy
     SET policy_version='2026-09-27-v4', updated_at=NOW()
   WHERE id=1;
END $$;

COMMENT ON TABLE clinic_booking_deposit_policy IS
  'Technical deposit-enforcement mirror of the single Shiloh Booking Policy & Terms. Current version: 2026-09-27-v4.';
