CREATE TABLE staff(id bigint PRIMARY KEY,status text,display_name text);
CREATE TABLE services(id bigint PRIMARY KEY,status text);
CREATE TABLE staff_services(staff_id bigint,service_id bigint);
CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,staff_id bigint,display_name text,role text,business_role text,calendar_scope text,service_scope text,permissions jsonb,active boolean);
CREATE TABLE appointments(id bigint PRIMARY KEY,location_id bigint,starts_at timestamptz,ends_at timestamptz,status text,updated_at timestamptz,source_client_name text,title text,notes text,total_price numeric,currency text,crm_v2_client_id bigint);
CREATE TABLE appointment_staff(id bigint PRIMARY KEY,appointment_id bigint,staff_id bigint,position int,staff_name_snapshot text);
CREATE TABLE appointment_services(id bigint PRIMARY KEY,appointment_id bigint,service_id bigint,position int,service_name_snapshot text);
CREATE TABLE appointment_groups(id bigint PRIMARY KEY,group_type text,starts_at timestamptz,ends_at timestamptz,status text,updated_at timestamptz,total_price numeric);
CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint UNIQUE,guest_position int,allocated_price numeric,PRIMARY KEY(group_id,guest_position));
CREATE TABLE appointment_booking_approvals(id bigint,appointment_id bigint,status text,proposed_staff_ids bigint[],proposal_expires_at timestamptz,proposed_starts_at timestamptz,proposed_ends_at timestamptz);
CREATE TABLE calendar_blocks(id bigint,staff_id bigint,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE appointment_lifecycle(appointment_id bigint,appointment_at timestamptz,appointment_ends_at timestamptz,reminder_sent_at timestamptz,updated_at timestamptz);
CREATE TABLE appointment_status_history(appointment_id bigint,from_status text,to_status text,changed_by text,reason text);
CREATE TABLE crm_audit_events(id bigint GENERATED ALWAYS AS IDENTITY,actor_admin_id bigint,action text,entity_type text,entity_id bigint,metadata jsonb);
CREATE TABLE payment_requests(id bigint,group_id bigint,state text,amount numeric);
INSERT INTO staff VALUES(11,'active','Synthetic therapist A'),(12,'active','Synthetic therapist B');
INSERT INTO staff_admin_accounts VALUES(1,11,'Synthetic editor','owner','owner','all_business','all_services','{"appointment:view":true,"calendar:booking:reschedule":true}',true),
  (2,11,'Scoped editor','staff','employee','own_appointments','own_services','{"appointment:view":true,"calendar:booking:reschedule":true}',true);
INSERT INTO services VALUES(21,'active'),(22,'active');
INSERT INTO staff_services VALUES(11,21),(12,22);
INSERT INTO appointments VALUES(101,1,'2026-11-02 08:00Z','2026-11-02 09:30Z','scheduled','2026-10-01 08:00Z','Synthetic Guest A','Massage A','First note',590,'ZAR',501),
  (102,1,'2026-11-02 08:00Z','2026-11-02 09:00Z','scheduled','2026-10-01 08:00Z','Synthetic Guest B','Massage B','Second note',720,'ZAR',502);
INSERT INTO appointment_staff VALUES(1,101,11,1,'Synthetic therapist A'),(2,102,12,1,'Synthetic therapist B');
INSERT INTO appointment_services VALUES(1,101,21,1,'Massage A'),(2,102,22,1,'Massage B');
INSERT INTO appointment_groups VALUES(71,'couples_massage','2026-11-02 08:00Z','2026-11-02 09:30Z','scheduled','2026-10-01 08:00Z',1310);
INSERT INTO appointment_group_members VALUES(71,101,1,590),(71,102,2,720);
INSERT INTO payment_requests VALUES(1,71,'paid',655);
