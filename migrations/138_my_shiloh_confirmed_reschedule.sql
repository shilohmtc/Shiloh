-- My Shiloh confirmed reschedule proposals.
--
-- Extends the existing one-time client action proposal envelope so an authenticated
-- client can review an exact available replacement slot before a reschedule request
-- is submitted into the existing practitioner-approval authority.
--
-- This migration does not move appointments, create reschedule requests, send
-- WhatsApp messages or change any existing proposal row.

ALTER TABLE client_action_proposals
  DROP CONSTRAINT IF EXISTS client_action_proposals_action_type_check,
  DROP CONSTRAINT IF EXISTS client_action_proposals_outcome_check;

ALTER TABLE client_action_proposals
  ADD COLUMN IF NOT EXISTS proposed_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_ends_at TIMESTAMPTZ;

ALTER TABLE client_action_proposals
  ADD CONSTRAINT client_action_proposals_action_type_check
    CHECK (action_type IN ('cancel_appointment','reschedule_appointment')),
  ADD CONSTRAINT client_action_proposals_proposed_slot_pair
    CHECK (
      (proposed_starts_at IS NULL AND proposed_ends_at IS NULL)
      OR (
        proposed_starts_at IS NOT NULL
        AND proposed_ends_at IS NOT NULL
        AND proposed_ends_at > proposed_starts_at
      )
    ),
  ADD CONSTRAINT client_action_proposals_reschedule_slot_required
    CHECK (
      action_type <> 'reschedule_appointment'
      OR (proposed_starts_at IS NOT NULL AND proposed_ends_at IS NOT NULL)
    ),
  ADD CONSTRAINT client_action_proposals_outcome_check
    CHECK (outcome IS NULL OR outcome IN (
      'confirmed','declined','appointment_changed','appointment_started',
      'already_cancelled','ownership_changed','complex_booking','failed',
      'pending_approval','approval_request_failed','slot_unavailable'
    ));

COMMENT ON COLUMN client_action_proposals.proposed_starts_at IS
  'Exact reviewed replacement start time for a reschedule proposal. It never authorizes a move by itself.';

COMMENT ON COLUMN client_action_proposals.proposed_ends_at IS
  'Exact reviewed replacement end time for a reschedule proposal. Confirmation still delegates to canonical practitioner approval.';
