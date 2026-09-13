-- #928 Practitioner Workspace Scope V1
-- Business-wide read, practitioner-scoped work.
--
-- This migration changes capability data only. It intentionally does not change
-- Calendar/service scopes established by #900/#903/#905/#909. Runtime services
-- independently constrain practitioner work to the linked canonical staff ID.

DO $$
BEGIN
  UPDATE staff_admin_accounts a
     SET permissions = (
           COALESCE(a.permissions, '{}'::jsonb)
           || jsonb_build_object(
                'appointment:view', TRUE,
                'booking:update', TRUE,
                'client:lookup', TRUE,
                'client:manage', TRUE,
                'services:view', TRUE,
                'services:manage', TRUE
              )
         ) - 'client:delete',
         updated_at = NOW()
    FROM staff s
   WHERE s.id = a.staff_id
     AND a.active = TRUE
     AND s.status = 'active'
     AND s.resource_type = 'practitioner'
     AND a.business_role IN ('tenant_practitioner', 'employee_practitioner');

  -- The existing canonical creation model has explicit private ownership for a
  -- tenant practitioner. Do not invent employee-practitioner ownership semantics.
  UPDATE staff_admin_accounts a
     SET permissions = COALESCE(a.permissions, '{}'::jsonb)
                       || '{"services:create":true}'::jsonb,
         updated_at = NOW()
    FROM staff s
   WHERE s.id = a.staff_id
     AND a.active = TRUE
     AND s.status = 'active'
     AND s.resource_type = 'practitioner'
     AND a.business_role = 'tenant_practitioner';

  IF EXISTS (
    SELECT 1
      FROM staff_admin_accounts a
      JOIN staff s ON s.id=a.staff_id
     WHERE a.active=TRUE
       AND s.status='active'
       AND s.resource_type='practitioner'
       AND a.business_role IN ('tenant_practitioner','employee_practitioner')
       AND (
         COALESCE(a.permissions,'{}'::jsonb)->>'appointment:view' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb)->>'booking:update' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb)->>'client:lookup' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb)->>'client:manage' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb)->>'services:view' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb)->>'services:manage' IS DISTINCT FROM 'true'
         OR COALESCE(a.permissions,'{}'::jsonb) ? 'client:delete'
       )
  ) THEN
    RAISE EXCEPTION 'Practitioner Workspace Scope V1 capability reconciliation failed';
  END IF;
END $$;
