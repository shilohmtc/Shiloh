-- Persist the exact pricing decision for each linked Couples booking. Existing
-- groups remain valid; every new #985 group writes the complete canonical
-- subtotal, discretionary adjustment, final total and authorizing principal.

ALTER TABLE appointment_groups
  ADD COLUMN IF NOT EXISTS canonical_subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_type TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_reason TEXT,
  ADD COLUMN IF NOT EXISTS final_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discounted_by_admin_id BIGINT
    REFERENCES staff_admin_accounts(id) ON DELETE SET NULL;

ALTER TABLE appointment_groups
  ADD CONSTRAINT appointment_groups_canonical_subtotal_nonnegative
    CHECK (canonical_subtotal IS NULL OR canonical_subtotal >= 0),
  ADD CONSTRAINT appointment_groups_discount_type_valid
    CHECK (discount_type IS NULL OR discount_type IN ('amount','percent')),
  ADD CONSTRAINT appointment_groups_discount_value_positive
    CHECK (discount_value IS NULL OR discount_value > 0),
  ADD CONSTRAINT appointment_groups_discount_amount_nonnegative
    CHECK (discount_amount IS NULL OR discount_amount >= 0),
  ADD CONSTRAINT appointment_groups_final_total_nonnegative
    CHECK (final_total IS NULL OR final_total >= 0),
  ADD CONSTRAINT appointment_groups_discount_reason_length
    CHECK (discount_reason IS NULL OR (BTRIM(discount_reason) <> '' AND CHAR_LENGTH(discount_reason) <= 160)),
  ADD CONSTRAINT appointment_groups_pricing_arithmetic
    CHECK (
      canonical_subtotal IS NULL
      OR (
        discount_amount IS NOT NULL
        AND final_total IS NOT NULL
        AND canonical_subtotal = discount_amount + final_total
        AND final_total = total_price
      )
    ),
  ADD CONSTRAINT appointment_groups_discount_audit_complete
    CHECK (
      canonical_subtotal IS NULL
      OR (
        (discount_type IS NULL
          AND discount_value IS NULL
          AND discount_amount = 0
          AND discount_reason IS NULL
          AND discounted_by_admin_id IS NULL)
        OR
        (discount_type IN ('amount','percent')
          AND discount_value > 0
          AND discount_amount > 0
          AND discount_reason IS NOT NULL
          AND discounted_by_admin_id IS NOT NULL)
      )
    );

COMMENT ON COLUMN appointment_groups.canonical_subtotal IS
  'Sum of the two canonical treatment prices revalidated at atomic confirmation.';
COMMENT ON COLUMN appointment_groups.discounted_by_admin_id IS
  'Canonical staff-admin principal whose service:pricing capability authorized the discretionary discount.';
