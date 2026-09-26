-- SH-05: persist Reception's planning step on the canonical booking request.
-- No existing request is silently moved to Planning. Approval status and held
-- appointment remain unchanged until an authorized human resolves the request.
ALTER TABLE appointment_booking_approvals
  ADD COLUMN planning_started_at TIMESTAMPTZ,
  ADD COLUMN planning_by_admin_id BIGINT REFERENCES staff_admin_accounts(id);

ALTER TABLE appointment_booking_approvals
  ADD CONSTRAINT appointment_booking_approvals_planning_pair_check
  CHECK ((planning_started_at IS NULL) = (planning_by_admin_id IS NULL));
