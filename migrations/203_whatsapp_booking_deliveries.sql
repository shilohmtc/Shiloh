-- Booking-only service-message delivery claims. No message content or recipient is stored.
CREATE TABLE whatsapp_booking_deliveries (
  delivery_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','accepted','uncertain')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_message_id TEXT,
  CHECK ((state='accepted') = (provider_message_id IS NOT NULL))
);

COMMENT ON TABLE whatsapp_booking_deliveries IS
  'One claim per logical booking message. An uncertain or interrupted claim is never sent again automatically.';
