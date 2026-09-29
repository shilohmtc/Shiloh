-- Owner-only, dated commission rules for Workspace Reports. Existing rules are
-- seeded from the established earnings reports; no past appointment is edited.
CREATE TABLE workspace_commission_rules (
  id BIGSERIAL PRIMARY KEY,
  staff_id BIGINT NOT NULL REFERENCES staff(id),
  service_id BIGINT REFERENCES services(id),
  effective_from DATE NOT NULL,
  rate_percent NUMERIC(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, service_id, effective_from)
);
CREATE UNIQUE INDEX workspace_commission_rules_default_date
  ON workspace_commission_rules(staff_id, effective_from) WHERE service_id IS NULL;

DO $$
DECLARE owner_id BIGINT;
BEGIN
  SELECT id INTO STRICT owner_id FROM staff_admin_accounts
   WHERE active=TRUE AND business_role='owner' AND LOWER(BTRIM(display_name))='christel';
  INSERT INTO workspace_commission_rules(staff_id, service_id, effective_from, rate_percent, created_by_admin_id)
  SELECT s.id, NULL, DATE '1970-01-01',
         CASE LOWER(BTRIM(s.display_name)) WHEN 'abigail' THEN 20 ELSE 100 END,
         owner_id
    FROM staff s
   WHERE LOWER(BTRIM(s.display_name)) IN ('christel','abigail','marietjie')
     AND s.status='active';
END $$;
