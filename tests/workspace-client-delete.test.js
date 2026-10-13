const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceClientMutationService, clientRelationshipRevision } = require('../src/services/workspaceClientMutations');
async function fixture(t, role = 'owner') {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE staff(id BIGINT PRIMARY KEY,status TEXT);
    CREATE TABLE staff_admin_accounts(id BIGINT PRIMARY KEY,staff_id BIGINT,display_name TEXT,permissions JSONB,business_role TEXT,active BOOLEAN);
    INSERT INTO staff VALUES(7,'active');
    CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,normalized_mobile TEXT,date_of_birth DATE,gender TEXT,profile_status TEXT,mobile_verified_at TIMESTAMPTZ,source TEXT,status TEXT,provenance JSONB,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
    CREATE TABLE crm_v2_client_relationships(id BIGINT PRIMARY KEY,client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE CASCADE,relationship_type TEXT,owner_staff_id BIGINT,status TEXT,source TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
    CREATE TABLE booking_intents(phone TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE RESTRICT);
    CREATE TABLE retained_notes(id BIGINT PRIMARY KEY,client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE CASCADE);
    CREATE TABLE retained_receipts(id BIGINT PRIMARY KEY,client_id BIGINT REFERENCES crm_v2_clients(id) ON DELETE SET NULL);
    CREATE TABLE staff_auth_security_events(id BIGINT GENERATED ALWAYS AS IDENTITY,event_type TEXT,operator_admin_id BIGINT,subject_admin_id BIGINT,auth_method TEXT,reason TEXT,request_fingerprint_hash TEXT,metadata JSONB);
    INSERT INTO crm_v2_clients VALUES(912,'Synthetic Client','27821234567',NULL,NULL,'minimal',NULL,'staff','active','{}',NOW(),NOW());
    INSERT INTO crm_v2_client_relationships VALUES(1,912,'clinic',NULL,'active','staff',NOW(),NOW());`);
  await pg.query('INSERT INTO staff_admin_accounts VALUES(41,7,$1,$2,$3,TRUE)', ['Synthetic Operator',JSON.stringify({'client:manage':true,'client:lookup':true,'client:delete':true}),role]);
  const query = async (sql, values=[]) => { const r = await pg.query(sql,values); return {...r,rowCount:r.rows.length||r.affectedRows||0}; };
  const db = { query, connect: async () => ({query,release(){}}) };
  const row = (await query('SELECT * FROM crm_v2_clients WHERE id=912')).rows[0];
  const payload = {adminId:41,clientId:912,expectedRevision:clientRelationshipRevision(row,'active'),requestId:'delete_test_1234',confirmation:'DELETE'};
  return {pg,query,db,payload,service:createWorkspaceClientMutationService({db})};
}
test('permanent deletion removes only the unlinked profile and clinic relationship; audited retry remains exact', async t => {
  const f = await fixture(t);
  const result = await f.service.deleteClient(f.payload);
  assert.equal(result.status,'deleted');
  assert.equal((await f.query('SELECT * FROM crm_v2_clients')).rows.length,0);
  assert.equal((await f.query('SELECT * FROM crm_v2_client_relationships')).rows.length,0);
  const audit = (await f.query('SELECT * FROM staff_auth_security_events')).rows[0];
  assert.equal(audit.event_type,'workspace_client_deleted');
  assert.doesNotMatch(JSON.stringify(audit),/Synthetic Client|27821234567/);
  assert.equal((await f.service.deleteClient(f.payload)).replayed,true);
  await assert.rejects(f.service.deleteClient({...f.payload,clientId:999}), e=>e.code==='WORKSPACE_CLIENT_REPLAY_MISMATCH');
  await f.query("UPDATE staff_admin_accounts SET business_role='employee_practitioner'");
  await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_FORBIDDEN');
});
test('missing confirmation, stale revision, scoped-out client and non-admin fail without deletion', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.deleteClient({...f.payload,confirmation:undefined}),e=>e.code==='WORKSPACE_CLIENT_DELETE_CONFIRMATION');
  await assert.rejects(f.service.deleteClient({...f.payload,expectedRevision:'a'.repeat(64)}),e=>e.code==='WORKSPACE_CLIENT_STALE_REVISION');
  await assert.rejects(f.service.deleteClient({...f.payload,clientId:999}),e=>e.code==='WORKSPACE_CLIENT_NOT_FOUND');
  await f.query("UPDATE staff_admin_accounts SET permissions=permissions-'client:delete'");
  await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_FORBIDDEN');
  await f.query("UPDATE staff_admin_accounts SET business_role='tenant_practitioner'");
  await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_FORBIDDEN');
  assert.equal((await f.query('SELECT * FROM crm_v2_clients')).rows.length,1);
});
for (const [table,column] of [['appointments','crm_v2_client_id'],['retained_notes','client_id'],['retained_receipts','client_id']]) {
  test(`linked ${table} blocks deletion even with CASCADE or SET NULL; all records remain`,async t=>{
    const f=await fixture(t); await f.query(`INSERT INTO ${table}(id,${column}) VALUES(1,912)`);
    await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_LINKED');
    assert.equal((await f.query('SELECT * FROM crm_v2_clients')).rows.length,1);
    assert.equal((await f.query(`SELECT ${column} FROM ${table}`)).rows[0][column],912);
    assert.equal((await f.query('SELECT * FROM staff_auth_security_events')).rows.length,0);
  });
}
test('another client relationship and unfinished draft are preserved and block permanent deletion',async t=>{
  const f=await fixture(t);
  await f.query("INSERT INTO crm_v2_client_relationships VALUES(2,912,'tenant_staff',55,'archived','staff',NOW(),NOW())");
  await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_SHARED');
  await f.query('DELETE FROM crm_v2_client_relationships WHERE id=2');
  await f.query("INSERT INTO booking_intents VALUES('27821234567','collecting')");
  await assert.rejects(f.service.deleteClient(f.payload),e=>e.code==='WORKSPACE_CLIENT_DELETE_DRAFT');
  assert.equal((await f.query('SELECT * FROM booking_intents')).rows.length,1);
});
test('audit failure rolls back profile deletion and relationship cascade',async t=>{
  const f=await fixture(t);
  const original=f.db.connect;
  f.db.connect=async()=>{const c=await original();return {...c,query:async(sql,v)=>{if(sql.startsWith('INSERT INTO staff_auth_security_events'))throw Error('Synthetic audit failure');return c.query(sql,v);}};};
  await assert.rejects(f.service.deleteClient(f.payload),/audit failure/);
  assert.equal((await f.query('SELECT * FROM crm_v2_clients')).rows.length,1);
  assert.equal((await f.query('SELECT * FROM crm_v2_client_relationships')).rows.length,1);
});
test('delete route binds the staff actor and requires session, same origin, CSRF and explicit body fields',async t=>{
  const express=require('express');
  const {createWorkspaceClientMutationRouter}=require('../src/routes/workspaceClientMutations');
  const calls=[];
  const app=express(); app.use(express.json());
  const env={SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'};
  app.use('/calendar/clients',createWorkspaceClientMutationRouter({env,sessionService:{validateSessionToken:async token=>({ok:token==='synthetic',adminId:41}),validateCsrfToken:(_session,token)=>token==='csrf'},service:{deleteClient:async payload=>{calls.push(payload);return{status:'deleted',clientId:912};}}}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());
  await new Promise(r=>server.once('listening',r)); const origin=`http://127.0.0.1:${server.address().port}`;
  const body={requestId:'delete_route_1234',expectedRevision:'a'.repeat(64),confirmation:'DELETE'};
  const send=(headers={},payload=body)=>fetch(origin+'/calendar/clients/912/delete',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:'shiloh_staff_session=synthetic','X-Shiloh-Csrf-Token':'csrf',...headers},body:JSON.stringify(payload)});
  assert.equal((await send({Origin:'https://other.invalid'})).status,403);
  assert.equal((await send({Cookie:''})).status,401);
  assert.equal((await send({'X-Shiloh-Csrf-Token':''})).status,403);
  assert.equal((await send({}, {...body,adminId:999})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await send()).status,200);
  assert.deepEqual(calls,[{adminId:41,clientId:'912',...body}]);
});
