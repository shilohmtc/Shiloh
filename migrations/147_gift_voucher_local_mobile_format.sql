-- Standardize gift-voucher recipient delivery mobiles to Shiloh's local South African display/storage form.
-- Canonical CRM/WhatsApp identity remains authoritative in crm_v2_clients.normalized_mobile (27...).
-- This migration only changes voucher-order delivery data so staff/client-facing voucher records use 0...

UPDATE gift_voucher_orders
   SET delivery_mobile = '0' || SUBSTRING(delivery_mobile FROM 3)
 WHERE delivery_mobile ~ '^27[678][0-9]{8}$';

UPDATE gift_voucher_orders
   SET delivery_mobile = '0' || SUBSTRING(delivery_mobile FROM 5)
 WHERE delivery_mobile ~ '^0027[678][0-9]{8}$';

COMMENT ON COLUMN gift_voucher_orders.delivery_mobile IS
  'Recipient/purchaser voucher-delivery mobile stored in local South African 0XXXXXXXXX form. Convert to canonical 27XXXXXXXXX only at WhatsApp/identity boundaries.';
