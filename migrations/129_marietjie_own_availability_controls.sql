-- Marietjie own availability controls
-- Owner-authorized alignment on 16 September 2026.
--
-- This adds block-time and leave management inside Marietjie's existing
-- own_appointments scope without restoring Clinic Hours or other-staff authority.

DO $$
DECLARE
  principal RECORD;
BEGIN
  IF (SELECT COUNT(*)
        FROM staff_admin_accounts a
        JOIN staff s ON s.id=a.staff_id
       WHERE LOWER(TRIM(a.display_name))='marietjie'
         AND a.active=TRUE
         AND s.status='active') <> 1 THEN
    RAISE EXCEPTION 'Marietjie must resolve to exactly one active staff-linked Workspace principal';
  END IF;

  SELECT a.*, s.business_role AS canonical_staff_business_role,
         s.resource_type AS canonical_resource_type
    INTO STRICT principal
    FROM staff_admin_accounts a
    JOIN staff s ON s.id=a.staff_id
   WHERE LOWER(TRIM(a.display_name))='marietjie'
     AND a.active=TRUE
     AND s.status='active';

  IF principal.business_role <> 'tenant_practitioner'
     OR principal.canonical_staff_business_role <> 'tenant_practitioner'
     OR principal.canonical_resource_type <> 'practitioner'
     OR principal.calendar_scope <> 'own_appointments'
     OR principal.service_scope <> 'own_services' THEN
    RAISE EXCEPTION 'Marietjie own-workspace authority boundary is not canonical';
  END IF;

  IF COALESCE((principal.permissions ->> 'schedule:manage')::boolean, FALSE) = TRUE THEN
    RAISE EXCEPTION 'Marietjie must not have Clinic Hours schedule:manage authority';
  END IF;

  UPDATE staff_admin_accounts
     SET permissions = COALESCE(permissions,'{}'::jsonb)
                       || '{"schedule:availability_manage":true}'::jsonb,
         updated_at=NOW()
   WHERE id=principal.id;

  IF NOT EXISTS (
    SELECT 1
      FROM staff_admin_accounts a
     WHERE a.id=principal.id
       AND a.active=TRUE
       AND a.calendar_scope='own_appointments'
       AND a.service_scope='own_services'
       AND COALESCE((a.permissions ->> 'schedule:availability_manage')::boolean, FALSE)=TRUE
       AND COALESCE((a.permissions ->> 'schedule:manage')::boolean, FALSE)=FALSE
       AND COALESCE((a.permissions ->> 'calendar:booking:reassign')::boolean, FALSE)=FALSE
  ) THEN
    RAISE EXCEPTION 'Marietjie own availability capability alignment failed';
  END IF;
END $$;
