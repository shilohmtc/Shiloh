-- Retire an independent tenant's live presence without changing ownership
-- or visibility of their historical bookings, clients and payments.
-- Run only through the controlled single-migration release gate.

DO $$
DECLARE
  practitioner_id BIGINT;
  matched_staff INTEGER;
  matched_principals INTEGER;
  future_bookings INTEGER;
  cancelled_bookings INTEGER := 0;
  archived_relationships INTEGER;
  hidden_services INTEGER;
  future_appointment RECORD;
BEGIN
  SELECT COUNT(*), MIN(id)
    INTO matched_staff, practitioner_id
    FROM staff
   WHERE LOWER(TRIM(display_name))='marietjie'
     AND resource_type='practitioner'
     AND status='active';

  IF matched_staff <> 1 THEN
    RAISE EXCEPTION 'Marietjie tenant offboarding requires exactly one active practitioner; found %', matched_staff;
  END IF;

  SELECT COUNT(*) INTO matched_principals
    FROM staff_admin_accounts
   WHERE staff_id=practitioner_id
     AND business_role='tenant_practitioner'
     AND active=TRUE;

  IF matched_principals <> 1 THEN
    RAISE EXCEPTION 'Marietjie tenant offboarding requires exactly one active tenant Workspace principal; found %', matched_principals;
  END IF;

  -- The deposit-policy exemption still refers to this historical staff ID.
  -- It remains a valid reference even though the staff member is inactive.
  IF NOT EXISTS (
    SELECT 1 FROM clinic_booking_deposit_policy
     WHERE id=1 AND exempt_staff_id=practitioner_id
  ) THEN
    RAISE EXCEPTION 'Marietjie deposit policy reference drifted; tenant offboarding refused';
  END IF;

  PERFORM pg_advisory_xact_lock(practitioner_id);
  PERFORM 1 FROM staff WHERE id=practitioner_id FOR UPDATE;

  SELECT COUNT(DISTINCT a.id) INTO future_bookings
    FROM appointments a
    JOIN appointment_staff ast ON ast.appointment_id=a.id
   WHERE ast.staff_id=practitioner_id
     AND a.starts_at>NOW()
     AND a.status IN ('scheduled','confirmed');
  -- Reject shared or payment-linked appointments rather than silently
  -- cancelling another practitioner's booking or a Shiloh payment account.
  IF EXISTS (
    SELECT 1 FROM appointments a
    JOIN appointment_staff ast ON ast.appointment_id=a.id
   WHERE ast.staff_id=practitioner_id
     AND a.starts_at>NOW()
     AND a.status IN ('scheduled','confirmed')
     AND (
       EXISTS (SELECT 1 FROM appointment_staff other_staff
                WHERE other_staff.appointment_id=a.id
                  AND other_staff.staff_id IS DISTINCT FROM practitioner_id)
       OR EXISTS (SELECT 1 FROM appointment_group_members gm
                   WHERE gm.appointment_id=a.id)
       OR EXISTS (SELECT 1 FROM booking_payment_accounts pa
                   WHERE pa.appointment_id=a.id)
       OR EXISTS (SELECT 1 FROM booking_deposit_requirement_members dm
                   WHERE dm.appointment_id=a.id)
       OR EXISTS (SELECT 1 FROM package_session_redemptions pr
                   WHERE pr.appointment_id=a.id AND pr.status='reserved')
       OR EXISTS (SELECT 1 FROM loyalty_redemptions lr
                   WHERE lr.appointment_id=a.id AND lr.status IN ('pending','committed'))
       OR EXISTS (SELECT 1 FROM loyalty_wallet_entries we
                   WHERE we.appointment_id=a.id)
     )
  ) THEN
    RAISE EXCEPTION 'Marietjie tenant offboarding found a shared or payment-linked future booking; no changes were made';
  END IF;

  -- These tenant-only entries leave Shiloh's active calendar. Marietjie will
  -- handle client arrangements herself. Historical snapshots remain intact.
  FOR future_appointment IN
    SELECT a.id,a.status FROM appointments a
     WHERE a.starts_at>NOW()
       AND a.status IN ('scheduled','confirmed')
       AND EXISTS (SELECT 1 FROM appointment_staff ast
                    WHERE ast.appointment_id=a.id
                      AND ast.staff_id=practitioner_id)
     ORDER BY a.id FOR UPDATE OF a
  LOOP
    UPDATE appointments SET status='cancelled',updated_at=NOW()
     WHERE id=future_appointment.id;
    UPDATE appointment_lifecycle SET status='cancelled',updated_at=NOW()
     WHERE appointment_id=future_appointment.id AND status<>'cancelled';
    INSERT INTO appointment_status_history
      (appointment_id,from_status,to_status,changed_by,reason)
    VALUES (future_appointment.id,future_appointment.status,'cancelled',
            'system:marietjie_tenant_offboarding',
            'Independent tenant will arrange this appointment manually');
    INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
    VALUES ('staff.tenant_future_booking_removed','appointment',future_appointment.id,
            jsonb_build_object('priorStatus',future_appointment.status,
                               'tenantStaffId',practitioner_id,
                               'clientContactHandledByTenant',TRUE,
                               'paymentAccountsChanged',0));
    cancelled_bookings := cancelled_bookings + 1;
  END LOOP;

  IF cancelled_bookings <> future_bookings THEN
    RAISE EXCEPTION 'Marietjie future booking count changed during offboarding; no changes were made';
  END IF;

  UPDATE appointment_booking_approvals
     SET status='declined',decided_at=COALESCE(decided_at,NOW()),
         decision_note='Independent tenant will handle appointment manually',
         updated_at=NOW()
   WHERE status IN ('pending','awaiting_client_confirmation')
     AND appointment_id IN (
       SELECT a.id FROM appointments a
       JOIN appointment_staff ast ON ast.appointment_id=a.id
        WHERE ast.staff_id=practitioner_id
          AND a.starts_at>NOW() AND a.status='cancelled'
     );
  UPDATE appointment_reschedule_requests
     SET status='superseded',decided_at=COALESCE(decided_at,NOW()),
         decision_note='Independent tenant will handle appointment manually',
         updated_at=NOW()
   WHERE status IN ('pending','notification_failed')
     AND appointment_id IN (
       SELECT a.id FROM appointments a
       JOIN appointment_staff ast ON ast.appointment_id=a.id
        WHERE ast.staff_id=practitioner_id
          AND a.starts_at>NOW() AND a.status='cancelled'
     );

  -- Prevent an already queued booking-change message from following a
  -- cancelled tenant appointment. No new client message is queued here.
  IF to_regclass('public.customer_change_notifications') IS NOT NULL THEN
    UPDATE customer_change_notifications
       SET status='suppressed',
           suppression_reason='independent_tenant_manual_handoff',
           suppressed_at=COALESCE(suppressed_at,NOW()),updated_at=NOW()
     WHERE appointment_id IN (
       SELECT a.id FROM appointments a
       JOIN appointment_staff ast ON ast.appointment_id=a.id
        WHERE ast.staff_id=practitioner_id
          AND a.starts_at>NOW()
          AND a.status='cancelled'
     ) AND status IN ('pending','failed');
  END IF;

  UPDATE crm_v2_client_relationships
     SET status='archived',updated_at=NOW()
   WHERE relationship_type='tenant_staff'
     AND owner_staff_id=practitioner_id
     AND status='active';
  GET DIAGNOSTICS archived_relationships = ROW_COUNT;

  -- Services exclusively assigned to the departing practitioner should no
  -- longer be advertised. Shared services remain available with active staff.
  UPDATE services s
     SET status='inactive',updated_at=NOW()
   WHERE s.status='active'
     AND EXISTS (SELECT 1 FROM staff_services ss
                  WHERE ss.service_id=s.id AND ss.staff_id=practitioner_id)
     AND NOT EXISTS (
       SELECT 1 FROM staff_services ss
       JOIN staff st ON st.id=ss.staff_id
        WHERE ss.service_id=s.id
          AND ss.staff_id<>practitioner_id
          AND st.status='active'
          AND st.resource_type='practitioner'
     );
  GET DIAGNOSTICS hidden_services = ROW_COUNT;

  UPDATE staff_admin_accounts
     SET active=FALSE,updated_at=NOW()
   WHERE staff_id=practitioner_id AND active=TRUE;

  UPDATE staff
     SET status='inactive',client_bookable=FALSE,updated_at=NOW()
   WHERE id=practitioner_id;

  INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
  VALUES ('staff.marietjie_tenant_offboarding','staff',practitioner_id,
          jsonb_build_object(
            'archivedTenantRelationships',archived_relationships,
            'hiddenExclusiveServices',hidden_services,
            'futureBookingsFound',future_bookings,
            'futureBookingsRemovedFromCalendar',cancelled_bookings,
            'paymentEntriesChanged',0
          ));
END $$;
