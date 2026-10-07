'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {Pool}=require('pg');
const {createClinicIpadCheckinService}=require('../../src/services/clinicIpadCheckin');
const {createClientConsultationFormsService}=require('../../src/services/clientConsultationForms');
const deviceToken='d'.repeat(43),otherDeviceToken='e'.repeat(43);
async function fixture({dob=null,realPostgres=false}={}) {
  let engine,pool,schema;
  if(realPostgres) {
    const url=new URL(process.env.TEST_IPAD_DATABASE_URL);
    if(!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Synthetic proof requires a loopback PostgreSQL database');
    schema='ipad_handover_'+crypto.randomBytes(6).toString('hex');
    const bootstrap=new Pool({connectionString:url.href});
    await bootstrap.query(`CREATE SCHEMA ${schema}`);await bootstrap.end();
    pool=new Pool({connectionString:url.href,options:`-c search_path=${schema}`,max:8});
    engine={exec:sql=>pool.query(sql),query:(sql,args)=>pool.query(sql,args)};
  } else {engine=new PGlite();}
  let barrier=Promise.resolve();
  const query=async(sql,args)=>{const result=await engine.query(sql,args);return {...result,rowCount:result.rowCount??result.affectedRows??result.rows.length};};
  const db=pool||{query,connect:async()=>{
    const previous=barrier;let unlock;barrier=new Promise(resolve=>{unlock=resolve;});await previous;
    return {query,release:unlock};
  }};
  await engine.exec(`
    CREATE TABLE staff (id bigint PRIMARY KEY,status text);
    CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,staff_id bigint,display_name text,role text,business_role text,calendar_scope text,service_scope text,permissions jsonb,active boolean);
    INSERT INTO staff_admin_accounts VALUES(2,NULL,'Synthetic Owner','admin','owner','all_business','all_services','{"appointment:create":true,"client:lookup":true,"calendar:booking:reschedule":true}',true),(3,NULL,'Synthetic Reception','admin','booking_operator','all_business','all_services','{"appointment:create":true,"client:lookup":true,"calendar:booking:reschedule":true}',true),(4,NULL,'Synthetic Unauthorised','admin','practitioner','all_business','all_services','{}',true);
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,normalized_mobile text,date_of_birth date,gender text,profile_status text,mobile_verified_at timestamptz,source text,status text,provenance jsonb,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,profile_status,status,provenance) VALUES(10,'Synthetic Client','27821234567','minimal','active','{}'),(11,'Other Synthetic Client','27829876543','minimal','active','{}');
    CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,status text);
    INSERT INTO crm_v2_client_relationships VALUES(10,'clinic','active'),(11,'clinic','active');
    CREATE TABLE appointments(id bigint PRIMARY KEY,crm_v2_client_id bigint,client_id bigint,status text,starts_at timestamptz,notes text,updated_at timestamptz DEFAULT NOW());
    INSERT INTO appointments VALUES(42,10,NULL,'confirmed',NOW()+interval '1 day',NULL,NOW()),(43,11,NULL,'confirmed',NOW()+interval '2 days',NULL,NOW());
    CREATE TABLE appointment_staff(id int,appointment_id bigint,staff_id bigint,position int);
    CREATE TABLE appointment_services(id int,appointment_id bigint,service_id bigint,position int);
    INSERT INTO appointment_staff VALUES(1,42,12,0),(2,43,13,0);
    INSERT INTO appointment_services VALUES(1,42,7,0),(2,43,8,0);
    CREATE TABLE consultation_form_templates(id bigint PRIMARY KEY,title text,status text);
    INSERT INTO consultation_form_templates VALUES(1,'Synthetic Consultation','active');
    CREATE TABLE consultation_form_template_versions(id bigint PRIMARY KEY,template_id bigint);
    INSERT INTO consultation_form_template_versions VALUES(8,1);
    CREATE TABLE consultation_form_assignments(id bigint PRIMARY KEY,crm_v2_client_id bigint,client_id bigint,appointment_id bigint,template_version_id bigint,status text,access_token_hash text,access_expires_at timestamptz,access_issued_at timestamptz,access_revoked_at timestamptz,updated_at timestamptz);
    INSERT INTO consultation_form_assignments(id,crm_v2_client_id,appointment_id,template_version_id,status) VALUES(7,10,42,8,'opened'),(8,11,43,8,'sent');
    CREATE TABLE staff_auth_security_events(id bigserial PRIMARY KEY,event_type text,operator_admin_id bigint,metadata jsonb);
    CREATE TABLE client_browser_sessions(id bigint PRIMARY KEY,crm_v2_client_id bigint,revoked_at timestamptz,expires_at timestamptz);
    INSERT INTO client_browser_sessions VALUES(77,10,NULL,NOW()+interval '1 day');
    CREATE TABLE client_auth_security_events(id bigserial PRIMARY KEY,event_type text,crm_v2_client_id bigint,session_id bigint,metadata jsonb);
  `);
  for(const file of ['165_clinic_ipad_checkin.sql','187_clinic_ipad_staff_handover.sql'])await engine.exec(fs.readFileSync(path.join(__dirname,'../../migrations',file),'utf8'));
  await db.query(`INSERT INTO clinic_checkin_devices(id,token_hash,activated_by_admin_id) VALUES(1,$1,2),(2,$2,3)`,[deviceToken,otherDeviceToken].map(t=>crypto.createHash('sha256').update(t).digest('hex')));
  if(dob)await db.query('UPDATE crm_v2_clients SET date_of_birth=$1 WHERE id=10',[dob]);
  let clock=new Date();
  const service=createClinicIpadCheckinService({db,now:()=>clock,
    clientMutations:{resolveManageAccess:async id=>[2,3].includes(Number(id))?{operatorAdminId:Number(id),clientScope:{kind:'clinic'}}:null},
    formsAuthority:{resolveAccess:async id=>[2,3].includes(Number(id))?{formScope:'all_business'}:null},
    formService:createClientConsultationFormsService({db,now:()=>clock})});
  return {db,service,deviceToken,otherDeviceToken,setClock:value=>{clock=value;},close:async()=>{
    if(pool){await pool.end();const cleanup=new Pool({connectionString:process.env.TEST_IPAD_DATABASE_URL});await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);await cleanup.end();}
    else await engine.close();
  }};
}
module.exports={fixture,deviceToken,otherDeviceToken};
