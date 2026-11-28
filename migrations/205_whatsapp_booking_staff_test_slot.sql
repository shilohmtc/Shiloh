-- Preserve the original allowance row and reserve a second slot for a distinct staff test number.
ALTER TABLE whatsapp_booking_pilot_admission
  DROP CONSTRAINT whatsapp_booking_pilot_admission_slot_check,
  ADD CONSTRAINT whatsapp_booking_pilot_admission_slot_check CHECK (slot IN (1, 2)),
  ADD CONSTRAINT whatsapp_booking_pilot_admission_recipient_key UNIQUE (recipient_hash);

COMMENT ON TABLE whatsapp_booking_pilot_admission IS
  'Staff pilot attempt limits and authenticated inbound service windows. Slot 1 is the original pilot, slot 2 is an isolated native-flow test. Each recipient can occupy only one slot.';
