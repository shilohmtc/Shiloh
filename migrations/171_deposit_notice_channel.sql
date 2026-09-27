-- Record which customer channel accepted a booking deposit notice.
-- Existing successful WhatsApp notices retain their original evidence.
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS deposit_notice_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS deposit_notice_channel TEXT;

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_deposit_notice_state_check
  CHECK (deposit_notice_state IN ('pending','sending','sent'));

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_deposit_notice_channel_check
  CHECK (deposit_notice_channel IS NULL OR deposit_notice_channel IN ('whatsapp','my_shiloh'));

UPDATE payment_requests
   SET deposit_notice_state='sent',deposit_notice_channel='whatsapp'
 WHERE purpose='deposit' AND deposit_notification_sent_at IS NOT NULL
   AND deposit_notice_state='pending';
