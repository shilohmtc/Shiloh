-- Additive, initially empty shared targets. No backfill or grants.
-- Recovery: retain this table and its immutable revisions; use a forward fix.
-- Rolling back application behavior must retain this migration file/ledger entry.
CREATE TABLE workspace_business_target_revisions (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  scope_key TEXT NOT NULL DEFAULT 'whole_clinic' CHECK (scope_key='whole_clinic'),
  metric TEXT NOT NULL CHECK (metric IN ('net_receipts','completed_visits')),
  period_start DATE NOT NULL CHECK (period_start >= DATE '2000-01-01' AND period_start < DATE '2100-01-01' AND EXTRACT(DAY FROM period_start)=1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  action TEXT NOT NULL CHECK (action IN ('set','clear')),
  target_value BIGINT,
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope_key,metric,period_start,revision),
  CHECK ((action='clear' AND target_value IS NULL) OR
    (action='set' AND target_value IS NOT NULL AND target_value >= 0 AND
      ((metric='net_receipts' AND target_value <= 999999999999) OR
       (metric='completed_visits' AND target_value <= 999999999))))
);
