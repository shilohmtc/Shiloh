-- Remove the offboarded practitioner's Workspace identity and appointment
-- attribution. Keep client bookings and financial entries intact.
-- Apply only through the controlled single-migration release gate.
DO $$
DECLARE
  departed_id BIGINT;
  departed_admin_id BIGINT;
  matching_staff INTEGER;
  matching_accounts INTEGER;
BEGIN
  SELECT COUNT(*), MIN(id) INTO matching_staff, departed_id
    FROM staff
   WHERE LOWER(BTRIM(display_name))='marietjie'
     AND resource_type='practitioner'
     AND status='inactive' AND client_bookable=FALSE;
  IF matching_staff <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one offboarded practitioner; found %', matching_staff;
  END IF;
  SELECT COUNT(*), MIN(id) INTO matching_accounts, departed_admin_id
    FROM staff_admin_accounts WHERE staff_id=departed_id AND active=FALSE;
  IF matching_accounts <> 1 OR EXISTS (
    SELECT 1 FROM staff_admin_accounts WHERE staff_id=departed_id AND active=TRUE
  ) THEN
    RAISE EXCEPTION 'Offboarded Workspace identity count drifted';
  END IF;
  IF EXISTS (SELECT 1 FROM staff_services WHERE staff_id=departed_id)
     OR EXISTS (
       SELECT 1 FROM appointment_staff ast JOIN appointments a ON a.id=ast.appointment_id
        WHERE ast.staff_id=departed_id AND a.starts_at>NOW()
          AND a.status IN ('scheduled','confirmed')
     ) THEN
    RAISE EXCEPTION 'Active services or future bookings still use the departed practitioner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM clinic_booking_deposit_policy WHERE id=1
      AND exempt_staff_id=departed_id AND policy_version='2026-09-27-v4'
  ) THEN
    RAISE EXCEPTION 'Booking deposit policy drifted';
  END IF;

  PERFORM pg_advisory_xact_lock(departed_id);
  PERFORM 1 FROM staff WHERE id=departed_id FOR UPDATE;

  -- The obsolete exception cannot keep a live FK to a deleted staff row.
  ALTER TABLE clinic_booking_deposit_policy ALTER COLUMN exempt_staff_id DROP NOT NULL;
  UPDATE clinic_booking_deposit_policy
     SET exempt_staff_id=NULL, policy_version='2026-09-30-v5', updated_at=NOW()
   WHERE id=1;
  COMMENT ON TABLE clinic_booking_deposit_policy IS
    'Single Shiloh clinic booking-deposit authority. V5: 50%, 48/24-hour cancellation bands; no practitioner exemption.';

  -- A completed booking and its payment account remain, but no longer name
  -- or point to the departed practitioner.
  UPDATE appointment_lifecycle
     SET therapist_text=REGEXP_REPLACE(therapist_text,'marietjie','Former practitioner','gi')
   WHERE therapist_text ~* 'marietjie';
  UPDATE appointment_status_history
     SET changed_by=REGEXP_REPLACE(changed_by,'marietjie','former practitioner','gi'),
         reason=REGEXP_REPLACE(reason,'marietjie','former practitioner','gi')
   WHERE appointment_id IN (SELECT appointment_id FROM appointment_staff WHERE staff_id=departed_id)
     AND (changed_by ~* 'marietjie' OR reason ~* 'marietjie');
  UPDATE appointment_status_history
     SET changed_by=REGEXP_REPLACE(changed_by,'marietjie','former practitioner','gi'),
         reason=REGEXP_REPLACE(reason,'marietjie','former practitioner','gi')
   WHERE changed_by IN ('admin:' || departed_admin_id || ':Marietjie',
                        'system:marietjie_tenant_offboarding');
  UPDATE appointment_staff
     SET staff_id=NULL, staff_name_snapshot='Former practitioner'
   WHERE staff_id=departed_id;

  IF EXISTS (SELECT 1 FROM appointment_booking_approvals
              WHERE status IN ('pending','awaiting_client_confirmation')
                AND (requested_staff_id=departed_id OR proposed_staff_id=departed_id
                  OR departed_id=ANY(requested_staff_ids) OR departed_id=ANY(proposed_staff_ids))) THEN
    RAISE EXCEPTION 'Unresolved booking request still names the departed practitioner';
  END IF;
  UPDATE appointment_booking_approvals
     SET requested_staff_id=NULL, proposed_staff_id=NULL,
         requested_staff_ids=ARRAY(SELECT sid FROM unnest(requested_staff_ids) sid WHERE sid<>departed_id),
         proposed_staff_ids=ARRAY(SELECT sid FROM unnest(proposed_staff_ids) sid WHERE sid<>departed_id)
   WHERE requested_staff_id=departed_id OR proposed_staff_id=departed_id
      OR departed_id=ANY(requested_staff_ids) OR departed_id=ANY(proposed_staff_ids);
  UPDATE client_planning_requests SET practitioner_id=NULL
   WHERE practitioner_id=departed_id;
  DELETE FROM crm_v2_client_relationships
   WHERE relationship_type='tenant_staff' AND owner_staff_id=departed_id;
  DELETE FROM calendar_blocks WHERE staff_id=departed_id;
  DELETE FROM admin_booking_sessions WHERE staff_id=departed_id;
  DELETE FROM staff_leave_requests WHERE staff_id=departed_id OR requested_by_admin_id=departed_admin_id;

  UPDATE booking_intents
     SET therapist_text=REGEXP_REPLACE(therapist_text,'marietjie','Former practitioner','gi')
   WHERE therapist_text ~* 'marietjie';
  UPDATE client_booking_calendar_write_attempts
     SET staff_name='Former practitioner' WHERE staff_name ~* 'marietjie';
  UPDATE external_records
     SET source_payload=JSONB_SET(source_payload,'{Staff}',
           REGEXP_REPLACE((source_payload->'Staff')::text,'marietjie','Former practitioner','gi')::jsonb),
         updated_at=NOW()
   WHERE source='goldie' AND entity_type='appointment'
     AND source_payload->'Staff' IS NOT NULL
     AND (source_payload->'Staff')::text ~* 'marietjie';
  UPDATE external_records
     SET source_payload=JSONB_SET(source_payload,'{Services}',
           REGEXP_REPLACE((source_payload->'Services')::text,'marietjie','Former practitioner','gi')::jsonb),
         updated_at=NOW()
   WHERE source='goldie' AND entity_type='appointment'
     AND source_payload->'Services' IS NOT NULL
     AND (source_payload->'Services')::text ~* 'marietjie';
  UPDATE documents SET content=REGEXP_REPLACE(content,'marietjie','Former practitioner','gi')
   WHERE id=4 AND title='Shiloh Goldie Business Knowledge' AND content ~* 'marietjie';
  UPDATE document_chunks SET content=REGEXP_REPLACE(content,'marietjie','Former practitioner','gi')
   WHERE document_id=4 AND content ~* 'marietjie';
  UPDATE booking_deposit_requirement_members
     SET exemption_reason='retired_practitioner'
   WHERE exemption_reason='marietjie';

  -- The former team may have historical links; neutralize its display name.
  UPDATE staff_operational_teams t
     SET display_name='Retired team',team_key='retired-team-' || t.id,
         active=FALSE,updated_at=NOW()
   WHERE t.id IN (SELECT team_id FROM staff_operational_team_members WHERE staff_id=departed_id);

  UPDATE crm_audit_events
     SET metadata=REGEXP_REPLACE(metadata::text,'marietjie','Former practitioner','gi')::jsonb,
         action=REGEXP_REPLACE(action,'marietjie','former_practitioner','gi')
   WHERE actor_admin_id=departed_admin_id
      OR (entity_type='staff' AND entity_id=departed_id)
      OR (action IN ('admin.appointment_finalized',
                     'mobile_booking.started',
                     'control.retrospective_access_753_provisioned')
          AND metadata::text ~* 'marietjie');
  UPDATE crm_audit_events SET metadata=metadata - 'marietjieExemptStaffId'
   WHERE action='payment.deposit_requirement_created'
     AND metadata ? 'marietjieExemptStaffId';

  -- Deleting the account cascades its passkeys, challenges and sessions.
  -- Existing audit rows retain their event, with their actor FK set NULL.
  DELETE FROM staff_admin_accounts WHERE id=departed_admin_id AND active=FALSE;
  DELETE FROM staff WHERE id=departed_id AND status='inactive';

  IF EXISTS (SELECT 1 FROM staff WHERE id=departed_id)
     OR EXISTS (SELECT 1 FROM staff_admin_accounts WHERE id=departed_admin_id)
     OR EXISTS (SELECT 1 FROM appointment_staff WHERE staff_id=departed_id)
     OR EXISTS (SELECT 1 FROM clinic_booking_deposit_policy WHERE exempt_staff_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Departed practitioner identity deletion incomplete';
  END IF;
END $$;
