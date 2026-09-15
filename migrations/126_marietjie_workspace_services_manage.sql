-- Marietjie owns a tenant-practitioner Workspace boundary. Grant the explicit
-- Workspace Services read/manage capabilities she needs, but do not grant
-- service creation or any broader business/admin authority.
--
-- #903 intentionally aligned Marietjie's Calendar/service scopes to
-- all_business/all_services for business-wide appointment editing. This release
-- preserves those scopes. The Workspace Services runtime independently narrows
-- a tenant practitioner's Services surface to services assigned to linked staff.
--
-- This migration fails closed unless the production identity still matches that
-- expected current contract and the legacy service permissions that already
-- express Marietjie's intended service responsibility.

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
     AND a.calendar_scope = 'all_business'
     AND a.service_scope = 'all_services'
     AND s.status = 'active'
     AND COALESCE((a.permissions ->> 'staff:services:view')::boolean, FALSE) = TRUE
     AND COALESCE((a.permissions ->> 'service:pricing')::boolean, FALSE) = TRUE;

  IF matched_principals <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active Marietjie tenant practitioner with #903 business-wide appointment scope and legacy service authority, found %', matched_principals;
  END IF;

  UPDATE staff_admin_accounts
     SET permissions = COALESCE(permissions, '{}'::jsonb)
                       || '{"services:view":true,"services:manage":true}'::jsonb,
         updated_at = NOW()
   WHERE LOWER(display_name) = 'marietjie'
     AND active = TRUE
     AND business_role = 'tenant_practitioner'
     AND calendar_scope = 'all_business'
     AND service_scope = 'all_services';
END $$;
