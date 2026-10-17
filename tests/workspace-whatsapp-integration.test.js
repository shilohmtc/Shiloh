'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {fixture,registrationResponse}=require('./helpers/workspaceWhatsAppWebauthn');
const {createWorkspaceWhatsAppRouter,BASE}=require('../src/routes/workspaceWhatsAppAuth');

test('SQL adapter issues canonical session and invalidates it on staff mobile revision without revoking existing passkeys',async t=>{
  const h=await harness(t), result=await h.code();
  assert.equal(result.ok,true);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).authMethod,'workspace_whatsapp');
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  await h.db.query("UPDATE staff_admin_accounts SET normalized_whatsapp='27820000009' WHERE id=1");
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,false);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  const rows=(await h.db.query('SELECT payload FROM workspace_whatsapp_records')).rows;
  assert.ok(!JSON.stringify(rows).includes(h.sent[0].code));
});

test('SQL enrollment and recovery verify real WebAuthn attestation; replacement occurs only on successful finish',async t=>{
  const h=await harness(t);
  const enrollment=await h.code('enroll');
  const start=await h.service.beginRegistration({grant:enrollment.grant,browserToken:h.context.browserToken});
  assert.equal(start.ok,true);
  const key=fixture();
  const result=await h.service.finishRegistration({grant:enrollment.grant,browserToken:h.context.browserToken,
    response:registrationResponse(key,{challenge:start.options.challenge}),deviceLabel:'Synthetic device'});
  assert.equal(result.ok,true);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).authMethod,'passkey');
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  const recovery=await h.code('recover');
  const recoverStart=await h.service.beginRegistration({grant:recovery.grant,browserToken:h.context.browserToken});
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,true);
  const replacement=await h.service.finishRegistration({grant:recovery.grant,browserToken:h.context.browserToken,
    response:registrationResponse(fixture(),{challenge:recoverStart.options.challenge}),deviceLabel:'Replacement'});
  assert.equal(replacement.ok,true);
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,false);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,false);
  assert.equal((await h.sessions.validateSessionToken(h.operatorSession.sessionToken)).ok,true);
  assert.equal((await h.sessions.validateSessionToken(replacement.sessionToken)).ok,true);
  assert.equal((await h.db.query('SELECT id FROM staff_auth_passkey_credentials WHERE revoked_at IS NULL')).rows.length,1);
  assert.equal((await h.service.finishRegistration({grant:recovery.grant,browserToken:h.context.browserToken,response:{}})).ok,false);
});

test('bad attestation and revoked approval cannot replace credentials or revoke a preserved session',async t=>{
  const h=await harness(t);
  const first=await h.code('recover');
  const start=await h.service.beginRegistration({grant:first.grant,browserToken:h.context.browserToken});
  const response=registrationResponse(fixture(),{challenge:start.options.challenge,origin:'https://evil.example'});
  assert.equal((await h.service.finishRegistration({grant:first.grant,browserToken:h.context.browserToken,response})).ok,false);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  const next=await h.code('recover');
  const second=await h.service.beginRegistration({grant:next.grant,browserToken:h.context.browserToken});
  await h.db.query('UPDATE staff_browser_sessions SET revoked_at=NOW() WHERE id=$1',[h.operatorSession.sessionId]);
  assert.equal((await h.service.finishRegistration({grant:next.grant,browserToken:h.context.browserToken,
    response:registrationResponse(fixture(),{challenge:second.options.challenge})})).ok,false);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  assert.equal((await h.db.query('SELECT * FROM staff_auth_passkey_credentials')).rows.length,0);
});

test('approved staff recovery still requires the recorded-phone code; administrator approval is not a lost-phone bypass',async t=>{
  const h=await harness(t), input={...h.context,purpose:'recover'};
  const intent=await h.service.requestSetup(input);
  assert.equal((await h.service.approveSetup({intent:intent.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true})).ok,true);
  // An approved intent is not a phone proof, WebAuthn grant or session.
  assert.equal((await h.service.beginRegistration({grant:intent.intent,browserToken:input.browserToken})).ok,false);
  assert.equal((await h.service.finishRegistration({grant:intent.intent,browserToken:input.browserToken,response:{}})).ok,false);
  assert.equal((await h.service.verify({...input,request:intent.intent,code:'000000'})).ok,false);
  assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM workspace_whatsapp_records WHERE kind='grant'")).rows[0].n,0);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM staff_browser_sessions')).rows[0].n,2);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('SQL transaction rolls back consumption and session insertion when audit fails',async t=>{
  const h=await harness(t);
  const r=await h.service.begin(h.context);
  await h.service.dispatchOne();
  await h.db.query("ALTER TABLE staff_auth_security_events ADD CONSTRAINT test_fail_verified CHECK(event_type<>'workspace_whatsapp_verified')");
  await assert.rejects(h.service.verify({...h.context,request:r.request,code:h.sent[0].code}));
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM staff_browser_sessions')).rows[0].n,2);
  assert.equal((await h.db.query("SELECT payload->>'state' AS state FROM workspace_whatsapp_records WHERE kind='challenge'")).rows[0].state,'ready');
});

test('concurrent verification issues exactly one session and concurrent requests honor durable identity quota',async t=>{
  const h=await harness(t);
  const first=await h.service.begin(h.context);
  await h.service.dispatchOne();
  const code=h.sent.at(-1).code;
  const verified=await Promise.all(Array.from({length:6},()=>h.service.verify({...h.context,request:first.request,code})));
  assert.equal(verified.filter(r=>r.ok).length,1);
  await Promise.all(Array.from({length:8},()=>h.service.begin(h.context)));
  while ((await h.service.dispatchOne()).processed) {}
  assert.equal(h.sent.length,3);
  assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM workspace_whatsapp_records WHERE kind='challenge' AND payload->>'state'='ready'")).rows[0].n,1);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM staff_browser_sessions')).rows[0].n,3);
});

test('concurrent canonical mobile mutation wins before verification can issue a session',async t=>{
  const h=await harness(t), request=await h.service.begin(h.context);
  await h.service.dispatchOne();
  const mutation=await h.db.connect();
  await mutation.query('BEGIN');
  await mutation.query('SELECT id FROM staff_admin_accounts WHERE id=1 FOR UPDATE');
  const verification=h.service.verify({...h.context,request:request.request,code:h.sent[0].code});
  await mutation.query("UPDATE staff_admin_accounts SET normalized_whatsapp='27820000009' WHERE id=1");
  await mutation.query('COMMIT');mutation.release();
  assert.equal((await verification).ok,false);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM staff_browser_sessions')).rows[0].n,2);
});

test('HTTP flow sets protected cookies, refuses cross-origin and forged approval, never exposes raw session token',async t=>{
  const h=await harness(t), app=express();
  app.use(BASE,createWorkspaceWhatsAppRouter({enabled:true,service:h.service,sessions:h.sessions}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const page=await fetch(origin+BASE+'/');
  const cookie=page.headers.get('set-cookie').split(';')[0];
  assert.match(page.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.match(page.headers.get('cache-control'),/no-store/);
  const post=(path,body,extra={})=>fetch(origin+BASE+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/start',{purpose:'signin',mobile:'27820000001'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await post('/setup/approve',{intent:'A'.repeat(43),sessionId:h.operatorSession.sessionId,identityConfirmed:true})).status,401);
  const start=await (await post('/start',{purpose:'signin',mobile:'27820000001'})).json();
  await h.service.dispatchOne();
  const verified=await post('/verify',{purpose:'signin',request:start.request,code:h.sent.at(-1).code});
  const body=await verified.json();
  assert.equal(body.authenticated,true); assert.equal(body.sessionToken,undefined);
  assert.match(verified.headers.get('set-cookie'),/shiloh_staff_session=/);
  assert.equal((await post('/verify',{purpose:'signin',request:start.request,code:h.sent.at(-1).code})).status,401);
  const intent=await (await post('/setup/request',{purpose:'enroll',mobile:'27820000001'})).json();
  const operatorHeaders={Cookie:cookie+'; shiloh_staff_session='+h.operatorSession.sessionToken,
    'x-shiloh-csrf-token':h.operatorSession.csrfToken};
  assert.equal((await post('/setup/approve',{intent:intent.intent,identityConfirmed:true},
    {...operatorHeaders,'x-shiloh-csrf-token':'invalid'})).status,403);
  const reviewed=await (await post('/setup/review',{intent:intent.intent},operatorHeaders)).json();
  assert.equal(reviewed.mobileEnding,'0001');
  assert.equal((await post('/setup/approve',{intent:intent.intent,identityConfirmed:true},operatorHeaders)).status,200);
  const setupStart=await (await post('/start',{purpose:'enroll',mobile:'27820000001',setupIntent:intent.intent})).json();
  await h.service.dispatchOne();
  const phone=await (await post('/verify',{purpose:'enroll',request:setupStart.request,code:h.sent.at(-1).code})).json();
  const registration=await (await post('/passkey/start',{grant:phone.grant})).json();
  const saved=await post('/passkey/finish',{grant:phone.grant,
    response:registrationResponse(fixture(),{challenge:registration.options.challenge})});
  assert.equal((await saved.json()).authenticated,true);
  assert.match(saved.headers.get('set-cookie'),/shiloh_staff_session=/);
});


test('durable queue survives service restart; concurrent workers claim once and never replay uncertain delivery', async t => {
  const h = await harness(t);
  const {createWorkspaceWhatsAppAuth} = require('../src/services/workspaceWhatsAppAuth');
  const input = await h.service.begin(h.context);
  assert.equal(h.sent.length,0);
  const rows=(await h.db.query('SELECT payload FROM workspace_whatsapp_dispatch')).rows;
  assert.equal(rows.length,1);
  for (const secret of [h.context.mobile,h.context.browserToken,input.request]) assert.ok(!JSON.stringify(rows).includes(secret));
  let calls=0;
  const restart = () => createWorkspaceWhatsAppAuth({enabled:true,store:h.store,hmacKey:Buffer.alloc(32,7),
    delivery:{...h.delivery,deliver:async()=>{calls++;throw Error('synthetic uncertain acceptance');}}});
  const results=await Promise.all([restart().dispatchOne(),restart().dispatchOne()]);
  assert.equal(results.filter(r=>r.processed).length,1); assert.equal(calls,1);
  assert.equal((await restart().dispatchOne()).processed,false);
  assert.equal((await h.service.verify({...h.context,request:input.request,code:'123456'})).ok,false);
  assert.equal((await h.db.query("SELECT payload->>'mobile' AS mobile FROM workspace_whatsapp_dispatch")).rows[0].mobile,null);
});

test('provider acceptance followed by a failed completion transaction cannot replay or authenticate', async t => {
  const h = await harness(t), r = await h.service.begin(h.context);
  await h.db.query("ALTER TABLE staff_auth_security_events ADD CONSTRAINT test_fail_accepted CHECK(event_type<>'workspace_whatsapp_provider_accepted')");
  await assert.rejects(h.service.dispatchOne());
  assert.equal(h.sent.length,1);
  assert.equal((await h.service.dispatchOne()).processed,false);
  assert.equal((await h.service.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
  assert.equal((await h.db.query("SELECT payload->>'state' AS state FROM workspace_whatsapp_records WHERE kind='challenge'")).rows[0].state,'dispatching');
});

const syntheticBudgets={currency:'ZAR',dailySpendMinor:100,whatsappCostMinor:2,smsCostMinor:3,smsAccountDailyLimit:2,smsClinicDailyLimit:20};
function smsFixture(){const sent=[];return {sent,provider:{configured:()=>true,readiness:async()=>({ready:true,codeTtlSeconds:300}),deliver:async input=>{sent.push(input);return{ok:true,outcome:'accepted',providerMessageId:'sms.synthetic'};}}};}
const offlineWhatsApp=()=>({configured:()=>true,readiness:async()=>({ready:false}),deliver:async()=>{throw Error('must not send');}});

test('explicit SMS fallback consumes the same request once and creates an ordinary revision-bound session',async t=>{
  const sms=smsFixture(),h=await harness(t,{delivery:offlineWhatsApp(),smsDelivery:sms.provider,budgets:syntheticBudgets});
  const r=await h.service.begin(h.context);await h.service.dispatchOne();
  await Promise.all(Array.from({length:4},()=>h.service.requestSmsFallback({...h.context,request:r.request})));
  const workers=await Promise.all([h.service.dispatchOne(),h.service.dispatchOne()]);
  assert.equal(workers.filter(r=>r.processed).length,1);assert.equal(sms.sent.length,1);
  const result=await h.service.verify({...h.context,request:r.request,code:sms.sent[0].code});assert.equal(result.ok,true);
  const session=await h.sessions.validateSessionToken(result.sessionToken);
  assert.equal(session.authMethod,'workspace_sms');
  assert.equal(require('../src/services/staffPasskeyAuth').strongRecentSession(session,new Date()),false);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  assert.equal((await h.service.verify({...h.context,request:r.request,code:sms.sent[0].code})).ok,false);
  await h.db.query("UPDATE staff_admin_accounts SET normalized_whatsapp='27820000009' WHERE id=1");
  assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).ok,false);
});

test('accepted, in-flight and uncertain WhatsApp cannot trigger SMS, including through a different request',async t=>{
  const sms=smsFixture(), delivery={...offlineWhatsApp(),readiness:async()=>({ready:true,codeTtlSeconds:300}),deliver:async()=>{throw Error('unknown acceptance');}};
  const h=await harness(t,{delivery,smsDelivery:sms.provider,budgets:syntheticBudgets});
  const first=await h.service.begin(h.context);await h.service.dispatchOne();
  assert.equal((await h.service.requestSmsFallback({...h.context,request:first.request})).accepted,true);
  assert.equal((await h.service.dispatchOne()).processed,false);assert.equal(sms.sent.length,0);
  delivery.readiness=async()=>({ready:false});
  const second=await h.service.begin(h.context);await h.service.dispatchOne();
  await h.service.requestSmsFallback({...h.context,request:second.request});await h.service.dispatchOne();assert.equal(sms.sent.length,0);
  assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM workspace_whatsapp_records WHERE payload->>'state'='uncertain'")).rows[0].n,1);
});

test('accepted WhatsApp and a stalled send reject fallback without exposing delivery state',async t=>{
  const sms=smsFixture();let release,entered;
  const started=new Promise(r=>{entered=r;});
  const delivery={...offlineWhatsApp(),readiness:async()=>({ready:true,codeTtlSeconds:300}),deliver:()=>{entered();return new Promise(r=>{release=r;});}};
  const h=await harness(t,{delivery,smsDelivery:sms.provider,budgets:syntheticBudgets}), r=await h.service.begin(h.context);
  const worker=h.service.dispatchOne();await started;
  const expected={ok:true,accepted:true,request:r.request};
  assert.deepEqual(await h.service.requestSmsFallback({...h.context,request:r.request}),expected);
  release({ok:true,providerMessageId:'wamid.synthetic'});await worker;
  assert.deepEqual(await h.service.requestSmsFallback({...h.context,request:r.request}),expected);
  assert.equal((await h.service.dispatchOne()).processed,false);assert.equal(sms.sent.length,0);
});

test('SMS fallback is browser/purpose/expiry bound and refuses unknown references generically',async t=>{
  let clock=new Date();const sms=smsFixture(), h=await harness(t,{delivery:offlineWhatsApp(),smsDelivery:sms.provider,budgets:syntheticBudgets,now:()=>new Date(clock)});
  const r=await h.service.begin(h.context);await h.service.dispatchOne();
  for (const extra of [{browserToken:'X'.repeat(43)},{purpose:'recover'},{request:'X'.repeat(43)}]) {
    assert.equal((await h.service.requestSmsFallback({...h.context,request:r.request,...extra})).accepted,true);
    assert.equal((await h.service.dispatchOne()).processed,false);
  }
  clock=new Date(clock.getTime()+300000);
  assert.equal((await h.service.requestSmsFallback({...h.context,request:r.request})).accepted,true);
  assert.equal((await h.service.dispatchOne()).processed,false);assert.equal(sms.sent.length,0);
});

test('proposed two-SMS daily account cap and shared monetary reservation fail closed',async t=>{
  let clock=new Date();const sms=smsFixture(), h=await harness(t,{delivery:offlineWhatsApp(),smsDelivery:sms.provider,budgets:syntheticBudgets,now:()=>new Date(clock)});
  for(let i=0;i<3;i++) {
    const r=await h.service.begin(h.context);await h.service.dispatchOne();
    await h.service.requestSmsFallback({...h.context,request:r.request});await h.service.dispatchOne();
    clock=new Date(clock.getTime()+11*60000);
  }
  assert.equal(sms.sent.length,2);
  const limitedSms=smsFixture(), limited=await harness(t,{delivery:offlineWhatsApp(),smsDelivery:limitedSms.provider,budgets:{...syntheticBudgets,dailySpendMinor:2}});
  const r=await limited.service.begin(limited.context);await limited.service.dispatchOne();
  await limited.service.requestSmsFallback({...limited.context,request:r.request});await limited.service.dispatchOne();assert.equal(limitedSms.sent.length,0);
});

test('concurrent subjects share the same clinic spend reservation',async t=>{
  const h=await harness(t,{budgets:{...syntheticBudgets,dailySpendMinor:3}});
  await h.service.begin(h.context);await h.service.begin({...h.context,mobile:'27820000002'});
  await Promise.all([h.service.dispatchOne(),h.service.dispatchOne()]);assert.equal(h.sent.length,1);
});

test('recovery SMS reuses only its approved intent after a proven pre-send failure',async t=>{
  const sms=smsFixture(), h=await harness(t,{smsDelivery:sms.provider,budgets:syntheticBudgets,
    delivery:{...offlineWhatsApp(),readiness:async()=>({ready:true,codeTtlSeconds:300}),deliver:async()=>({ok:false,outcome:'not_sent'})}});
  const input={...h.context,purpose:'recover'}, intent=await h.service.requestSetup(input);
  await h.service.approveSetup({intent:intent.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true});
  const r=await h.service.begin({...input,setupIntent:intent.intent});await h.service.dispatchOne();
  await h.service.requestSmsFallback({...input,request:r.request});await h.service.dispatchOne();assert.equal(sms.sent.length,1);
  const grant=await h.service.verify({...input,request:r.request,code:sms.sent[0].code});assert.equal(grant.purpose,'recover');assert.equal(grant.sessionToken,undefined);
  const start=await h.service.beginRegistration({grant:grant.grant,browserToken:input.browserToken});assert.equal(start.ok,true);
  await h.db.query('UPDATE staff_browser_sessions SET revoked_at=NOW() WHERE id=$1',[h.operatorSession.sessionId]);
  const result=await h.service.finishRegistration({grant:grant.grant,browserToken:input.browserToken,response:registrationResponse(fixture(),{challenge:start.options.challenge})});
  assert.equal(result.ok,false);assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('isolated runtime requires schema and budget, wires HTTP and worker, and never sends on public intake',async t=>{
  const {createWorkspaceWhatsAppRuntime}=require('../src/services/workspaceWhatsAppRuntime');
  const h=await harness(t), requests=[];
  const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en_GB',category:'AUTHENTICATION',message_send_ttl_seconds:300,
    components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},{type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
  const runtime=createWorkspaceWhatsAppRuntime({enabled:true,db:h.db,sessions:h.sessions,hmacKey:Buffer.alloc(32,7),env:h.env,
    config:{template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',smsFallbackEnabled:true,budgets:syntheticBudgets},
    metaCredentials:{accessToken:'synthetic-token'},smsCredentials:{accountEmail:'synthetic@example.invalid',apiToken:'synthetic-token'},
    fetchImpl:async(url,options)=>{requests.push({url,options});if(url.startsWith('https://graph.facebook.com/'))throw Error('synthetic pre-send outage');return new Response(JSON.stringify({messageId:'synthetic'}));}});
  assert.equal(runtime.service.enabled(),false);assert.equal((await runtime.prepare()).ok,true);assert.equal(requests.length,0);
  const app=express();app.use(BASE,runtime.router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,page=await fetch(origin+BASE+'/'),cookie=page.headers.get('set-cookie').split(';')[0];
  assert.match(await page.text(),/Try an SMS code instead/);
  const post=(path,body)=>fetch(origin+BASE+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  const r=await(await post('/start',{purpose:'signin',mobile:h.context.mobile})).json();assert.equal(requests.length,0);
  assert.equal((await runtime.worker.runOnce()).processed,1);assert.equal(requests.length,1);
  await post('/fallback/sms',{request:r.request,purpose:'signin'});assert.equal(requests.length,1);
  assert.equal((await runtime.worker.runOnce()).processed,1);assert.equal(requests.length,2);
  const code=JSON.parse(requests[1].options.body).message.match(/code: (\d{6})/)[1];
  assert.equal((await(await post('/verify',{request:r.request,purpose:'signin',code})).json()).authenticated,true);
  await h.db.query('DROP TABLE workspace_whatsapp_dispatch');
  assert.equal((await runtime.prepare()).code,'RUNTIME_SCHEMA_UNREADY');assert.equal((await fetch(origin+BASE+'/')).status,404);
  assert.equal((await runtime.worker.runOnce()).code,'WORKER_DISABLED');assert.equal(requests.length,2);
});

test('SMS cannot bypass queued WhatsApp; choice during preflight waits for a proven no-send result',async t=>{
  const sms=smsFixture();let reads=0;
  const h=await harness(t,{budgets:syntheticBudgets,smsDelivery:sms.provider,delivery:{...offlineWhatsApp(),readiness:async()=>{reads++;return{ready:false};}}});
  const first=await h.service.begin(h.context);await h.service.requestSmsFallback({...h.context,request:first.request});await h.service.dispatchOne();
  assert.equal(reads,1);assert.equal(sms.sent.length,0);
  await h.service.requestSmsFallback({...h.context,request:first.request});await h.service.dispatchOne();
  assert.equal(sms.sent.length,1);
  let release,entered;const waiting=new Promise(r=>{entered=r;});const secondSms=smsFixture();
  const g=await harness(t,{budgets:syntheticBudgets,smsDelivery:secondSms.provider,delivery:{...offlineWhatsApp(),readiness:()=>{entered();return new Promise(r=>{release=r;});}}});
  const second=await g.service.begin(g.context);const worker=g.service.dispatchOne();await waiting;
  await g.service.requestSmsFallback({...g.context,request:second.request});assert.equal(secondSms.sent.length,0);
  release({ready:false});await worker;await g.service.dispatchOne();assert.equal(secondSms.sent.length,1);
});
