-- Keep the client's explicit Yes/No answer distinct from older unanswered requests.
ALTER TABLE appointment_booking_approvals
  ADD COLUMN IF NOT EXISTS client_special_occasion BOOLEAN;

ALTER TABLE appointment_booking_approvals
  DROP CONSTRAINT IF EXISTS appointment_booking_approvals_occasion_choice_check;
ALTER TABLE appointment_booking_approvals
  ADD CONSTRAINT appointment_booking_approvals_occasion_choice_check
  CHECK (client_special_occasion IS DISTINCT FROM FALSE OR client_occasion_note IS NULL);
