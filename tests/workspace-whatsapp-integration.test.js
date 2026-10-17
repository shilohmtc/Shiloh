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
