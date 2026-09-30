-- Owner selected Combine both on 30 September 2026 after the live access audit.
-- Preserve identities, roles, sessions, disabled settings and all other accounts.
DO $$
DECLARE
  christel staff_admin_accounts%ROWTYPE;
  jp staff_admin_accounts%ROWTYPE;
  reception staff_admin_accounts%ROWTYPE;
  combined JSONB;
  account staff_admin_accounts%ROWTYPE;
  next_permissions JSONB;
  difference TEXT[];
BEGIN
  SELECT * INTO STRICT christel FROM staff_admin_accounts WHERE id=2 FOR UPDATE;
  SELECT * INTO STRICT jp FROM staff_admin_accounts WHERE id=4 FOR UPDATE;
  IF NOT (christel.active AND christel.business_role='owner' AND christel.role='owner'
      AND LOWER(BTRIM(christel.display_name))='christel'
      AND jp.active AND jp.business_role='business_admin' AND jp.role='admin'
      AND LOWER(BTRIM(jp.display_name))='jean-pierre'
      AND christel.calendar_scope='all_business' AND jp.calendar_scope='all_business'
      AND christel.service_scope='all_services' AND jp.service_scope='all_services') THEN
    RAISE EXCEPTION 'Combined Workspace access principal authority drift';
  END IF;
  SELECT array_agg(key ORDER BY key) INTO difference
    FROM jsonb_each(christel.permissions)
   WHERE value='true'::jsonb AND (jp.permissions->key) IS DISTINCT FROM 'true'::jsonb;
  IF difference IS DISTINCT FROM ARRAY['appointment:couples:discount','appointment:group:discount',
      'loyalty:manage','loyalty:view','payment:refund','voucher:issue','voucher:manage','voucher:redeem','voucher:view'] THEN
    RAISE EXCEPTION 'Christel-only reviewed capability set drift';
  END IF;
  SELECT array_agg(key ORDER BY key) INTO difference
    FROM jsonb_each(jp.permissions)
   WHERE value='true'::jsonb AND (christel.permissions->key) IS DISTINCT FROM 'true'::jsonb;
  IF difference IS DISTINCT FROM ARRAY['problem_reports:manage'] THEN
    RAISE EXCEPTION 'JP-only reviewed capability set drift';
  END IF;
  SELECT * INTO STRICT reception FROM staff_admin_accounts
   WHERE active=TRUE AND LOWER(BTRIM(display_name))='shiloh reception'
     AND business_role='booking_operator' AND service_scope='all_services'
     AND permissions->'services:manage'='true'::jsonb FOR UPDATE;
  SELECT jsonb_object_agg(key,'true'::jsonb) INTO combined FROM (
    SELECT key FROM jsonb_each(christel.permissions) WHERE value='true'::jsonb
    UNION SELECT key FROM jsonb_each(jp.permissions) WHERE value='true'::jsonb
  ) enabled;
  combined := combined || '{"staff_earnings:manage":true,"service_categories:manage":true}'::jsonb;
  FOR account IN SELECT * FROM staff_admin_accounts WHERE id IN (christel.id,jp.id,reception.id) ORDER BY id LOOP
    next_permissions := COALESCE(account.permissions,'{}'::jsonb) ||
      CASE WHEN account.id=reception.id THEN '{"service_categories:manage":true}'::jsonb ELSE combined END;
    INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
    VALUES (christel.id,'workspace.combined_access.approved','staff_admin_account',account.id,
      jsonb_build_object('migration','184_jp_christel_combined_workspace_access.sql',
        'beforePermissions',account.permissions,'afterPermissions',next_permissions,
        'rolesPreserved',true,'identityPreserved',true));
    UPDATE staff_admin_accounts SET permissions=next_permissions,updated_at=NOW() WHERE id=account.id;
  END LOOP;
  IF (SELECT permissions FROM staff_admin_accounts WHERE id=christel.id) IS DISTINCT FROM
     (SELECT permissions FROM staff_admin_accounts WHERE id=jp.id) THEN
    -- Enabled capabilities must match; disabled settings may legitimately differ.
    SELECT array_agg(key ORDER BY key) INTO difference FROM (
      SELECT key FROM jsonb_each((SELECT permissions FROM staff_admin_accounts WHERE id=christel.id)) WHERE value='true'::jsonb
      EXCEPT SELECT key FROM jsonb_each((SELECT permissions FROM staff_admin_accounts WHERE id=jp.id)) WHERE value='true'::jsonb
    ) unmatched;
    IF difference IS NOT NULL THEN RAISE EXCEPTION 'Combined enabled capability parity failed'; END IF;
  END IF;
END $$;
