-- Remove the former room tenant's booking dataset after identity offboarding.
-- The owner confirmed these were the tenant's own business records. The
-- pre-release export and the controlled single-migration gate are required.
DO $$
DECLARE
  booking_ids BIGINT[];
  removed_imports INTEGER;
  removed_bookings INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(183);

  SELECT array_agg(id ORDER BY id) INTO booking_ids FROM (
    SELECT DISTINCT a.id
      FROM appointments a
      JOIN appointment_staff ast ON ast.appointment_id=a.id
     WHERE ast.staff_id IS NULL
       AND ast.staff_name_snapshot='Former practitioner'
  ) target;

  PERFORM 1 FROM appointments WHERE id=ANY(booking_ids) FOR UPDATE;
  PERFORM 1 FROM appointment_staff WHERE appointment_id=ANY(booking_ids) FOR UPDATE;

  IF COALESCE(array_length(booking_ids,1),0) <> 139
     OR (SELECT COUNT(*) FROM appointment_staff WHERE appointment_id=ANY(booking_ids)
           AND staff_name_snapshot='Former practitioner') <> 148
     OR EXISTS (SELECT 1 FROM appointment_staff WHERE appointment_id=ANY(booking_ids)
                  AND (staff_id IS NOT NULL OR staff_name_snapshot IS DISTINCT FROM 'Former practitioner'))
     OR (SELECT COUNT(*) FROM appointments WHERE id=ANY(booking_ids) AND status='cancelled') <> 130
     OR (SELECT COUNT(*) FROM appointments WHERE id=ANY(booking_ids) AND status='completed') <> 7
     OR (SELECT COUNT(*) FROM appointments WHERE id=ANY(booking_ids) AND status='scheduled') <> 2
     OR EXISTS (SELECT 1 FROM appointments WHERE id=ANY(booking_ids)
                  AND starts_at>NOW() AND status<>'cancelled') THEN
    RAISE EXCEPTION 'Former tenant booking cohort drifted; deletion stopped';
  END IF;

  IF EXISTS (SELECT 1 FROM booking_payment_accounts WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM booking_deposit_requirement_members WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM booking_deposit_policy_events WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM payment_requests WHERE deposit_member_appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM consultation_form_assignments WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM loyalty_wallet_entries WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM loyalty_redemptions WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM client_action_proposals WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM client_planning_requests WHERE linked_appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM appointment_group_members WHERE appointment_id=ANY(booking_ids))
     OR EXISTS (SELECT 1 FROM package_session_redemptions WHERE appointment_id=ANY(booking_ids)) THEN
    RAISE EXCEPTION 'Shared client, payment or protected booking link found; deletion stopped';
  END IF;

  -- These five visits belong to the retired, unserved legacy loyalty table.
  -- Current Shiloh Rewards wallet entries are explicitly excluded above.
  IF (SELECT COUNT(*) FROM loyalty_visits WHERE appointment_id=ANY(booking_ids)) <> 5
     OR (SELECT COUNT(*) FROM external_records WHERE source='goldie'
           AND entity_type='appointment' AND shiloh_entity_type='appointment'
           AND shiloh_entity_id=ANY(booking_ids)) <> 118 THEN
    RAISE EXCEPTION 'Legacy visit or imported booking evidence drifted; deletion stopped';
  END IF;

  DELETE FROM external_records
   WHERE source='goldie' AND entity_type='appointment'
     AND shiloh_entity_type='appointment' AND shiloh_entity_id=ANY(booking_ids);
  GET DIAGNOSTICS removed_imports = ROW_COUNT;
  DELETE FROM appointments WHERE id=ANY(booking_ids);
  GET DIAGNOSTICS removed_bookings = ROW_COUNT;

  IF removed_imports<>118 OR removed_bookings<>139
     OR EXISTS (SELECT 1 FROM appointment_staff WHERE staff_name_snapshot='Former practitioner')
     OR EXISTS (SELECT 1 FROM external_records WHERE source='goldie'
           AND entity_type='appointment' AND shiloh_entity_type='appointment'
           AND shiloh_entity_id=ANY(booking_ids)) THEN
    RAISE EXCEPTION 'Former tenant booking deletion incomplete';
  END IF;
END $$;
