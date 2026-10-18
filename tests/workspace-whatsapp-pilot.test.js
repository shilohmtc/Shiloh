'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {setTimeout:delay}=require('node:timers/promises');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {fixture,registrationResponse}=require('./helpers/workspaceWhatsAppWebauthn');
const {createWorkspaceWhatsAppAuth}=require('../src/services/workspaceWhatsAppAuth');
const {createWorkspaceWhatsAppPilot,createWorkspaceWhatsAppPilotPolicy}=require('../src/services/workspaceWhatsAppPilot');
const {BASE}=require('../src/routes/workspaceWhatsAppAuth');

const budgets={currency:'ZAR',dailySpendMinor:1000,whatsappCostMinor:10,smsCostMinor:30,smsAccountDailyLimit:2,smsClinicDailyLimit:2};
function pilotOptions(overrides={}) {
  const current=Date.now();
  return {subjectId:1,operatorId:2,scopeId:'synthetic_pilot_scope_01',startsAt:new Date(current-60000).toISOString(),
    endsAt:new Date(current+3600000).toISOString(),maxMessages:3,maxSpendMinor:30,...overrides};
}
const policy=overrides=>createWorkspaceWhatsAppPilotPolicy(pilotOptions(overrides),10);
const service=(h,accessPolicy,extra={})=>createWorkspaceWhatsAppAuth({enabled:true,store:h.store,delivery:h.delivery,
  hmacKey:Buffer.alloc(32,7),env:h.env,now:h.now,budgets,accessPolicy,...extra});
async function request(h,s,input={}) {
  const r=await s.begin({...h.context,...input});await s.dispatchOne();return r;
}
const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en',category:'AUTHENTICATION',message_send_ttl_seconds:300,
  components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},
    {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
function adapter(h,overrides={}) {
  return createWorkspaceWhatsAppPilot({enabled:true,pilot:pilotOptions(),db:h.db,sessions:h.sessions,hmacKey:Buffer.alloc(32,7),env:h.env,now:h.now,
    config:{template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',budgets,smsFallbackEnabled:true},
    metaCredentials:{accessToken:'synthetic-only'},workerOptions:{pollMs:100,batchSize:1},
    fetchImpl:async()=>{throw Error('Unexpected synthetic provider call');},...overrides});
}
async function serve(t,pilot) {
  const app=express();assert.equal(pilot.mount(app).ok,true);assert.equal(pilot.mount(app).ok,false);
  app.get('/existing',(_req,res)=>res.send('existing access'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await pilot.stop();await new Promise(r=>server.close(r));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,get:path=>fetch(origin+path),post:(path,body,cookie)=>fetch(origin+BASE+path,{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)})};
}
async function eventually(predicate) {
  const end=Date.now()+3000;
  while(!await predicate()) {if(Date.now()>end)assert.fail('Synthetic operation did not finish');await delay(5);}
}

test('pilot requires distinct canonical IDs, explicit zoned window, scope and bounded allowance',()=>{
  assert.equal(policy().valid,true);
  assert.equal(createWorkspaceWhatsAppPilotPolicy(null,10).valid,false);
  for(const options of [{subjectId:'Christel'},{operatorId:1},{scopeId:'new'},{startsAt:'2026-10-18T10:00:00'},
    {endsAt:'invalid'},{maxMessages:4},{maxMessages:0},{maxSpendMinor:9}]) assert.equal(policy(options).valid,false);
  const input=pilotOptions(),p=createWorkspaceWhatsAppPilotPolicy(input,10);input.subjectId=2;input.recoveryEnabled=true;
  assert.equal(p.allowsSubject(1,'signin',new Date()),true);
  assert.equal(p.allowsSubject(2,'signin',new Date()),false);
  assert.equal(p.allowsSubject(1,'recover',new Date()),false);
});

test('pilot excludes other subjects before provider reads and from own-account enrollment',async t=>{
  const h=await harness(t);let reads=0;
  const s=service(h,policy(),{delivery:{...h.delivery,readiness:async()=>{reads++;return {ready:true,codeTtlSeconds:300};}}});
  const r=await s.begin({...h.context,mobile:'27820000002'});assert.equal(r.accepted,true);assert.equal(reads,0);
  await s.dispatchOne();assert.equal(reads,0);assert.equal(h.sent.length,0);
  assert.equal((await s.requestOwnEnrollment({...h.context,sessionId:h.operatorSession.sessionId,proof:'passkey'})).ok,false);
  const intent=await s.requestSetup({...h.context,purpose:'recover'});
  assert.equal((await s.approveSetup({intent:intent.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true})).ok,false);
  assert.equal((await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'})).ok,true);
});

test('three-message pilot allowance is durable across services and independent of daily reset',async t=>{
  const h=await harness(t),p=policy({endsAt:new Date(+h.now()+48*3600000).toISOString(),maxSpendMinor:100}),s=service(h,p);
  await request(h,s);h.advance(60000);
  const enrollment=await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'code'});
  assert.equal(enrollment.accepted,true);await s.dispatchOne();h.advance(24*3600000);
  await request(h,service(h,p));assert.equal(h.sent.length,3);h.advance(10*60000);
  await request(h,service(h,p));assert.equal(h.sent.length,3);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('pilot lifetime spend cap may stop dispatch before the three-message count',async t=>{
  const h=await harness(t),s=service(h,policy({maxSpendMinor:10}));
  await request(h,s);h.advance(60000);await request(h,s);assert.equal(h.sent.length,1);
});

test('pilot window blocks queued dispatch, verification and already-issued passkey grants',async t=>{
  const h=await harness(t),p=policy({endsAt:new Date(+h.now()+240000).toISOString()}),s=service(h,p);
  const grant=await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'});
  const r=await request(h,s);h.advance(240000);
  assert.equal((await s.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
  assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken})).ok,false);
  await request(h,s);assert.equal(h.sent.length,1);
});

test('recovery requires the designated independent operator and canonical permissions',async t=>{
  const h=await harness(t),s=service(h,policy({recoveryEnabled:true}));
  await h.db.query(`INSERT INTO staff_admin_accounts(id,display_name,normalized_whatsapp,active,role,business_role,calendar_scope,service_scope,permissions)
    SELECT 3,'Synthetic other operator','27820000003',active,role,business_role,calendar_scope,service_scope,permissions FROM staff_admin_accounts WHERE id=2`);
  await h.db.query(`INSERT INTO staff_browser_sessions(admin_id,token_hash,csrf_hash,auth_method,issued_at,expires_at,reauthenticated_at)
    SELECT 3,repeat('a',64),repeat('b',64),'passkey',issued_at,expires_at,reauthenticated_at FROM staff_browser_sessions WHERE id=$1`,[h.operatorSession.sessionId]);
  const other=(await h.db.query('SELECT id FROM staff_browser_sessions WHERE admin_id=3')).rows[0].id;
  const intent=await s.requestSetup({...h.context,purpose:'recover'});
  assert.equal((await s.approveSetup({intent:intent.intent,sessionId:other,identityConfirmed:true})).ok,false);
  assert.equal((await s.approveSetup({intent:intent.intent,sessionId:h.priorSession.sessionId,identityConfirmed:true})).ok,false);
  assert.equal((await s.approveSetup({intent:intent.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true})).ok,true);
  const r=await request(h,s,{purpose:'recover',setupIntent:intent.intent});
  const result=await s.verify({...h.context,purpose:'recover',request:r.request,code:h.sent.at(-1).code});
  assert.equal(result.ok,true);assert.equal(result.purpose,'recover');
  await h.db.query(`UPDATE staff_admin_accounts SET permissions='{}' WHERE id=2`);
  assert.equal((await s.beginRegistration({grant:result.grant,browserToken:h.context.browserToken})).ok,false);
  const next=await s.requestSetup({...h.context,purpose:'recover'});
  assert.equal((await s.approveSetup({intent:next.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true})).ok,false);
});

test('stopping after readiness prevents a queued send and closes existing grants',async t=>{
  const h=await harness(t);let enabled=true,release,started;
  const waiting=new Promise(r=>{started=r;});
  const s=service(h,policy(),{isEnabled:()=>enabled,delivery:{...h.delivery,readiness:()=>{started();return new Promise(r=>{release=r;});}}});
  const grant=await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'});
  await s.begin(h.context);const work=s.dispatchOne();await waiting;enabled=false;
  release({ready:true,codeTtlSeconds:300});await work;assert.equal(h.sent.length,0);
  assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken})).ok,false);
});

test('changed pilot subject cannot complete an already-issued real WebAuthn grant',async t=>{
  const h=await harness(t),unrestricted=service(h,null);
  const grant=await unrestricted.requestOwnEnrollment({...h.context,sessionId:h.operatorSession.sessionId,proof:'passkey'});
  const s=service(h,policy());
  assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken})).ok,false);
  const own=await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'});
  const start=await s.beginRegistration({grant:own.grant,browserToken:h.context.browserToken});
  const finish={grant:own.grant,browserToken:h.context.browserToken,
    response:registrationResponse(fixture(),{challenge:start.options.challenge}),deviceLabel:'Synthetic pilot'};
  assert.equal((await service(h,policy({subjectId:2,operatorId:1})).finishRegistration(finish)).ok,false);
  assert.equal((await h.db.query('SELECT id FROM staff_auth_passkey_credentials')).rows.length,0);
  assert.equal((await s.finishRegistration(finish)).ok,true);
});

test('default-off and schema-unready adapters preserve unrelated HTTP access with no provider work',async t=>{
  let calls=0;const off=createWorkspaceWhatsAppPilot({db:{query:()=>{calls++;throw Error('Forbidden');}},fetchImpl:()=>{calls++;throw Error('Forbidden');}});
  const http=await serve(t,off);assert.equal((await off.start()).code,'PILOT_UNCONFIGURED');
  assert.equal((await http.get(BASE+'/')).status,404);assert.equal(await(await http.get('/existing')).text(),'existing access');assert.equal(calls,0);
  const h=await harness(t),p=adapter(h);await h.db.query('DROP TABLE workspace_whatsapp_dispatch');
  const second=await serve(t,p);assert.equal((await p.start()).code,'RUNTIME_SCHEMA_UNREADY');
  assert.equal((await second.get(BASE+'/')).status,404);assert.equal((await second.get('/existing')).status,200);
});

test('adapter starts once, restricts passkey destinations, closes intake during a bounded in-flight send, and never restarts after stop',async t=>{
  const h=await harness(t);let messages=0,release,started;
  const waiting=new Promise(r=>{started=r;});
  const p=adapter(h,{fetchImpl:async(url,options)=>{
    if(url.includes('/phone_numbers'))return new Response(JSON.stringify({data:[{id:'789'}]}));
    if(url.includes('/message_templates'))return new Response(JSON.stringify({data:[{...template,status:'APPROVED'}]}));
    assert.match(url,/\/789\/messages$/);assert.equal(options.method,'POST');messages++;started();
    return new Promise(r=>{release=()=>r(new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]})));});
  }});
  const http=await serve(t,p);assert.equal((await http.get(BASE+'/')).status,404);
  const starts=await Promise.all([p.start(),p.start()]);assert.ok(starts.every(x=>x.ok));
  assert.equal(await p.passkeySuccessDestination(h.priorSession.sessionToken),BASE+'/welcome');
  assert.equal(await p.passkeySuccessDestination(h.operatorSession.sessionToken),'/calendar');
  const page=await http.get(BASE+'/'),cookie=page.headers.get('set-cookie').split(';')[0];assert.doesNotMatch(await page.text(),/Try an SMS code instead/);
  const r=await http.post('/start',{purpose:'signin',mobile:h.context.mobile},cookie);assert.equal(r.status,200);
  await waiting;assert.equal(messages,1);
  const stopping=p.stop();assert.equal((await http.get(BASE+'/')).status,404);
  assert.equal((await http.post('/start',{purpose:'signin',mobile:h.context.mobile},cookie)).status,404);
  release();await stopping;assert.equal(p.status().state,'stopped');assert.equal(p.status().enabled,false);
  assert.equal((await p.start()).code,'PILOT_STOPPED');assert.equal(messages,1);
  assert.equal((await http.get('/existing')).status,200);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('adapter expiry stops the managed loop and rejects a late start',async t=>{
  const h=await harness(t),p=adapter(h,{pilot:pilotOptions({endsAt:new Date(Date.now()+10000).toISOString()})});
  t.after(()=>p.stop());assert.equal((await p.start()).ok,true);h.advance(11000);
  await eventually(()=>p.status().state==='expired');assert.equal(p.status().enabled,false);
  // Release the worker before the harness closes its pool. Pool.end() cannot
  // cancel a just-started acquisition; production shutdown uses this order too.
  await p.stop();
  const late=adapter(h,{pilot:pilotOptions({endsAt:new Date(Date.now()+10000).toISOString()})});t.after(()=>late.stop());
  assert.equal((await late.start()).code,'PILOT_OUTSIDE_WINDOW');
});

test('stop during schema preparation cannot reopen intake or start a worker',async t=>{
  const h=await harness(t);let release,started;
  const waiting=new Promise(r=>{started=r;});let first=true;
  const p=adapter(h,{db:{...h.db,query:async(...args)=>{
    if(first){first=false;started();await new Promise(r=>{release=r;});}
    return h.db.query(...args);
  }}});t.after(()=>p.stop());
  const starting=p.start();await waiting;const stopping=p.stop();release();
  assert.equal((await starting).code,'PILOT_STOPPED');await stopping;
  assert.deepEqual(p.status(),{state:'stopped',enabled:false,smsEnabled:false});
  assert.equal((await p.start()).code,'PILOT_STOPPED');
});

test('worker database failure disables only the pilot and exposes no raw failure',async t=>{
  const h=await harness(t),p=adapter(h,{db:{...h.db,connect:async()=>{throw Error('synthetic private failure');}}});
  const http=await serve(t,p);await p.start();await eventually(()=>p.status().state==='unavailable');
  assert.equal((await http.get(BASE+'/')).status,404);
  assert.equal((await http.get('/existing')).status,200);
  assert.deepEqual(p.status(),{state:'unavailable',enabled:false,smsEnabled:false});
  assert.equal((await p.start()).code,'PILOT_UNAVAILABLE');
});

test('a window that expires while preparing never opens intake or starts dispatch',async t=>{
  const h=await harness(t);let release,started;let first=true;
  const waiting=new Promise(r=>{started=r;});
  const p=adapter(h,{pilot:pilotOptions({endsAt:new Date(+h.now()+10000).toISOString()}),db:{...h.db,query:async(...args)=>{
    if(first){first=false;started();await new Promise(r=>{release=r;});}
    return h.db.query(...args);
  }}});t.after(()=>p.stop());
  const starting=p.start();await waiting;h.advance(11000);release();
  assert.equal((await starting).code,'PILOT_OUTSIDE_WINDOW');
  assert.equal(p.status().enabled,false);assert.equal(p.status().state,'expired');await p.stop();
});

test('stop during the final inventory read prevents a message POST from starting',async t=>{
  const h=await harness(t);let inventories=0,messages=0,release;
  const p=adapter(h,{fetchImpl:async url=>{
    if(url.includes('/phone_numbers'))return new Response(JSON.stringify({data:[{id:'789'}]}));
    if(url.includes('/message_templates')) {
      inventories++;
      if(inventories===2)await new Promise(r=>{release=r;});
      return new Response(JSON.stringify({data:[{...template,status:'APPROVED'}]}));
    }
    messages++;return new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]}));
  }});
  const http=await serve(t,p);await p.start();
  const page=await http.get(BASE+'/'),cookie=page.headers.get('set-cookie').split(';')[0];await page.text();
  assert.equal((await http.post('/start',{purpose:'signin',mobile:h.context.mobile},cookie)).status,200);
  await eventually(()=>inventories===2);const stopping=p.stop();release();await stopping;
  assert.equal(messages,0);assert.equal(p.status().enabled,false);
});
