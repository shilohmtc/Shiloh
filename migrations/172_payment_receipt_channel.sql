-- Channel evidence for verified Ozow receipts. Existing payments keep their
-- historical delivery state; only newly claimed receipts use this record.
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS receipt_notice_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS receipt_notice_channel TEXT,
  ADD COLUMN IF NOT EXISTS receipt_notice_sent_at TIMESTAMPTZ;

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_receipt_notice_state_check
  CHECK (receipt_notice_state IN ('pending','sending','sent'));

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_receipt_notice_channel_check
  CHECK (receipt_notice_channel IS NULL OR receipt_notice_channel IN ('whatsapp','my_shiloh'));
