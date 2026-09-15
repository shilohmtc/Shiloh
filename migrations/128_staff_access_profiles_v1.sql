-- Staff access profiles V1
-- Owner-authorized alignment on 15 September 2026.
--
-- Runtime authorization remains capability/scope driven. This controlled data
-- migration aligns the four known staff workspaces with the friendly profiles
-- selected by the owner and deliberately revokes the older broad Marietjie
-- business-edit authority.

DO $$
DECLARE
  person_name TEXT;
  principal RECORD;
  clinic_team_permissions JSONB := '{
    "appointment:view": true,
    "booking:update": true,
    "client:lookup": true,
    "services:view": true,
    "staff:services:view": true,
    "staff:view": true,
    "reports:view_all": true,
    "schedule:view": true
  }'::jsonb;
  own_workspace_permissions JSONB := '{
    "appointment:view": true,
    "appointment:create": true,
    "appointment:adjust_end": true,
    "booking:update": true,
    "calendar:booking:reschedule": true,
    "calendar:booking:cancel": true,
    "client:lookup": true,
    "client:manage": true,
    "services:view": true,
    "services:manage": true,
    "staff:services:view": true,
    "service:pricing": true,
    "schedule:view": true
  }'::jsonb;
BEGIN
  -- Clinic team: full Workspace viewing, own-visit completion only.
  FOREACH person_name IN ARRAY ARRAY['Naomi','ILince','Abigail'] LOOP
    IF (SELECT COUNT(*) FROM staff_admin_accounts a
        JOIN staff s ON s.id=a.staff_id
        WHERE LOWER(TRIM(a.display_name))=LOWER(person_name)
          AND a.active=TRUE AND s.status='active') <> 1 THEN
      RAISE EXCEPTION '% must resolve to exactly one active staff-linked Workspace principal', person_name;
    END IF;

    SELECT a.*, s.business_role AS canonical_staff_business_role, s.resource_type AS canonical_resource_type
      INTO STRICT principal
      FROM staff_admin_accounts a
      JOIN staff s ON s.id=a.staff_id
     WHERE LOWER(TRIM(a.display_name))=LOWER(person_name)
       AND a.active=TRUE AND s.status='active';

    IF principal.business_role <> 'employee_practitioner'
       OR principal.canonical_staff_business_role <> 'employee_practitioner'
       OR principal.canonical_resource_type <> 'practitioner' THEN
      RAISE EXCEPTION '% is not the expected employee-practitioner Workspace principal', person_name;
    END IF;

    UPDATE staff_admin_accounts
       SET role='practitioner',
           calendar_scope='own_appointments',
           service_scope='own_services',
           permissions=clinic_team_permissions,
           updated_at=NOW()
     WHERE id=principal.id;
  END LOOP;

  -- Own workspace: Marietjie manages her own appointments, clients and assigned
  -- services, but cannot alter Clinic Hours or another practitioner's work.
  IF (SELECT COUNT(*) FROM staff_admin_accounts a
      JOIN staff s ON s.id=a.staff_id
      WHERE LOWER(TRIM(a.display_name))='marietjie'
        AND a.active=TRUE AND s.status='active') <> 1 THEN
    RAISE EXCEPTION 'Marietjie must resolve to exactly one active staff-linked Workspace principal';
  END IF;

  SELECT a.*, s.business_role AS canonical_staff_business_role, s.resource_type AS canonical_resource_type
    INTO STRICT principal
    FROM staff_admin_accounts a
    JOIN staff s ON s.id=a.staff_id
   WHERE LOWER(TRIM(a.display_name))='marietjie'
     AND a.active=TRUE AND s.status='active';

  IF principal.business_role <> 'tenant_practitioner'
     OR principal.canonical_staff_business_role <> 'tenant_practitioner'
     OR principal.canonical_resource_type <> 'practitioner' THEN
    RAISE EXCEPTION 'Marietjie is not the expected tenant-practitioner Workspace principal';
  END IF;

  UPDATE staff_admin_accounts
     SET role='practitioner',
         calendar_scope='own_appointments',
         service_scope='own_services',
         permissions=own_workspace_permissions,
         updated_at=NOW()
   WHERE id=principal.id;

  -- Explicit release assertions. These are intentionally capability/scope based;
  -- names are used only by this one-time controlled alignment.
  IF EXISTS (
    SELECT 1
      FROM staff_admin_accounts a
     WHERE LOWER(TRIM(a.display_name)) IN ('naomi','ilince','abigail')
       AND a.active=TRUE
       AND (
         a.calendar_scope <> 'own_appointments'
         OR a.service_scope <> 'own_services'
         OR a.permissions <> clinic_team_permissions
       )
  ) THEN
    RAISE EXCEPTION 'Clinic team Staff access profile alignment failed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM staff_admin_accounts a
     WHERE LOWER(TRIM(a.display_name))='marietjie'
       AND a.active=TRUE
       AND (
         a.calendar_scope <> 'own_appointments'
         OR a.service_scope <> 'own_services'
         OR a.permissions <> own_workspace_permissions
         OR a.permissions ? 'schedule:manage'
         OR a.permissions ? 'calendar:booking:reassign'
         OR a.permissions ? 'client:delete'
         OR a.permissions ? 'services:create'
       )
  ) THEN
    RAISE EXCEPTION 'Marietjie Own workspace boundary alignment failed';
  END IF;
END $$;
