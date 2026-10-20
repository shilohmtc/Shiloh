'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {createAuthInvitations}=require('../src/services/authInvitations');
test('client code sign-in keeps fixed 30-day sessions and invalidates canonical identity drift',async t=>{
  const h=await clientHarness(t);await h.owner();const r=await h.service.begin(h.context);assert.equal(h.sent.length,0);await h.service.dispatchOne();
  const result=await h.service.verify({...h.context,request:r.request,code:h.sent[0].code});assert.equal(result.ok,true);
  const session=await h.sessions.validateSessionToken(result.sessionToken);assert.equal(session.ok,true);assert.equal(session.authMethod,'whatsapp_challenge');
  assert.equal(new Date(result.expiresAt)-new Date(session.issuedAt),30*86400000);
  assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
  await h.db.query("UPDATE crm_v2_clients SET normalized_mobile='27820000009'");assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,false);
});
test('registration requires phone proof and creates through canonical CRM only after profile and conflict checks',async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'register'},r=await h.service.begin(input);await h.service.dispatchOne();
  assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,0);
  const proof=await h.service.verify({...input,request:r.request,code:h.sent[0].code});assert.equal(proof.profileRequired,true);
  const profile={firstName:'Synthetic',surname:'Client',dateOfBirth:'1990-01-01',gender:'female',mobile:'27820000009'};
  assert.equal((await h.service.completeRegistration({...input,grant:proof.grant,profile:{...profile,dateOfBirth:'invalid'}})).ok,false);
  assert.equal((await h.service.completeRegistration({...input,browserToken:'X'.repeat(43),grant:proof.grant,profile})).ok,false);
  const result=await h.service.completeRegistration({...input,grant:proof.grant,profile});assert.equal(result.ok,true);
  const owner=(await h.db.query('SELECT * FROM crm_v2_clients')).rows[0];assert.equal(owner.normalized_mobile,input.mobile);assert.ok(owner.mobile_verified_at);assert.equal(owner.first_name,'Synthetic');
  assert.equal((await h.service.completeRegistration({...input,grant:proof.grant,profile})).ok,false);
});
test('legacy signin/register purposes keep their original eligibility during queued-code compatibility',async t=>{
  const h=await clientHarness(t);await h.owner({mobile_verified_at:null});
  for(const purpose of ['signin','register']){await h.service.begin({...h.context,purpose});await h.service.dispatchOne();}assert.equal(h.sent.length,0);
  await h.db.query("UPDATE crm_v2_clients SET status='archived',mobile_verified_at=NOW()");await h.service.begin({...h.context,purpose:'register'});await h.service.dispatchOne();assert.equal(h.sent.length,0);
});
test('client fallback waits for expiry, revokes old code, and daily limits survive restart',async t=>{
  const h=await clientHarness(t);await h.owner();let r=await h.service.begin(h.context);await h.service.dispatchOne();
  await h.service.requestSmsFallback({...h.context,request:r.request});assert.equal((await h.service.dispatchOne()).processed,false);
  h.advance(300000);await h.service.requestSmsFallback({...h.context,request:r.request});await h.service.dispatchOne();assert.equal(h.sms.length,1);
  assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
  assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sms[0].code})).ok,true);
  h.advance(60000);r=await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,2);
  h.advance(60000);await h.make().begin({...h.context,purpose:'register'});await h.make().dispatchOne();assert.equal(h.sent.length,2);
  await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,2);
});
test('concurrent verification and changed ownership fail closed; optional invitations repeat only on a new session',async t=>{
  const h=await clientHarness(t);await h.owner();const r=await h.service.begin(h.context);await h.service.dispatchOne();
  const results=await Promise.all([1,2,3].map(()=>h.service.verify({...h.context,request:r.request,code:h.sent[0].code})));
  assert.equal(results.filter(x=>x.ok).length,1);
  const session=await h.sessions.validateSessionToken(results.find(x=>x.ok).sessionToken),invites=createAuthInvitations({db:h.db,audience:'client'});
  assert.equal((await invites.visit(session)).show,true);assert.equal((await invites.visit(session)).show,false);
  h.advance(60000);const next=await h.service.begin(h.context);await h.service.dispatchOne();const login=await h.service.verify({...h.context,request:next.request,code:h.sent.at(-1).code});
  assert.equal((await invites.visit(await h.sessions.validateSessionToken(login.sessionToken))).show,true);
});

test('public client intake never performs an identity lookup or provider I/O',async()=>{
  const {createClientCodeAuth}=require('../src/services/clientCodeAuth');let queued=0;
  const service=createClientCodeAuth({enabled:true,hmacKey:Buffer.alloc(32,9),delivery:{audience:'client',configured:()=>true,readiness(){throw Error('public provider call');}},
    store:{transaction:fn=>fn({takeRate:async()=>true,insert:async()=>queued++,identity(){throw Error('public identity lookup');}})}});
  for(const mobile of ['invalid','27820000001','27820000009'])assert.equal((await service.begin({mobile,purpose:'signin',browserToken:'B'.repeat(43),network:'192.0.2.1'})).accepted,true);
  assert.equal(queued,3);
});

test('client cooldown is durable across purposes and restart; wrong browser, purpose and five attempts fail',async t=>{
  const h=await clientHarness(t);await h.owner();const first=await h.service.begin(h.context);await h.service.dispatchOne();
  const second=await h.make().begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,1);
  h.advance(59999);assert.equal((await h.make().dispatchOne()).processed,false);h.advance(1);await h.make().dispatchOne();assert.equal(h.sent.length,2);
  assert.equal((await h.service.verify({...h.context,request:first.request,code:h.sent[0].code})).ok,false);
  assert.equal((await h.service.verify({...h.context,request:second.request,code:h.sent[1].code,browserToken:'X'.repeat(43)})).ok,false);
  assert.equal((await h.service.verify({...h.context,purpose:'register',request:second.request,code:h.sent[1].code})).ok,false);
  for(let i=0;i<5;i++)assert.equal((await h.service.verify({...h.context,request:second.request,code:'bad'})).ok,false);
  assert.equal((await h.service.verify({...h.context,request:second.request,code:h.sent[1].code})).ok,false);
});

test('uncertain client delivery cannot trigger another send before expiry, even across requests',async t=>{
  const h=await clientHarness(t);await h.owner();h.outcome('uncertain');const r=await h.service.begin(h.context);await h.service.dispatchOne();
  await h.service.requestSmsFallback({...h.context,request:r.request});await h.make().dispatchOne();assert.equal(h.sms.length,0);
  h.advance(60000);await h.service.begin(h.context);await h.make().dispatchOne();assert.equal(h.sent.length,1);
  const rows=(await h.db.query('SELECT payload FROM client_code_records')).rows;
  for(const secret of [h.context.mobile,h.context.browserToken,r.request,h.sent[0].code])assert.equal(JSON.stringify(rows).includes(secret),false);
});

test('registration conflict after phone proof cannot create, update or merge an existing profile',async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'register'},r=await h.service.begin(input);await h.service.dispatchOne();
  const grant=await h.service.verify({...input,request:r.request,code:h.sent[0].code});await h.owner({name:'Existing protected profile'});
  const result=await h.service.completeRegistration({...input,grant:grant.grant,profile:{firstName:'New',surname:'Person',dateOfBirth:'1990-01-01',gender:'female'}});
  assert.equal(result.ok,false);assert.equal((await h.db.query('SELECT name FROM crm_v2_clients')).rows[0].name,'Existing protected profile');
  assert.equal((await h.db.query('SELECT * FROM client_browser_sessions')).rows.length,0);
});

test('client audience has a separate durable fifty-code clinic ceiling',async t=>{
  const h=await clientHarness(t);
  for(let i=0;i<51;i++){
    await h.make().begin({...h.context,purpose:'register',mobile:'2782'+String(i).padStart(7,'0'),network:'198.51.100.'+i});await h.make().dispatchOne();
  }
  assert.equal(h.sent.length,50);
});

test('inactive client runtime refuses missing or staff-only template configuration without effects',()=>{
  const {createClientCodeRuntime}=require('../src/services/clientCodeRuntime');let calls=0;
  const runtime=createClientCodeRuntime({enabled:true,config:{reviewedForClients:true,template:{name:'shiloh_workspace_verification'}},db:{query(){calls++;},connect(){calls++;}}});
  assert.equal(runtime.service.enabled(),false);assert.equal(calls,0);
});

test('client HTTP flow requires same origin/browser binding, sets private cookies and never returns session tokens',async t=>{
  const express=require('express'),{createClientCodeRouter,BASE}=require('../src/routes/clientCodeAuth');
  const h=await clientHarness(t);await h.owner();const app=express();app.use(BASE,createClientCodeRouter({enabled:true,service:h.service,sessions:h.sessions,
    invitations:createAuthInvitations({db:h.db,audience:'client'})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,page=await fetch(origin+BASE+'/'),cookie=page.headers.get('set-cookie').split(';')[0];
  assert.match(page.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.match(page.headers.get('cache-control'),/no-store/);
  const post=(path,body,extra={})=>fetch(origin+BASE+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/start',h.context,{Origin:'https://evil.example'})).status,403);
  const request=await (await post('/start',{mobile:h.context.mobile,purpose:'signin'})).json();await h.service.dispatchOne();
  assert.equal((await post('/verify',{purpose:'signin',request:request.request,code:h.sent[0].code},{Cookie:''})).status,401);
  const response=await post('/verify',{purpose:'signin',request:request.request,code:h.sent[0].code});
  assert.equal((await response.json()).authenticated,true);assert.match(response.headers.get('set-cookie'),/shiloh_client_session=/);
  const sessionCookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/invitations/visit',{}, {Cookie:cookie+'; '+sessionCookie})).status,403);
});

test('notification invitations recognize only this account subscription and never a revoked registration',async t=>{
  const h=await clientHarness(t),owner=await h.owner(),invites=createAuthInvitations({db:h.db,audience:'client'});
  await h.db.query("INSERT INTO my_shiloh_push_subscriptions(crm_v2_client_id,endpoint,p256dh,auth) VALUES($1,'https://push.example.test/synthetic','synthetic','synthetic')",[owner.id]);
  const session={ok:true,sessionId:1,crmV2ClientId:owner.id};
  assert.equal((await invites.notificationStatus(session,'https://push.example.test/synthetic')).enabled,true);
  assert.equal((await invites.notificationStatus({...session,crmV2ClientId:999},'https://push.example.test/synthetic')).enabled,false);
  await h.db.query('UPDATE my_shiloh_push_subscriptions SET revoked_at=NOW()');
  assert.equal((await invites.notificationStatus(session,'https://push.example.test/synthetic')).enabled,false);
});

test('registration through SMS records SMS evidence without claiming a WhatsApp interaction',async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'register'};h.outcome('not_sent');
  const r=await h.service.begin(input);await h.service.dispatchOne();await h.service.requestSmsFallback({...input,request:r.request});
  h.advance(60000);h.outcome('accepted');await h.service.dispatchOne();assert.equal(h.sms.length,1);
  const proof=await h.service.verify({...input,request:r.request,code:h.sms[0].code});assert.equal(proof.profileRequired,true);
  const result=await h.service.completeRegistration({...input,grant:proof.grant,profile:{firstName:'Synthetic',surname:'Sms',dateOfBirth:'1990-01-01',gender:'female'}});
  assert.equal(result.ok,true);
  const row=(await h.db.query('SELECT source,provenance FROM crm_v2_clients')).rows[0];
  assert.equal(row.source,'my_shiloh_crm');assert.equal(row.provenance.registrationCompleted.via,'sms_code');
  assert.ok(row.provenance.lastVerifiedSmsCode);assert.equal(row.provenance.lastVerifiedWhatsAppInteraction,undefined);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).authMethod,'sms_code');
});


test('one client entry verifies an existing unverified/minimal owner without changing profile details',async t=>{
  const h=await clientHarness(t),before=await h.owner({mobile_verified_at:null,profile_status:'minimal',date_of_birth:null,gender:null});
  const input={...h.context,purpose:'continue'},r=await h.service.begin(input);
  assert.equal((await h.db.query('SELECT mobile_verified_at FROM crm_v2_clients')).rows[0].mobile_verified_at,null);
  await h.service.dispatchOne();assert.equal(h.sent.length,1);
  assert.equal((await h.service.verify({...input,request:r.request,code:'wrong'})).ok,false);
  assert.equal((await h.db.query('SELECT mobile_verified_at FROM crm_v2_clients')).rows[0].mobile_verified_at,null);
  const result=await h.service.verify({...input,request:r.request,code:h.sent[0].code});assert.equal(result.ok,true);
  const after=(await h.db.query('SELECT * FROM crm_v2_clients')).rows[0];
  for(const key of ['id','name','first_name','surname','date_of_birth','gender','profile_status','source','normalized_mobile'])assert.deepEqual(after[key],before[key]);
  assert.ok(after.mobile_verified_at);assert.ok(after.provenance.lastVerifiedWhatsAppInteraction);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,true);
  assert.equal((await h.service.verify({...input,request:r.request,code:h.sent[0].code})).ok,false);
});

test('one client entry reveals registration only after proof and cannot create a duplicate after ownership drift',async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'continue'},r=await h.service.begin(input);await h.service.dispatchOne();
  assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,0);
  const proof=await h.service.verify({...input,request:r.request,code:h.sent[0].code});assert.equal(proof.profileRequired,true);
  const result=await h.service.completeRegistration({...input,grant:proof.grant,profile:{firstName:'New',surname:'Client',dateOfBirth:'1990-01-01',gender:'female'}});
  assert.equal(result.ok,true);assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,1);
});

for(const kind of ['historical','archived','multiple'])test(`verified phone does not choose or expose a ${kind} profile`,async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'continue'};
  if(kind==='historical'){await h.db.query("INSERT INTO client_contacts(normalized_value,contact_type) VALUES($1,'mobile')",[input.mobile]);}
  if(kind==='archived')await h.owner({status:'archived'});
  if(kind==='multiple'){await h.owner({status:'archived'});await h.owner();}
  const r=await h.service.begin(input);await h.service.dispatchOne();assert.equal(h.sent.length,1);
  const before=(await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows;
  const proof=await h.service.verify({...input,request:r.request,code:h.sent[0].code});assert.deepEqual(proof,{ok:true,accountAccessRequired:true});
  assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows,before);
  assert.equal((await h.db.query('SELECT * FROM client_browser_sessions')).rows.length,0);
  assert.equal((await h.service.completeRegistration({...input,grant:r.request,profile:{}})).ok,false);
});

for(const drift of ['owner','status','history'])test(`unified proof rejects ${drift} drift between dispatch and verification`,async t=>{
  const h=await clientHarness(t),input={...h.context,purpose:'continue'};if(drift!=='owner')await h.owner();
  const r=await h.service.begin(input);await h.service.dispatchOne();
  if(drift==='owner')await h.owner();
  if(drift==='status')await h.db.query("UPDATE crm_v2_clients SET status='archived'");
  if(drift==='history')await h.db.query("INSERT INTO client_contacts(normalized_value,contact_type) VALUES($1,'mobile')",[input.mobile]);
  assert.equal((await h.service.verify({...input,request:r.request,code:h.sent[0].code})).ok,false);
  assert.equal((await h.db.query('SELECT * FROM client_browser_sessions')).rows.length,0);
});

test('unified entry retains previous verified session revisions and supports one concurrent continuation',async t=>{
  const h=await clientHarness(t);await h.owner();
  const first=await h.service.begin(h.context);await h.service.dispatchOne();const old=await h.service.verify({...h.context,request:first.request,code:h.sent[0].code});
  h.advance(60000);const input={...h.context,purpose:'continue'},r=await h.service.begin(input);await h.service.dispatchOne();
  const results=await Promise.all([1,2].map(()=>h.service.verify({...input,request:r.request,code:h.sent.at(-1).code})));
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal((await h.sessions.validateSessionToken(old.sessionToken)).ok,true);
});


test('a legacy contact does not block the unique current canonical owner or grant access to legacy records',async t=>{
  const h=await clientHarness(t),owner=await h.owner({mobile_verified_at:null}),input={...h.context,purpose:'continue'};
  await h.db.query("INSERT INTO client_contacts(normalized_value,contact_type) VALUES($1,'mobile')",[input.mobile]);
  const r=await h.service.begin(input);await h.service.dispatchOne();const result=await h.service.verify({...input,request:r.request,code:h.sent[0].code});
  assert.equal(result.ok,true);assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).crmV2ClientId,Number(owner.id));
  assert.equal((await h.db.query('SELECT * FROM client_contacts')).rows.length,1);
});


test('unified requests share the durable R5 daily allowance with legacy purposes across service restarts',async t=>{
  const h=await clientHarness(t),budget={currency:'ZAR',dailyMinor:500,whatsappCostMinor:100};
  for(let i=0;i<6;i++){
    const s=h.make({budget});await s.begin({...h.context,purpose:i%2?'continue':'register',mobile:'2782000000'+i});await s.dispatchOne();
  }
  assert.equal(h.sent.length,5);assert.equal((await h.db.query('SELECT * FROM crm_v2_clients')).rows.length,0);
});
