-- Private Workspace reporting for the R100 My Shiloh welcome-voucher campaign.
-- Access is intentionally granted to exactly the current canonical Christel
-- owner and Jean-Pierre business-admin principals. Ordinary practitioners and
-- shared reception do not inherit this campaign authority.

DO $$
DECLARE
  christel_count INTEGER;
  jp_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO christel_count
    FROM staff_admin_accounts
   WHERE active=TRUE
     AND LOWER(BTRIM(display_name))='christel'
     AND business_role='owner';

  IF christel_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active canonical Christel owner; found %', christel_count;
  END IF;

  SELECT COUNT(*) INTO jp_count
    FROM staff_admin_accounts
   WHERE active=TRUE
     AND LOWER(BTRIM(display_name)) IN ('jean-pierre','jean pierre','jp')
     AND business_role='business_admin';

  IF jp_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active canonical Jean-Pierre business_admin; found %', jp_count;
  END IF;

  UPDATE staff_admin_accounts
     SET permissions=COALESCE(permissions,'{}'::jsonb)-'welcome_vouchers:view_campaign',
         updated_at=NOW()
   WHERE permissions ? 'welcome_vouchers:view_campaign';

  UPDATE staff_admin_accounts
     SET permissions=COALESCE(permissions,'{}'::jsonb)
                     || '{"welcome_vouchers:view_campaign":true}'::jsonb,
         updated_at=NOW()
   WHERE active=TRUE
     AND (
       (LOWER(BTRIM(display_name))='christel' AND business_role='owner')
       OR
       (LOWER(BTRIM(display_name)) IN ('jean-pierre','jean pierre','jp') AND business_role='business_admin')
     );

  IF (SELECT COUNT(*) FROM staff_admin_accounts
       WHERE active=TRUE
         AND permissions->>'welcome_vouchers:view_campaign'='true') <> 2 THEN
    RAISE EXCEPTION 'Welcome-voucher campaign reporting must resolve to exactly Christel and Jean-Pierre';
  END IF;
END $$;

