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


  -- Repair the live booking that exposed this gap, but only when it is the
  -- exact scheduled Toe Gel appointment with no competing price.
  IF EXISTS (SELECT 1 FROM appointments WHERE id=759) THEN
    IF NOT EXISTS (
      SELECT 1 FROM appointments
       WHERE id=759
         AND status IN ('scheduled','confirmed')
         AND (total_price IS NULL OR total_price = 250)
    ) THEN
      RAISE EXCEPTION 'Appointment #759 price repair refused because status or existing price drifted';
    END IF;

    IF (
      SELECT COUNT(*) FROM appointment_services
       WHERE appointment_id=759
         AND REGEXP_REPLACE(LOWER(TRIM(service_name_snapshot)),'[^a-z0-9]+','','g') = 'toegelonly'
    ) <> 1 THEN
      RAISE EXCEPTION 'Appointment #759 price repair requires exactly one Toe Gel Only service snapshot';
    END IF;

    UPDATE appointments
       SET total_price=250, updated_at=NOW()
     WHERE id=759;

    UPDATE appointment_services
       SET price_snapshot=250
     WHERE appointment_id=759
       AND REGEXP_REPLACE(LOWER(TRIM(service_name_snapshot)),'[^a-z0-9]+','','g') = 'toegelonly';

    INSERT INTO crm_audit_events(action, entity_type, entity_id, metadata)
    VALUES (
      'appointment.price_corrected',
      'appointment',
      '759',
      jsonb_build_object(
        'reason','owner_authorized_toe_gel_price_correction',
        'newPrice','250.00',
        'currency','ZAR',
        'bookingNotificationRepair',TRUE
      )
    );
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
