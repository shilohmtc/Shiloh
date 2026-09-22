-- Link Shiloh gift vouchers to the verified recipient identity without creating
-- a second client authority. Recipient mobiles stay in local 0XXXXXXXXX form;
-- crm_v2_clients remains the verified identity source.

ALTER TABLE gift_voucher_orders
  ADD COLUMN IF NOT EXISTS recipient_mobile TEXT
    CHECK (recipient_mobile IS NULL OR recipient_mobile ~ '^0[678][0-9]{8}$');

UPDATE gift_voucher_orders
   SET recipient_mobile = delivery_mobile
 WHERE recipient_mobile IS NULL
   AND delivery_recipient = 'recipient'
   AND delivery_mobile ~ '^0[678][0-9]{8}$';

CREATE INDEX IF NOT EXISTS idx_gift_voucher_orders_recipient_mobile
  ON gift_voucher_orders(recipient_mobile)
  WHERE recipient_mobile IS NOT NULL;

ALTER TABLE gift_vouchers
  ADD COLUMN IF NOT EXISTS recipient_crm_v2_client_id BIGINT
    REFERENCES crm_v2_clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_linked_at TIMESTAMPTZ;

ALTER TABLE gift_vouchers
  DROP CONSTRAINT IF EXISTS gift_vouchers_recipient_link_contract;
ALTER TABLE gift_vouchers
  ADD CONSTRAINT gift_vouchers_recipient_link_contract CHECK (
    (recipient_crm_v2_client_id IS NULL AND recipient_linked_at IS NULL)
    OR
    (recipient_crm_v2_client_id IS NOT NULL AND recipient_linked_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_gift_vouchers_recipient_client
  ON gift_vouchers(recipient_crm_v2_client_id, issued_at DESC)
  WHERE recipient_crm_v2_client_id IS NOT NULL;

COMMENT ON COLUMN gift_voucher_orders.recipient_mobile IS
  'Recipient mobile in local South African 0XXXXXXXXX form. Candidate matching only; verified CRM V2 WhatsApp identity remains authoritative.';
COMMENT ON COLUMN gift_vouchers.recipient_crm_v2_client_id IS
  'Verified recipient ownership linked only from an active CRM V2 client with verified WhatsApp/mobile evidence.';
