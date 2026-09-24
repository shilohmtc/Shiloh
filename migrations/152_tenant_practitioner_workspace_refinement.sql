-- SH-04 tenant-practitioner workspace refinement
-- Owner-approved 24 September 2026.
--
-- Tenant-practitioner workspaces keep appointment, client, service/pricing and
-- availability authority, but do not carry Shiloh clinical/forms capabilities.

DO $$
DECLARE
  matched_principals integer;
BEGIN
  SELECT COUNT(*)
    INTO matched_principals
    FROM staff_admin_accounts a
    JOIN staff s ON s.id=a.staff_id
   WHERE a.active=TRUE
     AND s.status='active'
     AND a.business_role='tenant_practitioner'
     AND s.business_role='tenant_practitioner'
     AND s.resource_type='practitioner'
     AND a.calendar_scope='own_appointments'
     AND a.service_scope='own_services';

  IF matched_principals <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active tenant-practitioner Own workspace, found %', matched_principals;
  END IF;

  UPDATE staff_admin_accounts
     SET permissions = COALESCE(permissions,'{}'::jsonb) - 'forms:view' - 'forms:clinical_manage',
         updated_at=NOW()
   WHERE active=TRUE
     AND business_role='tenant_practitioner'
     AND calendar_scope='own_appointments'
     AND service_scope='own_services';

  IF EXISTS (
    SELECT 1
      FROM staff_admin_accounts a
      JOIN staff s ON s.id=a.staff_id
     WHERE a.active=TRUE
       AND s.status='active'
       AND a.business_role='tenant_practitioner'
       AND (
         COALESCE((a.permissions ->> 'appointment:create')::boolean,FALSE) IS NOT TRUE
         OR COALESCE((a.permissions ->> 'client:manage')::boolean,FALSE) IS NOT TRUE
         OR COALESCE((a.permissions ->> 'services:manage')::boolean,FALSE) IS NOT TRUE
         OR COALESCE((a.permissions ->> 'service:pricing')::boolean,FALSE) IS NOT TRUE
         OR COALESCE((a.permissions ->> 'schedule:availability_manage')::boolean,FALSE) IS NOT TRUE
         OR COALESCE((a.permissions ->> 'forms:view')::boolean,FALSE) IS TRUE
         OR COALESCE((a.permissions ->> 'forms:clinical_manage')::boolean,FALSE) IS TRUE
       )
  ) THEN
    RAISE EXCEPTION 'tenant-practitioner workspace refinement failed';
  END IF;
END $$;
