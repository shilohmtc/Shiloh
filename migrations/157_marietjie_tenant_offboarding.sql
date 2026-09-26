-- Retire an independent tenant's live presence without changing ownership
-- or visibility of their historical bookings, clients and payments.
-- Run only through the controlled single-migration release gate.

DO $$
DECLARE
  practitioner_id BIGINT;
  matched_staff INTEGER;
  matched_principals INTEGER;
  future_bookings INTEGER;
  archived_relationships INTEGER;
  hidden_services INTEGER;
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

  SELECT COUNT(DISTINCT a.id) INTO future_bookings
    FROM appointments a
    JOIN appointment_staff ast ON ast.appointment_id=a.id
   WHERE ast.staff_id=practitioner_id
     AND a.starts_at>NOW()
     AND a.status IN ('scheduled','confirmed');
  -- Marietjie handles her remaining future appointments herself. Do not
  -- deactivate her while Shiloh might still send reminders for them.
  IF future_bookings > 0 THEN
    RAISE EXCEPTION 'Marietjie has % future appointments to resolve manually before tenant offboarding; no changes were made', future_bookings;
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
            'futureBookingsForManualReview',future_bookings,
            'appointmentsChanged',0,
            'paymentEntriesChanged',0
          ));
END $$;
