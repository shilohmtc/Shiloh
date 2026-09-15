-- Marietjie owns a tenant-practitioner Workspace boundary. Grant the explicit
-- Workspace Services read/manage capabilities she needs, but do not grant
-- service creation or any broader business/admin authority.
--
-- This migration fails closed unless the production identity still matches the
-- expected active tenant-practitioner + own-services contract and the legacy
-- service permissions that already express her intended responsibility.

DO $$
DECLARE
  matched_principals integer;
BEGIN
  SELECT COUNT(*)
    INTO matched_principals
    FROM staff_admin_accounts a
    JOIN staff s ON s.id = a.staff_id
   WHERE LOWER(a.display_name) = 'marietjie'
     AND a.active = TRUE
     AND a.business_role = 'tenant_practitioner'
     AND a.service_scope = 'own_services'
     AND s.status = 'active'
     AND COALESCE((a.permissions ->> 'staff:services:view')::boolean, FALSE) = TRUE
     AND COALESCE((a.permissions ->> 'service:pricing')::boolean, FALSE) = TRUE;

  IF matched_principals <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active Marietjie tenant practitioner with own-services legacy authority, found %', matched_principals;
  END IF;

  UPDATE staff_admin_accounts
     SET permissions = COALESCE(permissions, '{}'::jsonb)
                       || '{"services:view":true,"services:manage":true}'::jsonb,
         updated_at = NOW()
   WHERE LOWER(display_name) = 'marietjie'
     AND active = TRUE
     AND business_role = 'tenant_practitioner'
     AND service_scope = 'own_services';
END $$;
