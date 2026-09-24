-- Owner-authorized Toe Gel pricing correction and bookability repair.
-- Toe Gel Only is an active Shiloh service at R250 (ZAR).
-- The migration fails closed if the canonical service is missing or duplicated.

DO $$
DECLARE
  service_row RECORD;
  service_count INTEGER;
  mapping_count INTEGER;
BEGIN
  SELECT COUNT(*)::int
    INTO service_count
    FROM services
   WHERE LOWER(TRIM(name)) = 'toe gel only';

  IF service_count <> 1 THEN
    RAISE EXCEPTION 'Toe Gel Only pricing repair requires exactly one canonical service; found %', service_count;
  END IF;

  SELECT s.id, s.name, s.status, s.price, s.variable_price
    INTO service_row
    FROM services s
   WHERE LOWER(TRIM(s.name)) = 'toe gel only'
   FOR UPDATE;

  UPDATE services
     SET status = 'active',
         price = 250,
         variable_price = FALSE,
         updated_at = NOW()
   WHERE id = service_row.id;

  SELECT COUNT(*)::int
    INTO mapping_count
    FROM staff_services
   WHERE service_id = service_row.id;

  IF mapping_count = 0 THEN
    RAISE EXCEPTION 'Toe Gel Only pricing repair refused because no practitioner mapping exists';
  END IF;

  INSERT INTO crm_audit_events(action, entity_type, entity_id, metadata)
  VALUES (
    'service.price_and_bookability_corrected',
    'service',
    service_row.id,
    jsonb_build_object(
      'serviceName', 'Toe Gel Only',
      'previousStatus', service_row.status,
      'previousPrice', service_row.price,
      'previousVariablePrice', service_row.variable_price,
      'newStatus', 'active',
      'newPrice', '250.00',
      'currency', 'ZAR',
      'newVariablePrice', FALSE,
      'reason', 'owner_authorized_pricing_correction',
      'practitionerMappingsPreserved', mapping_count
    )
  );
END $$;
