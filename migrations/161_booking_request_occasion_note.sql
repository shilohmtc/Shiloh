-- Keep an optional client occasion detail with the canonical Reception request.
ALTER TABLE appointment_booking_approvals
  ADD COLUMN IF NOT EXISTS client_occasion_note TEXT;

ALTER TABLE appointment_booking_approvals
  DROP CONSTRAINT IF EXISTS appointment_booking_approvals_occasion_note_length_check;
ALTER TABLE appointment_booking_approvals
  ADD CONSTRAINT appointment_booking_approvals_occasion_note_length_check
  CHECK (client_occasion_note IS NULL OR char_length(client_occasion_note) <= 160);
