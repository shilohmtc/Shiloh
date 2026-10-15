'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createBookingSubmissionIncidentService,attemptContext,UUID } = require('../src/services/bookingSubmissionIncidents');

async function fixture(t) {
  let db,recordDb,close;
  if (process.env.TEST_BOOKING_INCIDENT_DATABASE_URL) {
    const { Client,Pool } = require('pg');
    const connectionString=process.env.TEST_BOOKING_INCIDENT_DATABASE_URL;
    const admin=new Client({connectionString});await admin.connect();
    const schema='booking_incident_test_'+process.pid;
    await admin.query(`CREATE SCHEMA ${schema}`);
    db=new Pool({connectionString,options:`-c search_path=${schema}`});
    db.exec=(...args)=>db.query(...args);
    recordDb=new Pool({connectionString,options:`-c search_path=${schema}`,max:1,connectionTimeoutMillis:250,query_timeout:500,statement_timeout:450});
    close=async()=>{await db.end();await recordDb.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();};
  } else {
    const pg=new PGlite();
    db={exec:sql=>pg.exec(sql),query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
    recordDb=db;close=()=>pg.close();
  }
  t.after(close);
  await db.exec(`CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE staff(id BIGINT PRIMARY KEY,status TEXT);
    CREATE TABLE staff_admin_accounts(id BIGINT PRIMARY KEY,staff_id BIGINT,display_name TEXT,permissions JSONB,business_role TEXT,active BOOLEAN);
    CREATE TABLE crm_v2_client_relationships(client_id BIGINT,relationship_type TEXT,owner_staff_id BIGINT,status TEXT);
    CREATE TABLE crm_audit_events(id BIGSERIAL PRIMARY KEY,actor_admin_id BIGINT,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id BIGINT,metadata JSONB,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT);
    CREATE TABLE payment_requests(id BIGINT PRIMARY KEY);
    INSERT INTO crm_v2_clients VALUES(1,'Synthetic clinic client','active'),(2,'Synthetic other client','active'),(3,'Synthetic private client','active');
    INSERT INTO crm_v2_client_relationships VALUES(1,'clinic',NULL,'active'),(2,'clinic',NULL,'active'),(3,'tenant_staff',40,'active');
    INSERT INTO staff VALUES(40,'active'),(41,'inactive');
    INSERT INTO staff_admin_accounts VALUES
      (10,NULL,'Synthetic Reception','{"client:lookup":true,"client:manage":true}','booking_operator',TRUE),
      (11,NULL,'Synthetic read only','{"client:lookup":true}','business_admin',TRUE),
      (12,40,'Synthetic tenant','{"client:lookup":true,"client:manage":true}','tenant_practitioner',TRUE),
      (13,41,'Synthetic inactive staff','{"client:lookup":true,"client:manage":true}','owner',TRUE),
      (14,NULL,'Synthetic disabled','{"client:lookup":true,"client:manage":true}','owner',FALSE),
      (15,NULL,'Synthetic no permission','{}','owner',TRUE);`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/196_booking_submission_incidents.sql'),'utf8'));
  let clock=new Date('2026-10-15T11:42:07Z');
  const service=createBookingSubmissionIncidentService({db,recordDb,now:()=>clock});
  const context=(extra={})=>attemptContext({clientId:1,kind:'ordinary',attemptKey:randomUUID(),payload:{serviceId:7,startsAt:'2030-01-02T08:00:00Z',policyAccepted:true},...extra});
  return {db,recordDb,service,context,setClock:value=>{clock=new Date(value);}};
}

test('short-lived booking support is separate from booking and client-message authorities',async t=>{
  const {db,recordDb,service,context,setClock}=await fixture(t);
  let first,ctx;
  await t.test('rollback leaves no booking/payment, but a grouped support link survives',async()=>{
    ctx=context();
    const booking=await db.connect();await booking.query('BEGIN');
    await booking.query('INSERT INTO appointments VALUES(50,1)');
    if (process.env.TEST_BOOKING_INCIDENT_DATABASE_URL) {
      // A second real PG connection commits this while the booking TX is still open.
      first=await service.failure(ctx,Object.assign(new Error('synthetic private payload'),{code:'42P08'}));
      assert.equal(first.linkSaved,true);
    }
    await booking.query('ROLLBACK');booking.release();
    first ||= await service.failure(ctx,Object.assign(new Error('synthetic private payload'),{code:'42P08'}));
    assert.equal(first.linkSaved,true);assert.match(first.reference,UUID);
    const again=await service.failure(ctx,{code:'ECONNRESET'});
    assert.equal(again.reference,first.reference);
    assert.equal((await db.query('SELECT * FROM booking_submission_incidents')).rows[0].failure_count,2);
    assert.equal((await db.query('SELECT * FROM appointments')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM payment_requests')).rows.length,0);
  });
  await t.test('exact successful retry only; other client, kind, token, inputs or an unrelated appointment cannot clear it',async()=>{
    const success={status:'pending_resolution',appointmentId:51};
    await db.query('INSERT INTO appointments VALUES(51,1)');
    for (const candidate of [{...ctx,clientId:2},{...ctx,kind:'multiple'},{...ctx,attemptKey:randomUUID()},context({attemptKey:ctx.attemptKey,payload:{serviceId:8}})]) assert.equal(await service.success(candidate,success),false);
    for (const result of [null,{status:'failed',appointmentId:51},{status:'pending_resolution'}, {status:'pending_resolution',appointmentIds:[]}]) assert.equal(await service.success(ctx,result),false);
    assert.equal((await service.list({adminId:10})).items[0].status,'needs_help');
    assert.equal(await service.success(ctx,success),true);
    assert.equal((await service.list({adminId:10})).items[0].status,'retry_succeeded');
    assert.equal(await service.success(ctx,success),false);
    // A later failure for the same exact attempt is conservatively reopened.
    assert.equal((await service.failure(ctx,{})).reference,first.reference);
    assert.equal((await service.list({adminId:10})).items[0].status,'needs_help');
  });
  await t.test('client access is rechecked, scoped and audited; resolution uses a locked revision',async()=>{
    for (const adminId of [0,12,13,14,15,99]) {
      await assert.rejects(service.list({adminId}),{httpStatus:403});
      await assert.rejects(service.openClient({adminId,reference:first.reference}),{httpStatus:403});
      await assert.rejects(service.resolve({adminId,reference:first.reference,revision:'4'}),{httpStatus:403});
    }
    const row=(await service.list({adminId:11})).items[0];assert.equal(row.canResolve,false);
    await assert.rejects(service.resolve({adminId:11,reference:first.reference,revision:row.revision}),{httpStatus:403});
    assert.deepEqual(await service.openClient({adminId:10,reference:first.reference}),{href:'/calendar/clients/1'});
    await assert.rejects(service.resolve({adminId:10,reference:first.reference,revision:'999'}),{httpStatus:409});
    await service.resolve({adminId:10,reference:first.reference,revision:row.revision});
    await assert.rejects(service.resolve({adminId:10,reference:first.reference,revision:row.revision}),{httpStatus:409});
    const audits=(await db.query('SELECT * FROM crm_audit_events')).rows;
    assert.equal(audits.filter(x=>x.action==='booking_problem.resolved').length,1);
    assert.ok(audits.some(x=>x.action==='booking_problem.client_opened'));
    for (const row of audits) {assert.equal(row.entity_id,null);assert.equal(Number(row.actor_admin_id)===10||Number(row.actor_admin_id)===11,true);assert.equal(JSON.stringify(row.metadata).includes(ctx.attemptKey),false);}
    const privateIncident=await service.failure(context({clientId:3}),{});
    assert.equal((await service.list({adminId:10})).items.length,1);
    await assert.rejects(service.openClient({adminId:10,reference:privateIncident.reference}),{httpStatus:404});
    await db.query("UPDATE crm_v2_client_relationships SET status='inactive' WHERE client_id=1");
    await assert.rejects(service.resolve({adminId:10,reference:first.reference,revision:'5'}),{httpStatus:404});
    await db.query("UPDATE crm_v2_client_relationships SET status='active' WHERE client_id=1");
  });
  await t.test('audit failure rolls resolution back atomically',async()=>{
    const c=context();const incident=await service.failure(c,{});
    await db.query("ALTER TABLE crm_audit_events ADD CONSTRAINT synthetic_audit_failure CHECK(action<>'booking_problem.resolved') NOT VALID");
    await assert.rejects(service.resolve({adminId:10,reference:incident.reference,revision:'1'}));
    assert.equal((await db.query('SELECT status FROM booking_submission_incidents WHERE reference=$1',[incident.reference])).rows[0].status,'needs_help');
    await db.query('ALTER TABLE crm_audit_events DROP CONSTRAINT synthetic_audit_failure');
  });
  await t.test('payloads never enter storage; changed input/key/client makes separate incidents',async()=>{
    const token=randomUUID(),payload={occasionNote:'PRIVATE_HEALTH_CANARY',guest:{name:'PRIVATE_NAME_CANARY',mobile:'0820000001'},dob:'1980-01-01',credential:'PRIVATE_SECRET_CANARY',payment:'PRIVATE_PAYMENT_CANARY'};
    const a=context({attemptKey:token,payload}),b=context({attemptKey:token,payload:{...payload,occasionNote:'changed'}});
    const saved=await service.failure(a,{code:'PRIVATE_CODE_CANARY',message:'PRIVATE_ERROR_CANARY'});
    assert.equal((await service.failure(context({attemptKey:token,payload:Object.fromEntries(Object.entries(payload).reverse())}),{})).reference,saved.reference);
    assert.notEqual((await service.failure(b,{})).reference,saved.reference);
    assert.notEqual((await service.failure(context({clientId:2,attemptKey:token,payload}),{})).reference,saved.reference);
    assert.notEqual((await service.failure(context({payload}),{})).reference,saved.reference);
    const stored=JSON.stringify((await db.query('SELECT * FROM booking_submission_incidents')).rows);
    for (const canary of ['PRIVATE_','0820000001','1980-01-01']) assert.equal(stored.includes(canary),false);
  });
  await t.test('database outage returns a random reference without claiming a saved link or masking success',async()=>{
    const outage=createBookingSubmissionIncidentService({db,recordDb:{query:async()=>{throw new Error('PRIVATE_OUTAGE_CANARY');}}});
    const failed=await outage.failure(ctx,{});assert.equal(failed.linkSaved,false);assert.match(failed.reference,UUID);
    assert.equal(await outage.success(ctx,{status:'pending_resolution',appointmentId:51}),false);
    // Recovery of the database alone is not evidence of a successful booking.
    assert.equal((await service.list({adminId:10})).pendingCount>0,true);
    assert.ok(recordDb);
  });
  await t.test('pagination and filters retain access to recent recovered/resolved items',async()=>{
    for(let i=0;i<27;i++)await service.failure(context(),{});
    const a=await service.list({adminId:10});const b=await service.list({adminId:10,offset:25});
    assert.equal(a.items.length,25);assert.equal(a.hasMore,true);assert.ok(b.items.length);
    assert.equal(a.items.some(x=>b.items.some(y=>y.reference===x.reference)),false);
    const resolved=await service.list({adminId:10,status:'resolved'});assert.equal(resolved.items.length,1);
    assert.equal(resolved.items[0].reference,first.reference);
  });
  if (process.env.TEST_BOOKING_INCIDENT_DATABASE_URL) await t.test('real independent connections group concurrent failures and serialize staff decisions; recorder SQL has a hard deadline',async()=>{
    const parallel=createBookingSubmissionIncidentService({db,recordDb:db,now:()=>new Date('2026-10-15T11:42:07Z')});
    const same=context();const [a,b]=await Promise.all([service.failure(same,{}),parallel.failure(same,{})]);
    assert.equal(a.reference,b.reference);
    const row=(await db.query('SELECT * FROM booking_submission_incidents WHERE reference=$1',[a.reference])).rows[0];assert.equal(row.failure_count,2);
    const results=await Promise.allSettled([service.resolve({adminId:10,reference:a.reference,revision:row.revision}),parallel.resolve({adminId:10,reference:a.reference,revision:row.revision})]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.httpStatus,409);
    const bounded=createBookingSubmissionIncidentService({db,recordDb:{query:()=>recordDb.query('SELECT pg_sleep(2)')}});
    const start=Date.now();const timeout=await bounded.failure(context(),{});assert.equal(timeout.linkSaved,false);assert.match(timeout.reference,UUID);assert.ok(Date.now()-start<1500);
  });
  await t.test('14-day fixed expiry denies reads/updates before hourly physical purge; audit retains no client mapping',async()=>{
    setClock('2026-10-29T11:42:07Z');
    assert.equal((await service.list({adminId:10})).items.length,0);
    await assert.rejects(service.openClient({adminId:10,reference:first.reference}),{httpStatus:404});
    await assert.rejects(service.resolve({adminId:10,reference:first.reference,revision:'5'}),{httpStatus:404});
    assert.equal((await service.failure(ctx,{})).linkSaved,false);
    assert.equal(await service.success(ctx,{status:'pending_resolution',appointmentId:51}),false);
    await service.expire();assert.equal((await db.query('SELECT * FROM booking_submission_incidents')).rows.length,0);
    for (const row of (await db.query('SELECT metadata FROM crm_audit_events')).rows) assert.equal(/client|attempt|fingerprint|appointment|phone|name/i.test(JSON.stringify(row.metadata)),false);
  });
});
