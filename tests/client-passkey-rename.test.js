'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {createClientPasskeyEnrollmentService}=require('../src/services/clientPasskeyEnrollment');
async function fixture(t){
 const h=await clientHarness(t),owner=await h.owner(),other=await h.owner({normalized_mobile:'27820000002'});
 async function key(clientId,bytes){return (await h.db.query(`INSERT INTO client_auth_passkey_credentials
  (crm_v2_client_id,credential_id,public_key_spki,algorithm,sign_count,transports,backed_up,device_label)
  VALUES($1,$2,$3,-7,17,'["internal"]',true,'Android device') RETURNING *`,[clientId,Buffer.alloc(24,bytes).toString('base64url'),Buffer.from('synthetic-public-key')])).rows[0];}
 const credential=await key(owner.id,1),otherCredential=await key(other.id,2);
 const issued=await h.sessions.issueVerifiedPasskeySession({transaction:h.db,crmV2ClientId:owner.id,passkeyCredentialId:credential.id});
 assert.equal(issued.ok,true);const session=await h.sessions.validateSessionToken(issued.sessionToken);
 const service=createClientPasskeyEnrollmentService({db:h.db,env:{SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'},now:h.now});
 return {...h,owner,other,credential,otherCredential,issued,session,enrollment:service,rename:input=>service.rename({session,credentialId:Number(credential.id),label:'Galaxy S25 Ultra',...input})};
}
test('rename updates only the owned display label, preserves sign-in and makes repeated saves idempotent',async t=>{
 const h=await fixture(t),sessions=(await h.db.query('SELECT * FROM client_browser_sessions')).rows;
 assert.deepEqual(await h.rename({label:'  Galaxy  S25 Ultra  '}),{ok:true,id:Number(h.credential.id),label:'Galaxy S25 Ultra'});
 const after=(await h.db.query('SELECT * FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0];
 assert.deepEqual({...after,device_label:h.credential.device_label},h.credential);
 assert.deepEqual((await h.db.query('SELECT * FROM client_browser_sessions')).rows,sessions);
 assert.equal((await h.sessions.validateSessionToken(h.issued.sessionToken)).ok,true);
 assert.equal((await h.rename()).ok,true);
 const events=(await h.db.query("SELECT metadata FROM client_auth_security_events WHERE event_type='passkey_label_updated'")).rows;
 assert.equal(events.length,1);assert.deepEqual(events[0].metadata,{credentialReference:`passkey:${h.credential.id}`});
 assert.deepEqual((await h.db.query('SELECT * FROM client_auth_passkey_credentials WHERE id=$1',[h.otherCredential.id])).rows[0],h.otherCredential);
});
test('blank, invalid and overlong names cannot mutate credentials',async t=>{
 const h=await fixture(t);
 for(const label of [undefined,null,[],{},'', '   ','\u0000\n','X'.repeat(49)])assert.equal((await h.rename({label})).code,'CLIENT_PASSKEY_LABEL_INVALID');
 for(const credentialId of [0,-1,'1',null,1.5])assert.equal((await h.rename({credentialId})).code,'CLIENT_PASSKEY_LABEL_INVALID');
 assert.deepEqual((await h.db.query('SELECT * FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0],h.credential);
});
test('labels are plain text and accept the existing 48-character limit without changing key material',async t=>{
 const h=await fixture(t);
 assert.equal((await h.rename({label:'A'.repeat(48)})).ok,true);
 assert.equal((await h.rename({label:'<b>My phone</b>'})).label,'<b>My phone</b>');
 assert.equal((await h.db.query('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0].device_label,'<b>My phone</b>');
});
test('another account, a revoked key or a forged client identity cannot rename a credential',async t=>{
 const h=await fixture(t);
 assert.equal((await h.rename({credentialId:Number(h.otherCredential.id)})).code,'CLIENT_PASSKEY_INVALID');
 assert.equal((await h.rename({session:{...h.session,crmV2ClientId:Number(h.other.id)}})).code,'CLIENT_RECENT_AUTH_REQUIRED');
 await h.db.query('UPDATE client_auth_passkey_credentials SET revoked_at=$2 WHERE id=$1',[h.credential.id,h.now()]);
 assert.equal((await h.rename()).code,'CLIENT_PASSKEY_INVALID');
 assert.equal((await h.db.query('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0].device_label,'Android device');
});
for(const state of ['expired','revoked','archived'])test(`rename refuses a ${state} account/session`,async t=>{
 const h=await fixture(t);
 if(state==='expired')h.advance(31*86400000);
 if(state==='revoked')await h.db.query('UPDATE client_browser_sessions SET revoked_at=$2 WHERE id=$1',[h.session.sessionId,h.now()]);
 if(state==='archived')await h.db.query("UPDATE crm_v2_clients SET status='archived' WHERE id=$1",[h.owner.id]);
 assert.equal((await h.rename()).code,'CLIENT_RECENT_AUTH_REQUIRED');
 assert.equal((await h.db.query('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0].device_label,'Android device');
});
test('rename rechecks session expiry after waiting for the owned credential lock',async t=>{
 const h=await fixture(t),base=h.db.query.bind(h.db);let advanced=false;
 const db={query:base,async connect(){const c=await h.db.connect();return {async query(sql,args){const r=await c.query(sql,args);if(!advanced&&/SELECT id,device_label FROM client_auth_passkey_credentials/.test(sql)){advanced=true;h.advance(31*86400000);}return r;},release:()=>c.release()};}};
 const service=createClientPasskeyEnrollmentService({db,env:{SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'},now:h.now});
 assert.equal((await service.rename({session:h.session,credentialId:Number(h.credential.id),label:'New name'})).code,'CLIENT_RECENT_AUTH_REQUIRED');
 assert.equal((await base('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0].device_label,'Android device');
});

test('rename rolls back the label when its audit write fails',async t=>{
 const h=await fixture(t);
 const db={query:h.db.query.bind(h.db),async connect(){const c=await h.db.connect();return {async query(sql,args){if(/INSERT INTO client_auth_security_events/.test(sql))throw Error('SYNTHETIC_AUDIT_FAILURE');return c.query(sql,args);},release:()=>c.release()};}};
 const service=createClientPasskeyEnrollmentService({db,env:{SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'},now:h.now});
 await assert.rejects(()=>service.rename({session:h.session,credentialId:Number(h.credential.id),label:'New name'}),/SYNTHETIC_AUDIT_FAILURE/);
 assert.equal((await h.db.query('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[h.credential.id])).rows[0].device_label,'Android device');
 assert.equal(Number((await h.db.query("SELECT count(*) AS n FROM client_auth_security_events WHERE event_type='passkey_label_updated'")).rows[0].n),0);
});

test('HTTP rename requires own session, same origin and CSRF, ignores supplied owner and stays private',async t=>{
 const h=await fixture(t),express=require('express');
 const {createMyShilohRouter}=require('../src/routes/myShiloh');
 const app=express();app.use(express.json());app.use(createMyShilohRouter({env:{NODE_ENV:'test'},sessionService:h.sessions,passkeyEnrollmentService:h.enrollment,voucherService:{async syncRecipientLinks(){}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const headers={origin,'content-type':'application/json',cookie:`shiloh_client_session=${h.issued.sessionToken}`,'x-shiloh-csrf-token':h.issued.csrfToken};
 const body={credentialId:Number(h.credential.id),label:'My Samsung phone'};
 async function post(data=body,overrides={}){return fetch(origin+'/my-shiloh/auth/passkeys/devices/rename',{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(data)});}
 assert.equal((await post(body,{cookie:''})).status,401);
 assert.equal((await post(body,{'x-shiloh-csrf-token':''})).status,403);
 assert.equal((await post(body,{origin:'https://unrelated.example'})).status,403);
 assert.equal((await post({...body,credentialId:Number(h.otherCredential.id),crmV2ClientId:Number(h.other.id)})).status,404);
 assert.equal((await post({...body,label:''})).status,400);
 const r=await post();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private/);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.deepEqual(await r.json(),{renamed:true,label:'My Samsung phone'});
 assert.equal((await h.sessions.validateSessionToken(h.issued.sessionToken)).ok,true);
 assert.deepEqual((await h.db.query('SELECT * FROM client_auth_passkey_credentials WHERE id=$1',[h.otherCredential.id])).rows[0],h.otherCredential);
});
