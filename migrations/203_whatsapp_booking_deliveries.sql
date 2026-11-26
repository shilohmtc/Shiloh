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

CREATE TABLE whatsapp_booking_pilot_admission (
  slot SMALLINT PRIMARY KEY CHECK (slot=1),
  recipient_hash TEXT NOT NULL CHECK (recipient_hash ~ '^[a-f0-9]{64}$'),
  window_ends_at TIMESTAMPTZ NOT NULL,
  reserved_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reserved_attempts BETWEEN 0 AND 20)
);

COMMENT ON TABLE whatsapp_booking_pilot_admission IS
  'Singleton staff pilot attempt limit and latest authenticated inbound service window. Replays never reset the count.';
