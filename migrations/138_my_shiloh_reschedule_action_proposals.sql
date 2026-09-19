-- Extend My Shiloh confirmed client actions to practitioner-approved reschedule requests.
--
-- A reschedule proposal stores only the exact requested slot. Confirming the
-- proposal still does not move the appointment; it delegates to the existing
-- appointment_reschedule_requests practitioner-approval workflow.

ALTER TABLE client_action_proposals
  ADD COLUMN IF NOT EXISTS action_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(action_payload) = 'object');

ALTER TABLE client_action_proposals
  DROP CONSTRAINT IF EXISTS client_action_proposals_action_type_check;

ALTER TABLE client_action_proposals
  ADD CONSTRAINT client_action_proposals_action_type_check
  CHECK (action_type IN ('cancel_appointment','request_reschedule'));

ALTER TABLE client_action_proposals
  DROP CONSTRAINT IF EXISTS client_action_proposals_outcome_check;

ALTER TABLE client_action_proposals
  ADD CONSTRAINT client_action_proposals_outcome_check
  CHECK (outcome IS NULL OR outcome IN (
    'confirmed','declined','appointment_changed','appointment_started',
    'already_cancelled','ownership_changed','complex_booking','failed',
    'pending_approval','already_pending','slot_unavailable',
    'notification_failed','feature_disabled'
  ));

COMMENT ON COLUMN client_action_proposals.action_payload IS
  'Minimal server-owned proposal details. For request_reschedule this stores only the exact proposed start/end timestamps; it is never trusted without canonical revalidation at confirmation.';
