-- Review-only until separately authorized. No grants, backfill or client mutation.
-- Noncash treatment credit is independent of Rewards and cash receipt evidence.
CREATE TABLE treatment_credit_wallets (
  id BIGSERIAL PRIMARY KEY,
  crm_v2_client_id BIGINT NOT NULL UNIQUE REFERENCES crm_v2_clients(id) ON DELETE RESTRICT
);
CREATE TABLE treatment_credit_entries (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES treatment_credit_wallets(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('issue','apply')),
  credit_type TEXT CHECK (credit_type IN ('goodwill','service_exchange')),
  signed_amount NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 240),
  reference TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  operation_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_admin_id BIGINT NOT NULL REFERENCES staff_admin_accounts(id) ON DELETE RESTRICT,
  booking_payment_account_id BIGINT REFERENCES booking_payment_accounts(id) ON DELETE RESTRICT,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((entry_type='issue' AND signed_amount>0 AND credit_type IS NOT NULL
           AND booking_payment_account_id IS NULL AND appointment_id IS NULL
           AND (credit_type<>'service_exchange' OR length(reference)>0))
      OR (entry_type='apply' AND signed_amount<0 AND credit_type IS NULL
           AND booking_payment_account_id IS NOT NULL AND appointment_id IS NOT NULL))
);
CREATE INDEX treatment_credit_entries_wallet ON treatment_credit_entries(wallet_id,id);
CREATE INDEX treatment_credit_entries_booking ON treatment_credit_entries(booking_payment_account_id);
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
    OR EXISTS (SELECT 1 FROM treatment_credit_allocations a
      JOIN treatment_credit_entries d ON d.id=a.debit_entry_id
      JOIN treatment_credit_entries i ON i.id=a.issue_entry_id
      WHERE d.wallet_id=target_wallet AND (d.entry_type<>'apply' OR i.entry_type<>'issue' OR d.wallet_id<>i.wallet_id))
    OR EXISTS (SELECT 1 FROM treatment_credit_entries e WHERE e.wallet_id=target_wallet AND
      ((e.entry_type='issue' AND COALESCE((SELECT SUM(a.amount) FROM treatment_credit_allocations a WHERE a.issue_entry_id=e.id),0)>e.signed_amount)
       OR (e.entry_type='apply' AND COALESCE((SELECT SUM(a.amount) FROM treatment_credit_allocations a WHERE a.debit_entry_id=e.id),0)<>-e.signed_amount)))
  THEN RAISE EXCEPTION 'Invalid treatment credit allocation or balance'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER treatment_credit_entry_position AFTER INSERT ON treatment_credit_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION treatment_credit_check_position();
CREATE CONSTRAINT TRIGGER treatment_credit_allocation_position AFTER INSERT ON treatment_credit_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION treatment_credit_check_position();
COMMENT ON TABLE treatment_credit_entries IS 'Noncash treatment credit. No expiry, reversal, cash receipt, invoice-payment or Rewards semantics. Preserve evidence in forward fixes.';
