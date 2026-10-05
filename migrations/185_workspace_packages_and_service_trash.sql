-- Owner-approved reusable prepaid packages and recoverable catalogue deletion.
-- Existing entitlements, snapshots and historical windows are preserved.
ALTER TABLE services ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE service_packages ADD COLUMN validity_months INTEGER CHECK (validity_months BETWEEN 1 AND 12);
ALTER TABLE service_packages ADD COLUMN updated_by_admin_id BIGINT REFERENCES staff_admin_accounts(id);
CREATE UNIQUE INDEX service_packages_session_service_unique ON service_packages(session_service_id);
ALTER TABLE client_package_entitlements ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE client_package_entitlements ADD COLUMN crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE RESTRICT;
ALTER TABLE client_package_entitlements ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE client_package_entitlements ALTER COLUMN starts_at DROP DEFAULT;
ALTER TABLE client_package_entitlements ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE client_package_entitlements ADD COLUMN validity_days INTEGER;
ALTER TABLE client_package_entitlements ADD COLUMN validity_months INTEGER;
ALTER TABLE client_package_entitlements ADD COLUMN purchase_name TEXT;
ALTER TABLE client_package_entitlements ADD COLUMN purchase_description TEXT;
ALTER TABLE client_package_entitlements ADD COLUMN payment_reference TEXT;
ALTER TABLE client_package_entitlements ADD COLUMN payment_method TEXT CHECK (payment_method IN ('cash','card_machine','manual_eft'));
ALTER TABLE client_package_entitlements ADD COLUMN operation_key TEXT UNIQUE;
ALTER TABLE client_package_entitlements ADD CONSTRAINT package_identity_exactly_one CHECK ((client_id IS NULL) <> (crm_v2_client_id IS NULL));
ALTER TABLE client_package_entitlements ADD CONSTRAINT package_window_pair CHECK ((starts_at IS NULL) = (expires_at IS NULL));
UPDATE client_package_entitlements e SET validity_days=p.validity_days,validity_months=p.validity_months,purchase_name=p.name,purchase_description=p.customer_description FROM service_packages p WHERE p.id=e.package_id;
ALTER TABLE client_package_entitlements ADD CONSTRAINT package_unstarted_validity CHECK (starts_at IS NOT NULL OR validity_days IS NOT NULL);
CREATE INDEX client_packages_crm_v2 ON client_package_entitlements(crm_v2_client_id,package_id,status);

UPDATE service_packages SET package_price=1400,sessions_included=4,validity_months=1,
 customer_description='Four Sports Massage treatments of 45–50 minutes each. R1,400 paid in full upfront. Enjoy any four sessions within one month of your first treatment. Each booking reserves one treatment from your package; completed treatments are deducted automatically.',updated_at=NOW()
 WHERE slug='sports-massage-monthly';
-- Keep the calendar session authority; package offers are displayed separately.
UPDATE services SET duration_minutes=50,deleted_at=NULL,updated_at=NOW()
 WHERE id=(SELECT session_service_id FROM service_packages WHERE slug='sports-massage-monthly');
-- Retire only the exact duplicate ordinary monthly offering named by the owner.
UPDATE services SET status='inactive',deleted_at=NOW(),updated_at=NOW()
 WHERE regexp_replace(lower(name),'[^a-z]','','g') IN ('sportsmassagemonthlypackage','sportmassagemonthlypackage','spaortmassagemonthlypackage')
 AND NOT EXISTS (SELECT 1 FROM service_packages p WHERE p.session_service_id=services.id);

CREATE FUNCTION shiloh_package_expiry(p_start TIMESTAMPTZ,p_days INTEGER,p_months INTEGER)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
 SELECT ((p_start AT TIME ZONE 'Africa/Johannesburg') + CASE WHEN p_months IS NOT NULL THEN make_interval(months=>p_months) ELSE make_interval(days=>p_days) END) AT TIME ZONE 'Africa/Johannesburg'
$$;

CREATE OR REPLACE FUNCTION shiloh_allocate_package_session()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a appointments%ROWTYPE; e client_package_entitlements%ROWTYPE; p service_packages%ROWTYPE; used INTEGER; first_start TIMESTAMPTZ; last_start TIMESTAMPTZ;
BEGIN
 SELECT * INTO p FROM service_packages WHERE session_service_id=NEW.service_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM package_session_redemptions WHERE appointment_id=NEW.appointment_id) THEN RAISE EXCEPTION 'PACKAGE_SINGLE_TREATMENT_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO STRICT a FROM appointments WHERE id=NEW.appointment_id FOR UPDATE;
 SELECT ent.* INTO e FROM client_package_entitlements ent
 WHERE ent.package_id=p.id AND ent.status='active' AND ent.payment_status='paid'
 AND ((a.client_id IS NOT NULL AND ent.client_id=a.client_id) OR (a.crm_v2_client_id IS NOT NULL AND ent.crm_v2_client_id=a.crm_v2_client_id))
 AND (ent.expires_at IS NULL OR (NOW()<ent.expires_at AND a.starts_at>=ent.starts_at AND a.starts_at<ent.expires_at))
 AND (SELECT COUNT(*) FROM package_session_redemptions r WHERE r.entitlement_id=ent.id AND r.status IN ('reserved','redeemed'))<ent.sessions_total
 ORDER BY ent.expires_at NULLS LAST,ent.id FOR UPDATE LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_ENTITLEMENT_REQUIRED' USING ERRCODE='P0001'; END IF;
 -- Recheck under entitlement lock so concurrent bookings cannot overspend credits.
 SELECT COUNT(*),MIN(ap.starts_at),MAX(ap.starts_at) INTO used,first_start,last_start FROM package_session_redemptions r JOIN appointments ap ON ap.id=r.appointment_id WHERE r.entitlement_id=e.id AND r.status IN ('reserved','redeemed');
 IF used>=e.sessions_total THEN RAISE EXCEPTION 'PACKAGE_CREDITS_EXHAUSTED'; END IF;
 IF e.starts_at IS NULL THEN
  first_start:=LEAST(COALESCE(first_start,a.starts_at),a.starts_at);
  last_start:=GREATEST(COALESCE(last_start,a.starts_at),a.starts_at);
  IF last_start>=shiloh_package_expiry(first_start,e.validity_days,e.validity_months) THEN RAISE EXCEPTION 'PACKAGE_WINDOW_EXCEEDED'; END IF;
 END IF;
 NEW.price_snapshot:=0;
 INSERT INTO package_session_redemptions(entitlement_id,appointment_id,status) VALUES(e.id,a.id,'reserved');
 -- A package service is one prepaid treatment, never a combined-price booking.
 IF EXISTS(SELECT 1 FROM appointment_services WHERE appointment_id=a.id) THEN RAISE EXCEPTION 'PACKAGE_SINGLE_TREATMENT_REQUIRED'; END IF;
 UPDATE appointments SET total_price=0,notes=CONCAT_WS(E'\n',NULLIF(notes,''),'Prepaid package: '||p.name),updated_at=NOW() WHERE id=a.id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION shiloh_sync_package_redemption_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e client_package_entitlements%ROWTYPE;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT ent.* INTO e FROM client_package_entitlements ent JOIN package_session_redemptions r ON r.entitlement_id=ent.id WHERE r.appointment_id=NEW.id AND r.status='reserved' FOR UPDATE OF ent;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.status='completed' THEN
  -- The clock begins on the date/time of the first actual treatment, not payment.
  IF e.starts_at IS NULL THEN
   UPDATE client_package_entitlements SET starts_at=NEW.starts_at,expires_at=shiloh_package_expiry(NEW.starts_at,e.validity_days,e.validity_months),updated_at=NOW() WHERE id=e.id;
  END IF;
  UPDATE package_session_redemptions SET status='redeemed',redeemed_at=NOW(),released_at=NULL,updated_at=NOW() WHERE appointment_id=NEW.id AND status='reserved';
 ELSIF NEW.status IN ('cancelled','no_show') THEN
  UPDATE package_session_redemptions SET status='released',released_at=NOW(),updated_at=NOW() WHERE appointment_id=NEW.id AND status='reserved';
 END IF;
 RETURN NEW;
END $$;

-- Rescheduling and completion must also respect the same paid package window.
CREATE FUNCTION shiloh_validate_package_appointment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e client_package_entitlements%ROWTYPE; first_start TIMESTAMPTZ; last_start TIMESTAMPTZ;
BEGIN
 SELECT ent.* INTO e FROM client_package_entitlements ent JOIN package_session_redemptions r ON r.entitlement_id=ent.id WHERE r.appointment_id=NEW.id AND r.status IN ('reserved','redeemed') FOR UPDATE OF ent;
 IF NOT FOUND OR NEW.status IN ('cancelled','no_show') THEN RETURN NEW; END IF;
 IF e.starts_at IS NOT NULL THEN
  IF NEW.starts_at<e.starts_at OR NEW.starts_at>=e.expires_at THEN RAISE EXCEPTION 'PACKAGE_WINDOW_EXCEEDED'; END IF;
 ELSE
  SELECT LEAST(NEW.starts_at,COALESCE(MIN(a.starts_at),NEW.starts_at)),GREATEST(NEW.starts_at,COALESCE(MAX(a.starts_at),NEW.starts_at)) INTO first_start,last_start FROM package_session_redemptions r JOIN appointments a ON a.id=r.appointment_id WHERE r.entitlement_id=e.id AND r.appointment_id<>NEW.id AND r.status IN ('reserved','redeemed');
  IF last_start>=shiloh_package_expiry(first_start,e.validity_days,e.validity_months) OR (NEW.status='completed' AND NEW.starts_at<>first_start) THEN RAISE EXCEPTION 'PACKAGE_WINDOW_EXCEEDED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_package_appointment BEFORE UPDATE OF starts_at,status ON appointments FOR EACH ROW EXECUTE FUNCTION shiloh_validate_package_appointment();
