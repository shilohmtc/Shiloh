-- Grant the currently signed-in Jean-Pierre business-admin account the narrow
-- payment permissions needed to view balances and create Ozow requests.
-- Refund authority remains owner-only.
UPDATE staff_admin_accounts
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || '{"payment:view":true,"payment:collect":true}'::jsonb,
       updated_at = NOW()
 WHERE active = TRUE
   AND LOWER(TRIM(display_name)) = 'jean-pierre'
   AND business_role = 'business_admin'
   AND calendar_scope = 'all_business'
   AND service_scope = 'all_services';
