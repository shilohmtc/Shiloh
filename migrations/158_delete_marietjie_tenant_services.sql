-- Permanently remove retired services belonging only to the former independent
-- tenant. Historical appointment text snapshots and clinic-owned services stay.
-- Apply only through the controlled single-migration release gate.

DO $$
DECLARE
  tenant_id BIGINT;
  tenant_count INTEGER;
  removed_count INTEGER;
  mapping_count INTEGER;
  session_count INTEGER;
  approval_count INTEGER;
  reschedule_count INTEGER;
BEGIN
  SELECT COUNT(*), MIN(st.id) INTO tenant_count, tenant_id
    FROM staff st
    JOIN staff_admin_accounts saa ON saa.staff_id=st.id
   WHERE LOWER(BTRIM(st.display_name))='marietjie'
     AND st.resource_type='practitioner'
     AND st.status='inactive'
     AND st.client_bookable=FALSE
     AND saa.business_role='tenant_practitioner'
     AND saa.active=FALSE;
  IF tenant_count <> 1 THEN
    RAISE EXCEPTION 'Tenant service deletion requires one offboarded Marietjie principal; found %', tenant_count;
  END IF;

  PERFORM pg_advisory_xact_lock(tenant_id);
  PERFORM 1 FROM staff WHERE id=tenant_id FOR UPDATE;

  CREATE TEMP TABLE marietjie_tenant_services_to_delete ON COMMIT DROP AS
  SELECT s.id
    FROM services s
   WHERE (
     EXISTS (SELECT 1 FROM staff_services ss
              WHERE ss.service_id=s.id AND ss.staff_id=tenant_id)
     OR EXISTS (SELECT 1 FROM service_visibility_policies visibility
                 WHERE visibility.service_id=s.id AND visibility.owner_staff_id=tenant_id)
   )
     AND NOT EXISTS (SELECT 1 FROM staff_services other_staff
                     WHERE other_staff.service_id=s.id AND other_staff.staff_id<>tenant_id)
     AND NOT EXISTS (SELECT 1 FROM service_visibility_policies visibility
                     WHERE visibility.service_id=s.id
                       AND visibility.owner_staff_id IS NOT NULL
                       AND visibility.owner_staff_id<>tenant_id);

  SELECT COUNT(*) INTO removed_count FROM marietjie_tenant_services_to_delete;
  IF EXISTS (SELECT 1 FROM services s JOIN marietjie_tenant_services_to_delete target ON target.id=s.id
              WHERE s.status<>'inactive') THEN
    RAISE EXCEPTION 'Active tenant-only service found; no service was deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM appointment_groups ag
              JOIN marietjie_tenant_services_to_delete target ON target.id=ag.service_id)
     OR EXISTS (SELECT 1 FROM service_packages sp
                 JOIN marietjie_tenant_services_to_delete target ON target.id=sp.session_service_id)
  THEN
    RAISE EXCEPTION 'Tenant service belongs to a booking group or package; no service was deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM admin_booking_sessions abs
    JOIN marietjie_tenant_services_to_delete target ON target.id=abs.service_id
    WHERE abs.staff_id<>tenant_id
  ) THEN
    RAISE EXCEPTION 'A clinic booking session uses a tenant-only service; no service was deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM appointment_booking_approvals approval
    WHERE approval.status IN ('pending','awaiting_client_confirmation')
      AND (
        approval.requested_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
        OR approval.proposed_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
        OR EXISTS (SELECT 1 FROM unnest(approval.requested_service_ids) sid
                   JOIN marietjie_tenant_services_to_delete target ON target.id=sid)
      )
  ) OR EXISTS (
    SELECT 1 FROM appointment_reschedule_requests request
    JOIN marietjie_tenant_services_to_delete target ON target.id=request.service_id
    WHERE request.status IN ('pending','notification_failed')
  ) THEN
    RAISE EXCEPTION 'An unresolved booking request uses a tenant-only service; no service was deleted';
  END IF;

  -- Ephemeral tenant draft sessions and future form routing have no historical
  -- appointment evidence. Their service references must be removed first.
  DELETE FROM admin_booking_sessions session
   USING marietjie_tenant_services_to_delete target
   WHERE session.service_id=target.id AND session.staff_id=tenant_id;
  GET DIAGNOSTICS session_count = ROW_COUNT;
  DELETE FROM consultation_form_service_mappings mapping
   USING marietjie_tenant_services_to_delete target
   WHERE mapping.service_id=target.id;
  GET DIAGNOSTICS mapping_count = ROW_COUNT;

  UPDATE appointment_reschedule_requests request SET service_id=NULL, updated_at=NOW()
   WHERE request.service_id IN (SELECT id FROM marietjie_tenant_services_to_delete);
  GET DIAGNOSTICS reschedule_count = ROW_COUNT;
  UPDATE appointment_booking_approvals approval
     SET requested_service_id=CASE
           WHEN requested_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
           THEN NULL ELSE requested_service_id END,
         proposed_service_id=CASE
           WHEN proposed_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
           THEN NULL ELSE proposed_service_id END,
         requested_service_ids=CASE WHEN requested_service_ids IS NULL THEN NULL ELSE
           ARRAY(SELECT sid FROM unnest(requested_service_ids) sid
                  WHERE sid NOT IN (SELECT id FROM marietjie_tenant_services_to_delete)) END,
         updated_at=NOW()
   WHERE requested_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
      OR proposed_service_id IN (SELECT id FROM marietjie_tenant_services_to_delete)
      OR EXISTS (SELECT 1 FROM unnest(requested_service_ids) sid
                 JOIN marietjie_tenant_services_to_delete target ON target.id=sid);
  GET DIAGNOSTICS approval_count = ROW_COUNT;

  -- appointment_services and historical_service_changes set their nullable
  -- service IDs to NULL through their existing FK rules; text snapshots remain.
  DELETE FROM services s
   USING marietjie_tenant_services_to_delete target
   WHERE s.id=target.id;
  IF (SELECT COUNT(*) FROM marietjie_tenant_services_to_delete) <> removed_count THEN
    RAISE EXCEPTION 'Tenant service deletion target changed during transaction';
  END IF;
  IF EXISTS (SELECT 1 FROM services s
             JOIN marietjie_tenant_services_to_delete target ON target.id=s.id) THEN
    RAISE EXCEPTION 'Tenant service deletion incomplete';
  END IF;

  INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
  VALUES ('staff.tenant_services_deleted','staff',tenant_id,
          jsonb_build_object('deletedServices',removed_count,
                             'removedFormMappings',mapping_count,
                             'removedDraftSessions',session_count,
                             'historicalApprovalsUnlinked',approval_count,
                             'historicalReschedulesUnlinked',reschedule_count));
END $$;
