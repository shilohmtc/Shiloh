CREATE TABLE clients(id BIGINT PRIMARY KEY,display_name TEXT);
CREATE TABLE client_contacts(id BIGINT,client_id BIGINT,normalized_value TEXT,contact_type TEXT,is_primary BOOLEAN);
CREATE TABLE appointment_staff(appointment_id BIGINT,staff_id BIGINT,position INT);
CREATE TABLE appointment_services(appointment_id BIGINT,service_id BIGINT,service_name_snapshot TEXT,position INT);
INSERT INTO appointment_staff VALUES(201,11,1),(202,11,1),(203,11,1),(204,11,1);
INSERT INTO appointment_services VALUES(201,21,'Synthetic treatment',1),(202,21,'Synthetic treatment',1),(203,21,'Synthetic treatment',1),(204,21,'Synthetic treatment',1);
ALTER TABLE crm_v2_clients ADD COLUMN normalized_mobile TEXT;
UPDATE crm_v2_clients SET normalized_mobile='27810000101' WHERE id=101;
ALTER TABLE booking_payment_accounts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE payment_ledger_entries ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),ADD COLUMN method TEXT DEFAULT 'cash',
  ADD COLUMN evidence_kind TEXT DEFAULT 'authorized_manual',ADD COLUMN external_reference TEXT,ADD COLUMN provider_transaction_id TEXT,
  ADD COLUMN operation_key TEXT UNIQUE,ADD COLUMN actor_admin_id BIGINT,ADD COLUMN notes TEXT,ADD COLUMN payment_request_id BIGINT,
  ADD COLUMN payer_crm_v2_client_id BIGINT;
ALTER TABLE payment_requests ADD COLUMN request_key TEXT,ADD COLUMN provider TEXT DEFAULT 'ozow',ADD COLUMN provider_request_id TEXT,
  ADD COLUMN provider_payment_url TEXT,ADD COLUMN amount NUMERIC,ADD COLUMN purpose TEXT DEFAULT 'general',ADD COLUMN deposit_requirement_id BIGINT,
  ADD COLUMN deposit_member_appointment_id BIGINT,ADD COLUMN payer_name TEXT,ADD COLUMN payer_mobile TEXT,ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE payment_requests ADD COLUMN currency TEXT DEFAULT 'ZAR',ADD COLUMN gift_voucher_order_id BIGINT;
ALTER TABLE appointment_group_members ADD COLUMN guest_position INT DEFAULT 1;
ALTER TABLE appointment_groups ADD COLUMN source TEXT;
ALTER TABLE crm_audit_events ADD COLUMN id BIGSERIAL,ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
CREATE TABLE client_package_entitlements(id BIGINT,crm_v2_client_id BIGINT,payment_reference TEXT);
ALTER TABLE client_package_entitlements ADD COLUMN purchased_at TIMESTAMPTZ DEFAULT NOW(),ADD COLUMN purchase_price NUMERIC(12,2),ADD COLUMN payment_method TEXT,ADD COLUMN payment_status TEXT;
CREATE TABLE gift_voucher_payment_entries(id BIGINT,created_at TIMESTAMPTZ,amount NUMERIC(12,2),method TEXT,order_id BIGINT);
UPDATE staff_admin_accounts SET permissions=permissions || '{"appointment:view":true,"payment:collect":true,"payment:refund":true}'::jsonb WHERE id IN (1,2);
UPDATE appointments SET total_price=500 WHERE id IN (201,202,203);
CREATE TABLE payment_provider_events(id BIGSERIAL,provider TEXT,provider_event_key TEXT,signature_verified BOOLEAN,payload_sha256 TEXT,outcome TEXT,payment_request_id BIGINT);

ALTER TABLE appointments ADD COLUMN financial_classification TEXT DEFAULT 'standard',ADD COLUMN pre_adjustment_total_price NUMERIC(12,2);
CREATE TABLE package_session_redemptions(appointment_id BIGINT,status TEXT);
UPDATE staff_admin_accounts SET permissions=permissions || '{"appointment:adjust_end":true,"calendar:booking:reschedule":true,"calendar:booking:cancel":true,"calendar:booking:reassign":true}'::jsonb WHERE id IN(1,2);

ALTER TABLE payment_ledger_entries ADD CONSTRAINT payment_ledger_account_fk FOREIGN KEY(payment_account_id) REFERENCES booking_payment_accounts(id);
ALTER TABLE payment_requests ADD CONSTRAINT payment_request_account_fk FOREIGN KEY(payment_account_id) REFERENCES booking_payment_accounts(id);
