-- A request addressed to clinic Reception is evidence of a clinic relationship,
-- even before a time has been booked. Keep the canonical client and scoped reads.
-- Do not reactivate deliberately archived relationships or expose unrelated
-- My Shiloh registrations / tenant-only clients to the clinic.
INSERT INTO crm_v2_client_relationships
  (client_id, relationship_type, owner_staff_id, status, source)
SELECT DISTINCT c.id, 'clinic', NULL::bigint, c.status, 'my_shiloh_planning_request'
  FROM client_planning_requests r
  JOIN crm_v2_clients c ON c.id=r.crm_v2_client_id
 WHERE r.source_channel='my_shiloh'
ON CONFLICT (client_id) WHERE relationship_type='clinic' DO NOTHING;

CREATE OR REPLACE FUNCTION shiloh_sync_client_relationship_from_planning_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO crm_v2_client_relationships
    (client_id, relationship_type, owner_staff_id, status, source)
  SELECT c.id, 'clinic', NULL, c.status, 'my_shiloh_planning_request'
    FROM crm_v2_clients c
   WHERE c.id=NEW.crm_v2_client_id AND NEW.source_channel='my_shiloh'
  ON CONFLICT (client_id) WHERE relationship_type='clinic' DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_client_relationship_from_planning_request
  ON client_planning_requests;
CREATE TRIGGER trg_sync_client_relationship_from_planning_request
AFTER INSERT ON client_planning_requests
FOR EACH ROW
EXECUTE FUNCTION shiloh_sync_client_relationship_from_planning_request();
