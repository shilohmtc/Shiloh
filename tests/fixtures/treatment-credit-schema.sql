CREATE TABLE staff(id BIGINT PRIMARY KEY,status TEXT);
CREATE TABLE staff_admin_accounts(id BIGINT PRIMARY KEY,staff_id BIGINT,display_name TEXT,role TEXT,business_role TEXT,calendar_scope TEXT,service_scope TEXT,permissions JSONB,active BOOLEAN);
CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,status TEXT);
CREATE TABLE appointments(id BIGINT PRIMARY KEY,client_id BIGINT,crm_v2_client_id BIGINT,status TEXT,total_price NUMERIC(12,2),currency TEXT,updated_at TIMESTAMPTZ,starts_at TIMESTAMPTZ,title TEXT);
CREATE TABLE appointment_groups(id BIGINT PRIMARY KEY,status TEXT,final_total NUMERIC(12,2),total_price NUMERIC(12,2),updated_at TIMESTAMPTZ);
CREATE TABLE appointment_group_members(group_id BIGINT,appointment_id BIGINT);
CREATE TABLE booking_payment_accounts(id BIGSERIAL PRIMARY KEY,appointment_id BIGINT UNIQUE,appointment_group_id BIGINT UNIQUE,canonical_amount_due NUMERIC(12,2),currency TEXT,pricing_revision TIMESTAMPTZ);
CREATE TABLE booking_deposit_requirements(id BIGSERIAL PRIMARY KEY,payment_account_id BIGINT,state TEXT);
CREATE TABLE payment_requests(id BIGSERIAL PRIMARY KEY,payment_account_id BIGINT,state TEXT);
CREATE TABLE payment_ledger_entries(id BIGSERIAL PRIMARY KEY,payment_account_id BIGINT,entry_type TEXT,amount NUMERIC(12,2));
CREATE TABLE booking_loyalty_allocations(booking_payment_account_id BIGINT,state TEXT,amount NUMERIC(12,2));
CREATE TABLE booking_welcome_voucher_allocations(booking_payment_account_id BIGINT,state TEXT,amount NUMERIC(12,2));
CREATE TABLE crm_audit_events(actor_admin_id BIGINT,action TEXT,entity_type TEXT,entity_id BIGINT,metadata JSONB);
CREATE TABLE gift_voucher_orders(id BIGINT PRIMARY KEY,state TEXT);
CREATE TABLE gift_vouchers(id BIGINT PRIMARY KEY,order_id BIGINT REFERENCES gift_voucher_orders(id),voucher_code TEXT UNIQUE,original_value NUMERIC(12,2),balance NUMERIC(12,2),state TEXT,valid_until DATE,recipient_crm_v2_client_id BIGINT,updated_at TIMESTAMPTZ);
CREATE TABLE gift_voucher_ledger_entries(id BIGSERIAL PRIMARY KEY,voucher_id BIGINT REFERENCES gift_vouchers(id),entry_type TEXT,amount NUMERIC(12,2),operation_key TEXT UNIQUE,actor_admin_id BIGINT,notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
INSERT INTO staff_admin_accounts VALUES
 (1,NULL,'Synthetic Owner','owner','owner','all_business','all_services','{"client:lookup":true,"treatment_credit:view":true,"treatment_credit:issue":true,"treatment_credit:apply":true,"treatment_credit:correct":true,"voucher:view":true,"voucher:redeem":true,"payment:view":true}',TRUE),
 (2,NULL,'Synthetic Reception','staff','booking_operator','all_business','all_services','{"client:lookup":true,"treatment_credit:view":true,"treatment_credit:issue":true,"treatment_credit:apply":true,"treatment_credit:correct":true,"voucher:view":true,"voucher:redeem":true,"payment:view":true}',TRUE),
 (3,NULL,'Synthetic Unauthorised','owner','owner','all_business','all_services','{"client:lookup":true,"loyalty:manage":true,"payment:collect":true}',TRUE);
INSERT INTO crm_v2_clients VALUES(101,'Synthetic Client','active'),(102,'Synthetic Other','active'),(103,'Synthetic Archived','archived');
INSERT INTO appointments VALUES
 (201,NULL,101,'completed',650,'ZAR',NOW(),'2026-10-08T08:00Z','Synthetic treatment'),
 (202,NULL,101,'completed',650,'ZAR',NOW(),'2026-10-08T09:00Z','Synthetic second treatment'),
 (203,NULL,101,'confirmed',650,'ZAR',NOW(),'2026-10-09T09:00Z','Synthetic future treatment'),
 (204,NULL,102,'completed',650,'ZAR',NOW(),'2026-10-08T10:00Z','Synthetic other treatment');

INSERT INTO gift_voucher_orders VALUES(301,'paid'),(302,'paid'),(303,'paid'),(304,'awaiting_payment');
INSERT INTO gift_vouchers VALUES(401,301,'SV-AAAAAAAAAAAA',500,500,'active',NULL,101,NOW()),(402,302,'SV-BBBBBBBBBBBB',500,500,'active','2000-01-01',101,NOW()),(403,303,'SV-CCCCCCCCCCCC',500,500,'active',NULL,102,NOW()),(404,304,'SV-DDDDDDDDDDDD',500,500,'active',NULL,101,NOW());

ALTER TABLE crm_v2_clients ADD COLUMN mobile_verified_at TIMESTAMPTZ DEFAULT NOW();
