'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createClientPlanningRequestService}=require('../src/services/clientPlanningRequests');
const {renderPlanningRequestPage}=require('../src/presentation/myShilohPlanningRequest');

const owner={id:1,business_role:'owner',calendar_scope:'all_business',permissions:{'client:lookup':true}};

test('enquiry completion retains real visits/payments, checks attendance and scope, and records atomic retry receipts',async t=>{
  const nativeUrl=process.env.TEST_PLANNING_RESOLUTION_DATABASE_URL;
  let db,dispose;
  if(nativeUrl){
    const {Client,Pool}=require('pg');const setup=new Client({connectionString:nativeUrl});await setup.connect();
    const schema=`planning_resolution_test_${process.pid}`;await setup.query(`CREATE SCHEMA ${schema}`);
    const pool=new Pool({connectionString:nativeUrl,options:`-c search_path=${schema}`});
    db={query:(...args)=>pool.query(...args),connect:()=>pool.connect()};
    dispose=async()=>{await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();};
  }else{
    const pg=new PGlite();
    const query=async(sql,params)=>{const r=params ? await pg.query(sql,params) : (await pg.exec(sql)).at(-1);return{...r,rowCount:r.rows.length||r.affectedRows||0};};
    db={query,async connect(){return{query,release(){}};}};dispose=()=>pg.close();
  }
  t.after(dispose);
  const exec=sql=>db.query(sql);
  await exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,normalized_mobile text,status text);
    CREATE TABLE staff(id bigint PRIMARY KEY,display_name text,status text);
    CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,active boolean,staff_id bigint,business_role text,calendar_scope text,permissions jsonb);
    CREATE TABLE services(id bigint PRIMARY KEY,name text);
    CREATE TABLE appointments(id bigint PRIMARY KEY,client_id bigint,crm_v2_client_id bigint,starts_at timestamptz,ends_at timestamptz,status text);
    CREATE TABLE appointment_booking_approvals(appointment_id bigint PRIMARY KEY,status text);
    CREATE TABLE appointment_services(id bigint PRIMARY KEY,appointment_id bigint,service_id bigint,service_name_snapshot text);
    CREATE TABLE appointment_staff(appointment_id bigint,staff_id bigint,staff_name_snapshot text);
    CREATE TABLE service_visibility_policies(service_id bigint PRIMARY KEY,visibility_scope text,owner_staff_id bigint);
    CREATE TABLE crm_audit_events(actor_admin_id bigint,action text,entity_type text,entity_id bigint,metadata jsonb);
    CREATE TABLE payment_receipts(id bigint PRIMARY KEY,appointment_id bigint,amount numeric);
    INSERT INTO crm_v2_clients VALUES(22,'Synthetic organiser','27820000022','active'),(23,'Other client','27820000023','active');
    INSERT INTO staff VALUES(7,'Synthetic therapist','active');
    INSERT INTO staff_admin_accounts VALUES(1,true,7,'owner','all_business','{"client:lookup":true}');
    INSERT INTO services VALUES(5,'Actual individual treatment'),(6,'Tenant private treatment');
    INSERT INTO appointments SELECT n,NULL,CASE WHEN n=4 THEN 23 ELSE 22 END,
      CASE WHEN n=3 THEN NOW()+interval '1 day' ELSE NOW()-interval '1 day' END,
      CASE WHEN n=3 THEN NOW()+interval '1 day 1 hour' ELSE NOW()-interval '23 hours' END,
      CASE WHEN n=2 THEN 'unknown' WHEN n=5 THEN 'no_show' WHEN n=8 THEN 'no_charge' ELSE 'completed' END FROM generate_series(1,8) n;
    INSERT INTO appointment_services SELECT n,n,CASE WHEN n=6 THEN 6 ELSE 5 END,'Actual individual treatment' FROM generate_series(1,8) n;
    INSERT INTO appointment_staff SELECT n,7,'Synthetic therapist' FROM generate_series(1,8) n;
    INSERT INTO service_visibility_policies VALUES(6,'tenant_private',7);
    INSERT INTO appointment_booking_approvals VALUES(7,'pending');
    INSERT INTO payment_receipts VALUES(1,1,300);
  `);
  await exec(fs.readFileSync(path.join(__dirname,'../migrations/163_client_planning_requests.sql'),'utf8'));
  await exec(fs.readFileSync(path.join(__dirname,'../migrations/194_planning_request_visit_resolution.sql'),'utf8'));
  const service=createClientPlanningRequestService({db});
  async function enquiry(){const r=await db.query(`INSERT INTO client_planning_requests(submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,special_occasion)
    VALUES($1,$2,22,'flexible','Couples Massage',false) RETURNING id,updated_at`,[crypto.randomUUID(),'a'.repeat(64)]);return{id:Number(r.rows[0].id),revision:new Date(r.rows[0].updated_at).toISOString()};}
  function input(row,action='attended',appointmentId=1){return{principal:owner,requestId:row.id,expectedRevision:row.revision,operationId:crypto.randomUUID(),action,confirmed:true,...(action==='attended'?{appointmentId}:{})};}
  const row=await enquiry();
  const visible=(await service.forReception(owner)).find(item=>Number(item.id)===row.id);
  assert.equal(visible.client_mobile,'27820000022');
  const protectedItem=(await service.forReception({...owner,permissions:{'client:lookup':false}})).find(item=>Number(item.id)===row.id);
  assert.equal(protectedItem.client_mobile,null);assert.equal(protectedItem.client_id,null);
  const options=await service.attendedAppointments({principal:owner,requestId:row.id});
  assert.deepEqual(options.appointments.map(a=>Number(a.id)).sort(),[1,8]);
  assert.equal(options.revision,row.revision);
  for(const appointmentId of [2,3,4,5,6,7])await assert.rejects(service.resolveCompletion(input(row,'attended',appointmentId)),{code:'PLANNING_VISIT_CHANGED'});
  await assert.rejects(service.resolveCompletion({...input(row),confirmed:false}),{code:'PLANNING_RESOLUTION_INVALID'});
  await assert.rejects(service.resolveCompletion({...input(row),expectedRevision:'2020-01-01'}),{code:'PLANNING_STALE_REVISION'});
  await assert.rejects(service.resolveCompletion({...input(row),principal:{id:1,business_role:'tenant_practitioner',calendar_scope:'all_business'}}),{code:'PLANNING_FORBIDDEN'});
  await db.query('UPDATE staff_admin_accounts SET permissions=$1::jsonb',[JSON.stringify({'booking_requests:manage':false})]);
  await assert.rejects(service.resolveCompletion(input(row)),{code:'PLANNING_FORBIDDEN'});
  await db.query('UPDATE staff_admin_accounts SET permissions=$1::jsonb',[JSON.stringify({'client:lookup':true})]);
  await exec("UPDATE staff SET status='inactive'");
  await assert.rejects(service.resolveCompletion(input(row)),{code:'PLANNING_FORBIDDEN'});
  await exec("UPDATE staff SET status='active'");
  const appointmentsBefore=(await db.query('SELECT * FROM appointments ORDER BY id')).rows;
  const paymentsBefore=(await db.query('SELECT * FROM payment_receipts')).rows;
  const accepted=input(row);
  assert.deepEqual(await service.resolveCompletion(accepted),{id:row.id,status:'attended',replayed:false});
  assert.equal((await service.resolveCompletion(accepted)).replayed,true);
  await assert.rejects(service.resolveCompletion({...accepted,appointmentId:8}),{code:'PLANNING_STALE_REVISION'});
  const cancelled=await enquiry(),cancelInput=input(cancelled,'cancelled');
  await service.resolveCompletion(cancelInput);
  assert.equal((await service.resolveCompletion(cancelInput)).replayed,true);
  const active=(await service.forReception(owner)).map(r=>Number(r.id));
  assert.ok(!active.includes(row.id)&&!active.includes(cancelled.id));
  const history=await service.forClient(22);
  assert.ok(history.some(r=>r.status==='attended')&&history.some(r=>r.status==='cancelled'));
  const clientHtml=renderPlanningRequestPage({requests:history});
  assert.match(clientHtml,/Cancelled at your request/);assert.match(clientHtml,/visit was already attended/);
  assert.deepEqual((await db.query('SELECT * FROM appointments ORDER BY id')).rows,appointmentsBefore);
  assert.deepEqual((await db.query('SELECT * FROM payment_receipts')).rows,paymentsBefore);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_audit_events')).rows[0].n,2);
  assert.equal((await db.query('SELECT linked_appointment_id FROM client_planning_requests WHERE id=$1',[cancelled.id])).rows[0].linked_appointment_id,null);

  const failed=await enquiry();
  await exec(`CREATE FUNCTION refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
    CREATE TRIGGER refuse_audit BEFORE INSERT ON crm_audit_events FOR EACH ROW EXECUTE FUNCTION refuse_audit()`);
  await assert.rejects(service.resolveCompletion(input(failed,'cancelled')));
  assert.equal((await db.query('SELECT status,resolution_request_id FROM client_planning_requests WHERE id=$1',[failed.id])).rows[0].status,'requested');
  await exec('DROP TRIGGER refuse_audit ON crm_audit_events');
  const collision=await enquiry();
  await assert.rejects(service.resolveCompletion({...input(collision,'cancelled'),operationId:accepted.operationId}),{code:'PLANNING_OPERATION_CONFLICT'});
  assert.equal((await db.query('SELECT status FROM client_planning_requests WHERE id=$1',[collision.id])).rows[0].status,'requested');

  if(nativeUrl){
    const concurrent=await enquiry();
    const results=await Promise.allSettled([service.resolveCompletion(input(concurrent)),service.resolveCompletion(input(concurrent,'cancelled'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'PLANNING_STALE_REVISION');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_audit_events WHERE entity_id=$1',[concurrent.id])).rows[0].n,1);
    const replayRow=await enquiry(),retry=input(replayRow);
    const repeated=await Promise.all([service.resolveCompletion(retry),service.resolveCompletion(retry)]);
    assert.deepEqual(repeated.map(r=>r.replayed).sort(),[false,true]);
  }
});
