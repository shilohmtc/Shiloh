-- Close client-withdrawn enquiries or associate their actual completed visit.
-- Keep historical declined rows and all appointment/payment history intact.
ALTER TABLE client_planning_requests
  ADD COLUMN resolution_request_id UUID,
  ADD COLUMN resolution_fingerprint TEXT CHECK (resolution_fingerprint ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX client_planning_requests_resolution_request
  ON client_planning_requests(resolution_request_id) WHERE resolution_request_id IS NOT NULL;

ALTER TABLE client_planning_requests DROP CONSTRAINT client_planning_requests_status_check;
ALTER TABLE client_planning_requests ADD CONSTRAINT client_planning_requests_status_check
  CHECK (status IN ('requested','planning','declined','arranged','cancelled','attended'));
ALTER TABLE client_planning_requests DROP CONSTRAINT client_planning_requests_state_check;
ALTER TABLE client_planning_requests ADD CONSTRAINT client_planning_requests_state_check CHECK (
  (status='requested' AND planning_started_at IS NULL AND planning_by_admin_id IS NULL AND decided_at IS NULL AND decided_by_admin_id IS NULL AND linked_appointment_id IS NULL)
  OR (status='planning' AND planning_started_at IS NOT NULL AND planning_by_admin_id IS NOT NULL AND decided_at IS NULL AND decided_by_admin_id IS NULL AND linked_appointment_id IS NULL)
  OR (status IN ('declined','cancelled') AND decided_at IS NOT NULL AND decided_by_admin_id IS NOT NULL AND linked_appointment_id IS NULL)
  OR (status IN ('arranged','attended') AND decided_at IS NOT NULL AND decided_by_admin_id IS NOT NULL AND linked_appointment_id IS NOT NULL)
);
ALTER TABLE client_planning_requests ADD CONSTRAINT client_planning_requests_resolution_receipt_check CHECK (
  (status IN ('cancelled','attended') AND resolution_request_id IS NOT NULL AND resolution_fingerprint IS NOT NULL)
  OR (status NOT IN ('cancelled','attended') AND resolution_request_id IS NULL AND resolution_fingerprint IS NULL)
);
