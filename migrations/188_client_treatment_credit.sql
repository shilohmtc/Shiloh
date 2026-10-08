-- Owner approved new tables and manual correction policy on 8 October 2026.
-- Release still requires recovery, exact principal/grant approval and final review.
-- No grants, backfill or existing client mutation.
-- Noncash treatment credit is independent of Rewards and cash receipt evidence.
CREATE TABLE treatment_credit_wallets (
  id BIGSERIAL PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL UNIQUE REFERENCES crm_v2_clients(id) ON DELETE RESTRICT
);
CREATE TABLE treatment_credit_entries (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES treatment_credit_wallets(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('issue','apply','reduce','undo')),
  credit_type TEXT CHECK (credit_type IN ('goodwill','service_exchange')),
  signed_amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 240),
  reference TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  operation_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  booking_payment_account_id BIGINT REFERENCES booking_payment_accounts(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE RESTRICT,
  source_entry_id BIGINT REFERENCES treatment_credit_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((entry_type='issue' AND signed_amount>0 AND credit_type IS NOT NULL
           AND booking_payment_account_id IS NULL AND appointment_id IS NULL AND source_entry_id IS NULL
           AND (credit_type<>'service_exchange' OR length(reference)>0))
      OR (entry_type='apply' AND signed_amount<0 AND credit_type IS NULL
           AND booking_payment_account_id IS NOT NULL AND appointment_id IS NOT NULL AND source_entry_id IS NULL)
      OR (entry_type='reduce' AND signed_amount<0 AND credit_type IS NULL AND source_entry_id IS NOT NULL
           AND booking_payment_account_id IS NULL AND appointment_id IS NULL)
      OR (entry_type='undo' AND signed_amount>0 AND credit_type IS NULL AND source_entry_id IS NOT NULL
           AND booking_payment_account_id IS NOT NULL AND appointment_id IS NOT NULL))
);
CREATE INDEX treatment_credit_entries_wallet ON treatment_credit_entries(wallet_id,id);
CREATE INDEX treatment_credit_entries_booking ON treatment_credit_entries(booking_payment_account_id);
CREATE INDEX treatment_credit_entries_source ON treatment_credit_entries(source_entry_id) WHERE source_entry_id IS NOT NULL;
-- FIFO allocation retains the original goodwill/exchange and invoice evidence.
CREATE TABLE treatment_credit_allocations (
  debit_entry_id BIGINT NOT NULL REFERENCES treatment_credit_entries(id) ON DELETE RESTRICT,
  issue_entry_id BIGINT NOT NULL REFERENCES treatment_credit_entries(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount>0),
  PRIMARY KEY (debit_entry_id,issue_entry_id),
  CHECK (debit_entry_id<>issue_entry_id)
);
CREATE INDEX treatment_credit_allocations_issue ON treatment_credit_allocations(issue_entry_id);
CREATE FUNCTION treatment_credit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Treatment credit evidence is immutable'; END $$;
CREATE TRIGGER treatment_credit_entries_immutable BEFORE UPDATE OR DELETE ON treatment_credit_entries
  FOR EACH ROW EXECUTE FUNCTION treatment_credit_immutable();
CREATE TRIGGER treatment_credit_allocations_immutable BEFORE UPDATE OR DELETE ON treatment_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION treatment_credit_immutable();
-- Reject broken provenance, incomplete debits and overspending at commit.
CREATE FUNCTION treatment_credit_check_position() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_wallet BIGINT;
BEGIN
  IF TG_TABLE_NAME='treatment_credit_entries' THEN target_wallet := NEW.wallet_id;
  ELSE SELECT wallet_id INTO target_wallet FROM treatment_credit_entries WHERE id=NEW.debit_entry_id; END IF;
  PERFORM id FROM treatment_credit_wallets WHERE id=target_wallet FOR UPDATE;
  IF (SELECT COALESCE(SUM(signed_amount),0) FROM treatment_credit_entries WHERE wallet_id=target_wallet)<0
    OR EXISTS (SELECT 1 FROM treatment_credit_entries e
      LEFT JOIN treatment_credit_entries source ON source.id=e.source_entry_id
      WHERE e.wallet_id=target_wallet AND
        ((e.entry_type='reduce' AND (source.entry_type<>'issue' OR source.wallet_id<>e.wallet_id))
         OR (e.entry_type='undo' AND (source.entry_type<>'apply' OR source.wallet_id<>e.wallet_id
           OR source.booking_payment_account_id<>e.booking_payment_account_id OR source.appointment_id<>e.appointment_id))))
    OR EXISTS (SELECT 1 FROM treatment_credit_allocations a
      JOIN treatment_credit_entries d ON d.id=a.debit_entry_id
      JOIN treatment_credit_entries i ON i.id=a.issue_entry_id
      WHERE d.wallet_id=target_wallet AND
        (d.entry_type NOT IN ('apply','reduce','undo') OR i.entry_type<>'issue' OR d.wallet_id<>i.wallet_id
         OR (d.entry_type='reduce' AND d.source_entry_id<>i.id)
         OR (d.entry_type='undo' AND NOT EXISTS (SELECT 1 FROM treatment_credit_allocations original
           WHERE original.debit_entry_id=d.source_entry_id AND original.issue_entry_id=i.id))))
    OR EXISTS (SELECT 1 FROM treatment_credit_entries e WHERE e.wallet_id=target_wallet AND
      ((e.entry_type='issue' AND (COALESCE((SELECT SUM(CASE WHEN d.entry_type='undo' THEN -a.amount ELSE a.amount END)
          FROM treatment_credit_allocations a JOIN treatment_credit_entries d ON d.id=a.debit_entry_id
          WHERE a.issue_entry_id=e.id),0) NOT BETWEEN 0 AND e.signed_amount))
       OR (e.entry_type<>'issue' AND COALESCE((SELECT SUM(a.amount) FROM treatment_credit_allocations a
          WHERE a.debit_entry_id=e.id),0)<>ABS(e.signed_amount))))
    OR EXISTS (SELECT 1 FROM treatment_credit_allocations original
      JOIN treatment_credit_entries application ON application.id=original.debit_entry_id
      WHERE application.wallet_id=target_wallet AND application.entry_type='apply'
        AND COALESCE((SELECT SUM(returned.amount) FROM treatment_credit_allocations returned
          JOIN treatment_credit_entries correction ON correction.id=returned.debit_entry_id
          WHERE correction.entry_type='undo' AND correction.source_entry_id=application.id
            AND returned.issue_entry_id=original.issue_entry_id),0)>original.amount)
  THEN RAISE EXCEPTION 'Invalid treatment credit allocation or balance'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER treatment_credit_entry_position AFTER INSERT ON treatment_credit_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION treatment_credit_check_position();
CREATE CONSTRAINT TRIGGER treatment_credit_allocation_position AFTER INSERT ON treatment_credit_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION treatment_credit_check_position();
COMMENT ON TABLE treatment_credit_entries IS 'Noncash treatment credit. Manual append-only corrections preserve source evidence. No expiry, automatic return, cash receipt, invoice-payment or Rewards semantics. Preserve evidence in forward fixes.';

-- Additive fourth allocation table approved by owner on 8 October 2026, 17:26 UTC.
-- Execution remains held behind recovery, exact account/grant and final verification gates.
-- No existing records, voucher balances, grants or policies are changed by this migration.
CREATE TABLE booking_gift_voucher_allocations (
  id BIGSERIAL PRIMARY KEY,
  voucher_ledger_entry_id BIGINT NOT NULL UNIQUE REFERENCES gift_voucher_ledger_entries(id) ON DELETE RESTRICT,
  booking_payment_account_id BIGINT NOT NULL REFERENCES booking_payment_accounts(id) ON DELETE RESTRICT,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  crm_v2_client_id BIGINT NOT NULL REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  actor_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount>0),
  operation_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX booking_gift_voucher_allocations_account ON booking_gift_voucher_allocations(booking_payment_account_id);
CREATE INDEX booking_gift_voucher_allocations_client ON booking_gift_voucher_allocations(crm_v2_client_id,created_at);
CREATE FUNCTION booking_gift_voucher_allocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Booking gift voucher allocation evidence is immutable'; END $$;
CREATE TRIGGER booking_gift_voucher_allocation_immutable BEFORE UPDATE OR DELETE ON booking_gift_voucher_allocations
  FOR EACH ROW EXECUTE FUNCTION booking_gift_voucher_allocation_immutable();
CREATE FUNCTION booking_gift_voucher_allocation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gift_voucher_ledger_entries e JOIN gift_vouchers v ON v.id=e.voucher_id
      JOIN gift_voucher_orders o ON o.id=v.order_id
      WHERE e.id=NEW.voucher_ledger_entry_id AND e.entry_type='redemption' AND e.amount=NEW.amount
        AND e.actor_admin_id=NEW.actor_admin_id AND v.recipient_crm_v2_client_id=NEW.crm_v2_client_id AND o.state='paid')
  THEN RAISE EXCEPTION 'Invalid booking gift voucher redemption evidence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_gift_voucher_allocation_source BEFORE INSERT ON booking_gift_voucher_allocations
  FOR EACH ROW EXECUTE FUNCTION booking_gift_voucher_allocation_source();
COMMENT ON TABLE booking_gift_voucher_allocations IS 'Immutable noncash booking settlement linked to existing purchased gift voucher redemption. Does not create cash, expiry/transfer policy or automatic cancellation/refund restoration.';
