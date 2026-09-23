-- Owner-authorized consolidation of Shiloh Booking Policy & Terms and exact price repair for appointment #758.
-- Business semantics already approved: 50% deposit, 48/24 cancellation bands, Marietjie deposit exemption.
-- Appointment #758 is corrected to the verified R250 Toe Gel price so the existing deposit gate can proceed.

DO $$
DECLARE
  policy_row clinic_booking_deposit_policy%ROWTYPE;
  appointment_row RECORD;
  matching_service_count INTEGER;
  matching_staff_count INTEGER;
  payment_account_count INTEGER;
BEGIN
  SELECT *
    INTO policy_row
    FROM clinic_booking_deposit_policy
   WHERE id=1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unified Booking Policy requires the existing deposit policy row';
  END IF;

  IF policy_row.rate_basis_points <> 5000
     OR policy_row.free_notice_hours <> 48
     OR policy_row.partial_notice_hours <> 24
     OR policy_row.partial_forfeit_basis_points <> 5000
     OR policy_row.late_forfeit_basis_points <> 10000
     OR policy_row.no_show_forfeit_basis_points <> 10000 THEN
    RAISE EXCEPTION 'Unified Booking Policy migration refused because deposit-rule values drifted';
  END IF;

  IF policy_row.policy_version NOT IN ('2026-09-23-v1','2026-09-23-v2') THEN
    RAISE EXCEPTION 'Unified Booking Policy migration refused because policy version drifted: %', policy_row.policy_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM staff
     WHERE id=policy_row.exempt_staff_id
       AND status='active'
       AND LOWER(TRIM(display_name))='marietjie'
  ) THEN
    RAISE EXCEPTION 'Unified Booking Policy migration refused because the Marietjie exemption authority drifted';
  END IF;

  UPDATE clinic_booking_deposit_policy
     SET policy_version='2026-09-23-v2',
         updated_at=NOW()
   WHERE id=1;

  SELECT a.id,a.status,a.source,a.total_price,a.starts_at,a.ends_at
    INTO appointment_row
    FROM appointments a
   WHERE a.id=758
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment #758 price repair requires the exact appointment to exist';
  END IF;

  IF appointment_row.status NOT IN ('scheduled','confirmed') THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because status is %', appointment_row.status;
  END IF;

  IF appointment_row.source <> 'shiloh_client_whatsapp' THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because source is %', appointment_row.source;
  END IF;

  IF EXTRACT(EPOCH FROM (appointment_row.ends_at - appointment_row.starts_at)) <> 1800 THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because duration is not 30 minutes';
  END IF;

  IF appointment_row.total_price IS NOT NULL AND appointment_row.total_price <> 250 THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because current price is %', appointment_row.total_price;
  END IF;

  SELECT COUNT(*)::int
    INTO matching_service_count
    FROM appointment_services aps
   WHERE aps.appointment_id=758
     AND REGEXP_REPLACE(LOWER(TRIM(aps.service_name_snapshot)),'[^a-z0-9]+','','g')
         IN ('toegelonly','toegelapplication');

  IF matching_service_count <> 1 THEN
    RAISE EXCEPTION 'Appointment #758 price repair requires exactly one Toe Gel service snapshot; found %', matching_service_count;
  END IF;

  SELECT COUNT(*)::int
    INTO matching_staff_count
    FROM appointment_staff ast
   WHERE ast.appointment_id=758
     AND LOWER(TRIM(ast.staff_name_snapshot))='christel';

  IF matching_staff_count <> 1 THEN
    RAISE EXCEPTION 'Appointment #758 price repair requires exactly one Christel assignment; found %', matching_staff_count;
  END IF;

  IF EXISTS (SELECT 1 FROM appointment_group_members WHERE appointment_id=758) THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because the appointment is linked to a group';
  END IF;

  SELECT COUNT(*)::int
    INTO payment_account_count
    FROM booking_payment_accounts bpa
   WHERE bpa.appointment_id=758;

  IF payment_account_count <> 0 THEN
    RAISE EXCEPTION 'Appointment #758 price repair refused because a payment account already exists';
  END IF;

  UPDATE appointments
     SET total_price=250,
         updated_at=NOW()
   WHERE id=758;

  UPDATE appointment_services
     SET price_snapshot=250
   WHERE appointment_id=758;

  INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
  VALUES(
    'appointment.price_corrected',
    'appointment',
    '758',
    jsonb_build_object(
      'reason','owner_authorized_toe_gel_price_correction',
      'newPrice','250.00',
      'currency','ZAR',
      'bookingPolicyVersion','2026-09-23-v2',
      'depositFlowRepair',TRUE
    )
  );
END $$;

COMMENT ON TABLE clinic_booking_deposit_policy IS
  'Technical deposit-enforcement mirror of the single Shiloh Booking Policy & Terms. Current version: 2026-09-23-v2.';
