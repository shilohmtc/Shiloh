-- Preserve new policy wording at acceptance time. Historical rows remain honest:
-- a version/date alone cannot recreate the document the client actually saw.
ALTER TABLE booking_policy_acceptances
  ADD COLUMN IF NOT EXISTS policy_text_snapshot TEXT
    CHECK (policy_text_snapshot IS NULL OR BTRIM(policy_text_snapshot) <> '');

CREATE OR REPLACE FUNCTION protect_booking_policy_acceptance_evidence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.phone,NEW.policy_version,NEW.accepted_at,NEW.channel,
         NEW.service_text,NEW.preferred_date,NEW.preferred_time,NEW.therapist_text,NEW.policy_text_snapshot)
     IS DISTINCT FROM
     ROW(OLD.phone,OLD.policy_version,OLD.accepted_at,OLD.channel,
         OLD.service_text,OLD.preferred_date,OLD.preferred_time,OLD.therapist_text,OLD.policy_text_snapshot)
  THEN
    RAISE EXCEPTION 'Accepted policy evidence cannot be rewritten';
  END IF;
  -- The existing booking commit may attach an initially unlinked acceptance.
  IF (OLD.crm_v2_client_id IS NOT NULL AND NEW.crm_v2_client_id IS DISTINCT FROM OLD.crm_v2_client_id)
     OR (OLD.appointment_id IS NOT NULL AND NEW.appointment_id IS DISTINCT FROM OLD.appointment_id)
  THEN
    RAISE EXCEPTION 'Accepted policy evidence cannot be reassigned';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_booking_policy_acceptance_evidence ON booking_policy_acceptances;
CREATE TRIGGER trg_protect_booking_policy_acceptance_evidence
BEFORE UPDATE ON booking_policy_acceptances
FOR EACH ROW EXECUTE FUNCTION protect_booking_policy_acceptance_evidence();

COMMENT ON COLUMN booking_policy_acceptances.policy_text_snapshot IS
  'Exact canonical Booking Policy & Terms recorded with new acceptance; NULL means no wording snapshot was captured. Never replace with current policy text.';
