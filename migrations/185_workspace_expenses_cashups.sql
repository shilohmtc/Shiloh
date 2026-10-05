-- Additive financial records only. No existing clinic facts or grants change.
-- Recovery: leave these unused tables in place; never remove saved evidence.
CREATE TABLE workspace_expenses (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  paid_on DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('rent','utilities','supplies','laundry','equipment','software','marketing','wages','commission','other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  reference TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card_machine','manual_eft')),
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by_admin_id BIGINT REFERENCES staff_admin_accounts(id),
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  CHECK ((voided_at IS NULL AND voided_by_admin_id IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by_admin_id IS NOT NULL AND length(void_reason) BETWEEN 1 AND 200))
);
CREATE INDEX workspace_expenses_paid_on ON workspace_expenses(paid_on,id);

CREATE TABLE workspace_cashup_closes (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL UNIQUE,
  business_date DATE NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source_fingerprint TEXT NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  opening_float NUMERIC(12,2) NOT NULL CHECK (opening_float >= 0),
  cash_added NUMERIC(12,2) NOT NULL CHECK (cash_added >= 0),
  cash_removed NUMERIC(12,2) NOT NULL CHECK (cash_removed >= 0),
  counted_cash NUMERIC(12,2) NOT NULL CHECK (counted_cash >= 0),
  expected_cash NUMERIC(12,2) NOT NULL,
  difference NUMERIC(12,2) NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_by_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_date,revision),
  CHECK (difference = counted_cash - expected_cash)
);
