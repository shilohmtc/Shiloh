'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createClinicIpadCheckinService}=require('../../src/services/clinicIpadCheckin');
const {createClientConsultationFormsService}=require('../../src/services/clientConsultationForms');
const {createClinicTabletBookedAuthority}=require('../../src/services/clinicTabletBookedAuthority');
const {createClinicTabletGrantStore}=require('../../src/services/clinicTabletGrantStore');
const {createClinicTabletOtpProof}=require('../../src/services/clinicTabletOtpProof');
const {createClinicTabletBookedJourney}=require('../../src/services/clinicTabletBookedJourney');
async function tabletBookedFixture({whatsappCodeTtlSeconds=900}={}){
  let pg,pool,schema;
  const url=process.env.WORKSPACE_WHATSAPP_SYNTHETIC_DATABASE_URL;
  if(url){
    const parsed=new URL(url);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/wa_synthetic')throw new Error('Only isolated local wa_synthetic database allowed');
    const {Pool}=require('pg');schema='tablet_booked_'+crypto.randomBytes(8).toString('hex');const control=new Pool({connectionString:url});await control.query(`CREATE SCHEMA ${schema}`);await control.end();
    pool=new Pool({connectionString:url,max:8,options:`-c search_path=${schema},public`});pg={exec:sql=>pool.query(sql),query:(sql,args)=>pool.query(sql,args),close:async()=>{await pool.end();const cleanup=new Pool({connectionString:url});await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);await cleanup.end();}};
  }else pg=new PGlite();
  let queue=Promise.resolve(),clock=new Date('2026-11-11T08:00:00Z'),active=true;
  const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rowCount??r.affectedRows??r.rows.length};};
  const db=pool||{query,connect:async()=>{const before=queue;let release;queue=new Promise(r=>{release=r;});await before;return {query,release};}};
  await pg.exec(`CREATE TABLE staff(id bigint PRIMARY KEY,status text);
    CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,staff_id bigint,display_name text,role text,business_role text,calendar_scope text,service_scope text,permissions jsonb,active boolean,updated_at timestamptz DEFAULT NOW());
    INSERT INTO staff_admin_accounts VALUES(2,NULL,'Synthetic Reception','admin','booking_operator','all_business','all_services','{"appointment:create":true,"client:lookup":true,"calendar:booking:reschedule":true,"forms:view":true}',true,NOW());
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,first_name text,surname text,normalized_mobile text,date_of_birth date,gender text,profile_status text,mobile_verified_at timestamptz,source text,status text,provenance jsonb DEFAULT '{}',created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,date_of_birth,profile_status,status) VALUES(10,'Synthetic Client','27820000001','1990-01-01','registered','active'),(11,'Other Synthetic Client','27820000002','1991-01-01','registered','active');
    CREATE TABLE clients(id bigint PRIMARY KEY,display_name text,status text);
    CREATE TABLE client_contacts(id bigint PRIMARY KEY,client_id bigint,contact_type text,normalized_value text);
    CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,status text);
    INSERT INTO crm_v2_client_relationships VALUES(10,'clinic','active'),(11,'clinic','active');
    CREATE TABLE appointments(id bigint PRIMARY KEY,crm_v2_client_id bigint,client_id bigint,status text,starts_at timestamptz,ends_at timestamptz,title text,notes text,updated_at timestamptz DEFAULT NOW());
    INSERT INTO appointments VALUES(42,10,NULL,'confirmed','2026-11-11T08:30Z','2026-11-11T09:30Z','Synthetic massage',NULL,NOW()),(43,11,NULL,'confirmed','2026-11-11T10:00Z','2026-11-11T11:00Z','Other synthetic visit',NULL,NOW()),(44,10,NULL,'confirmed','2026-11-12T08:30Z','2026-11-12T09:30Z','Tomorrow',NULL,NOW());
    CREATE TABLE services(id bigint PRIMARY KEY);
    INSERT INTO services VALUES(7);
    CREATE TABLE appointment_services(id bigint PRIMARY KEY,appointment_id bigint,service_id bigint,position int,service_name_snapshot text);
    INSERT INTO appointment_services VALUES(1,42,7,0,'Synthetic massage');
    CREATE TABLE appointment_staff(id bigint PRIMARY KEY,appointment_id bigint,staff_id bigint,position int,staff_name_snapshot text);
    CREATE TABLE staff_auth_security_events(id bigserial PRIMARY KEY,event_type text,operator_admin_id bigint,metadata jsonb);
    CREATE TABLE client_browser_sessions(id bigint PRIMARY KEY,crm_v2_client_id bigint,revoked_at timestamptz,expires_at timestamptz);`);
  const foundation=fs.readFileSync('migrations/131_workspace_consultation_forms_foundation.sql','utf8').split('INSERT INTO consultation_form_sections')[0];
  await pg.exec(foundation);
  for(const file of ['132_secure_client_consultation_forms.sql','165_clinic_ipad_checkin.sql','187_clinic_ipad_staff_handover.sql','198_my_shiloh_client_code_auth.sql','202_clinic_tablet_booked_grants.sql'])await pg.exec(fs.readFileSync('migrations/'+file,'utf8'));
  await pg.exec(`INSERT INTO consultation_form_templates(id,template_key,title) VALUES(1,'synthetic_intake','Your visit details'),(2,'synthetic_consent','Treatment consent');
    INSERT INTO consultation_form_template_versions(id,template_id,version_number,consent_text,settings) VALUES(8,1,1,'I confirm my synthetic details are correct.','{"signature_required":true}'),(9,2,1,'I agree to this synthetic treatment.','{"signature_required":true}');
    INSERT INTO consultation_form_service_mappings VALUES(7,8,TRUE,NOW()),(7,9,TRUE,NOW());
    INSERT INTO consultation_form_assignments(id,appointment_id,template_version_id,crm_v2_client_id) VALUES(7,42,8,10),(8,42,9,10);`);
  const deviceToken='D'.repeat(43),otherDeviceToken='E'.repeat(43),hash=t=>crypto.createHash('sha256').update(t).digest('hex');
  await db.query('INSERT INTO clinic_checkin_devices(id,token_hash,activated_by_admin_id) VALUES(1,$1,2),(2,$2,2)',[hash(deviceToken),hash(otherDeviceToken)]);
  const now=()=>new Date(clock),hmacKey=Buffer.alloc(32,3),sent=[];
  let providerReady=true,outcome='accepted';
  const delivery={audience:'client',configured:()=>true,readiness:async()=>({ready:providerReady,codeTtlSeconds:whatsappCodeTtlSeconds}),deliver:async data=>{sent.push(data);return outcome==='accepted'?{ok:true,providerMessageId:'wamid.synthetic'}:{ok:false,outcome};}};
  const formService=createClientConsultationFormsService({db,now,env:{CONSULTATION_FORM_DATA_KEY:Buffer.alloc(32,9).toString('base64url')}});
  const checkin=createClinicIpadCheckinService({db,now,
    clientMutations:{resolveManageAccess:async()=>active?{operatorAdminId:2,clientScope:{kind:'clinic'}}:null},
    formsAuthority:{resolveAccess:async()=>({formScope:'all_business'})},formService});
  const authority=createClinicTabletBookedAuthority({db,formService,checkin,now});
  const store=createClinicTabletGrantStore({db,hmacKey,closeForm:authority.forms.close,now});
  const otp=createClinicTabletOtpProof({db,delivery,hmacKey,budget:{currency:'ZAR',dailyMinor:1000,whatsappCostMinor:100},whatsappCodeTtlSeconds,now});
  const service=createClinicTabletBookedJourney({store,otp,...authority,now});
  return {pg,db,store,otp,service,authority,formService,deviceToken,otherDeviceToken,sent,now,
    advance:ms=>{clock=new Date(clock.getTime()+ms);},access:value=>{active=value;},ready:value=>{providerReady=value;},outcome:value=>{outcome=value;},close:()=>pg.close()};
}
module.exports={tabletBookedFixture};
