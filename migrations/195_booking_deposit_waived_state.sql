-- Deposit-only waiver. Preserve every original amount and policy snapshot.
-- Applied only through the existing controlled migration authority.
ALTER TABLE booking_deposit_requirements
  DROP CONSTRAINT booking_deposit_requirements_state_check;

ALTER TABLE booking_deposit_requirements
  ADD CONSTRAINT booking_deposit_requirements_state_check
  CHECK (state IN ('awaiting', 'satisfied', 'exempt', 'waived'));
