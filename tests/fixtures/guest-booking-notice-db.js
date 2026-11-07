const {PGlite}=require('@electric-sql/pglite');
async function setup(t){const db=new PGlite();t.after(()=>db.close());await db.exec(`
 CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,status TEXT DEFAULT 'active',normalized_mobile TEXT,profile_status TEXT DEFAULT 'minimal',mobile_verified_at TIMESTAMPTZ,contact_mode TEXT DEFAULT 'direct');
 INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode)VALUES(101,'Synthetic Alpha',NULL,'organiser'),(102,'Synthetic Direct','27810000102','direct'),(103,'Synthetic Gamma',NULL,'organiser'),(201,'Synthetic Organiser','27810000201','direct'),(202,'Synthetic Other','27810000202','direct');
 CREATE TABLE crm_v2_client_relationships(client_id BIGINT,relationship_type TEXT,owner_staff_id BIGINT,status TEXT DEFAULT 'active');INSERT INTO crm_v2_client_relationships(client_id,relationship_type)SELECT id,'clinic' FROM crm_v2_clients;
 CREATE TABLE appointment_groups(id BIGINT PRIMARY KEY,source TEXT,status TEXT DEFAULT 'scheduled',starts_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW());INSERT INTO appointment_groups(id,source,starts_at)VALUES(10,'shiloh_calendar_group','2030-01-01T08:00Z');
 CREATE TABLE appointments(id BIGINT PRIMARY KEY,client_id BIGINT,crm_v2_client_id BIGINT,status TEXT DEFAULT 'scheduled',starts_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW(),notes TEXT);INSERT INTO appointments(id,crm_v2_client_id,starts_at,notes)VALUES(1,101,'2030-01-01T08:00Z','Synthetic private health note'),(2,102,'2030-01-01T08:00Z',NULL),(3,103,'2030-01-01T08:00Z',NULL);
 CREATE TABLE appointment_group_members(group_id BIGINT,appointment_id BIGINT);INSERT INTO appointment_group_members VALUES(10,1),(10,2),(10,3);
 CREATE TABLE appointment_group_booking_contacts(appointment_group_id BIGINT PRIMARY KEY,organiser_crm_v2_client_id BIGINT,revision BIGINT DEFAULT 1);INSERT INTO appointment_group_booking_contacts(appointment_group_id,organiser_crm_v2_client_id)VALUES(10,201);
 CREATE TABLE appointment_services(appointment_id BIGINT,service_id BIGINT);INSERT INTO appointment_services VALUES(1,20),(2,20),(3,20);CREATE TABLE service_visibility_policies(service_id BIGINT,visibility_scope TEXT);
 `);return db;}
module.exports={setup};
