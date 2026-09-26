-- Preserve the practitioner authority on in-flight requests. New requests can
-- opt into Reception decision only after this migration has applied.
ALTER TABLE appointment_reschedule_requests
  ADD COLUMN IF NOT EXISTS decision_owner TEXT NOT NULL DEFAULT 'practitioner';

ALTER TABLE appointment_reschedule_requests
  DROP CONSTRAINT IF EXISTS appointment_reschedule_requests_decision_owner_check;
ALTER TABLE appointment_reschedule_requests
  ADD CONSTRAINT appointment_reschedule_requests_decision_owner_check
  CHECK (decision_owner IN ('practitioner','reception'));

CREATE INDEX IF NOT EXISTS idx_reschedule_pending_reception
  ON appointment_reschedule_requests(requested_at,id)
  WHERE status='pending' AND decision_owner='reception';
