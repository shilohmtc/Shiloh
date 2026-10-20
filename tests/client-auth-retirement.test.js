'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {createClientCrmDetailAuthService}=require('../src/services/clientCrmDetailAuth');
const {createMyShilohRouter}=require('../src/routes/myShiloh');
const {renderMyShilohPage}=require('../src/presentation/myShilohPwa');
const {validClientBudget}=require('../src/services/clientCodeReleasePolicy');
const {inspectClientAuthReadiness}=require('../src/services/clientAuthReadiness');
const {createClientCodeRuntime}=require('../src/services/clientCodeRuntime');
const {createClientCodeRelease,parseClientManifest}=require('../src/services/clientCodeRelease');
const budget={currency:'ZAR',dailyMinor:500,whatsappCostMinor:100};
const env={MY_SHILOH_CRM_AUTH_ENABLED:'true',MY_SHILOH_CRM_AUTH_RATE_KEY:'synthetic-only-rate-key'.repeat(3),MY_SHILOH_CRM_AUTH_RETIRED:'true'};
async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}

test('retirement closes all biographical entry before sessions, identity or database access, without touching existing sessions',async t=>{
  let calls=0;const no=()=>{calls++;throw Error('Retired dependency reached');};
  const service=createClientCrmDetailAuthService({env,db:{query:no,connect:no},sessionService:{issueCrmDetailSession:no}});
  assert.equal(service.enabled(),false);assert.equal((await service.attempt({})).ok,false);
  const app=express();app.use(express.json());app.use(createMyShilohRouter({env,crmAuthService:{enabled:()=>true,attempt:no},sessionService:{validateSessionToken:no}}));
  const origin=await serve(t,app);
  for(const mode of ['sign-in','register','continue','reauthenticate']){
    const r=await fetch(origin+'/my-shiloh/auth/crm/'+mode,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
    assert.equal(r.status,410);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('set-cookie'),null);assert.match((await r.json()).error,/WhatsApp/);
  }
  assert.equal(calls,0);
  assert.equal(createClientCrmDetailAuthService({env:{...env,MY_SHILOH_CRM_AUTH_RETIRED:'false'},sessionService:{issueCrmDetailSession:no}}).enabled(),true);
});

test('R5 is durable across concurrent dispatch, different clients and service recreation; SAST midnight resets only the next day',async t=>{
  const h=await clientHarness(t),service=h.make({budget}),contexts=[];
  for(let i=1;i<=7;i++){const mobile='2782000000'+i;await h.owner({normalized_mobile:mobile});const context={...h.context,mobile,browserToken:String(i).repeat(43)};contexts.push(context);await service.begin(context);}
  await Promise.all(Array.from({length:7},()=>service.dispatchOne()));assert.equal(h.sent.length,5);
  const money=await h.db.query('SELECT attempts FROM client_code_rates WHERE attempts=500');assert.equal(money.rows.length,1);
  const restarted=h.make({budget});await restarted.begin(contexts[5]);await restarted.dispatchOne();assert.equal(h.sent.length,5);
  const local=h.now().getTime()+7200000;h.advance(86400000-local%86400000);
  await restarted.begin(contexts[6]);await restarted.dispatchOne();assert.equal(h.sent.length,6);
});

test('uncertain delivery consumes its reservation; invalid or excessive allowances never reach storage',async t=>{
  const h=await clientHarness(t);await h.owner();h.outcome('uncertain');const service=h.make({budget});await service.begin(h.context);await service.dispatchOne();
  assert.equal(h.sent.length,1);assert.equal((await h.db.query('SELECT attempts FROM client_code_rates WHERE attempts=100')).rows.length,1);
  h.advance(60000);await service.begin(h.context);await service.dispatchOne();assert.equal(h.sent.length,1);
  for(const value of [{...budget,dailyMinor:501},{...budget,whatsappCostMinor:0},{...budget,currency:'USD'},{}]){
    assert.equal(validClientBudget(value),false);assert.equal(h.make({budget:value}).enabled(),false);
  }
});

test('disabled release is inert; missing schema, separate template or explicit client review cannot start a sender',async()=>{
  let calls=0;const no=()=>{calls++;throw Error('Unexpected I/O');};
  const release=createClientCodeRelease({env:{},db:{query:no,connect:no},fetchImpl:no});assert.equal((await release.start()).ok,false);await release.stop();
  assert.equal(parseClientManifest(JSON.stringify({reviewedForClients:true,budget,smsFallbackEnabled:true})),null);
  assert.equal(parseClientManifest(JSON.stringify({reviewedForClients:true,budget:{...budget,dailyMinor:600},smsFallbackEnabled:false})),null);
  const runtime=createClientCodeRuntime({enabled:true,config:{reviewedForClients:true,budget,template:{name:'shiloh_workspace_verification'}},db:{query:no,connect:no},fetchImpl:no});
  assert.equal((await runtime.prepare()).ok,false);assert.equal(calls,0);
});

test('read-only preflight returns exact template language/components and aggregate eligibility without sending or changing records',async t=>{
  const h=await clientHarness(t);await h.owner();await h.owner({normalized_mobile:'27820000002',mobile_verified_at:null});
  await h.owner({normalized_mobile:'27820000003'});await h.db.query("INSERT INTO client_contacts(normalized_value,contact_type) VALUES('27820000003','whatsapp')");
  const template={id:'900001',name:'shiloh_client_verification',language:'en_GB',status:'APPROVED',category:'AUTHENTICATION',components:[{type:'FOOTER',code_expiration_minutes:5}],message_send_ttl_seconds:300};
  const calls=[];const input={env:{MY_SHILOH_CLIENT_AUTH_PREFLIGHT:'true',SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST:JSON.stringify({wabaId:'900002',apiVersion:'v26.0'}),SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN:'synthetic-token-only'},db:h.db,
    fetchImpl:async(url,options)=>{calls.push({url,method:options.method});return new Response(JSON.stringify({data:[template]}),{status:200});}};
  assert.deepEqual(await inspectClientAuthReadiness({env:{},db:{query(){throw Error();}}}),{enabled:false});
  for(const manifest of ['null','[]','false','invalid'])assert.equal((await inspectClientAuthReadiness({env:{...input.env,SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST:manifest},db:{query(){throw Error('Unconfigured lookup');}}})).code,'CLIENT_PREFLIGHT_UNCONFIGURED');
  const before=(await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows;
  const result=await inspectClientAuthReadiness(input);assert.equal(result.templates[0].language,'en_GB');assert.deepEqual(result.templates[0].components,template.components);
  assert.deepEqual(result.coverage,{active_clients:3,code_eligible_clients:1,saved_passkey_clients:0,needs_reception_or_enrollment:2});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.doesNotMatch(calls[0].url,/\/messages(?:\?|$)/);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-token|278200000/);assert.deepEqual((await h.db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows,before);
});

test('retired views offer saved passkeys and the ready code channel, without obsolete forms; unavailable provider never reopens details',()=>{
  for(const codeAvailable of [false,true]){
    const html=renderMyShilohPage({crmAvailable:true,detailsRetired:true,codeAvailable,passkeysAvailable:true});
    assert.doesNotMatch(html,/data-client-crm-form|Sign in with your Shiloh details|Enter your Shiloh details/);assert.match(html,/data-passkey-sign-in/);
    assert.equal(html.includes('data-client-code-sign-in'),codeAvailable);if(!codeAvailable)assert.match(html,/WhatsApp sign-in is temporarily unavailable/);
  }
  assert.match(renderMyShilohPage({crmAvailable:true}),/data-client-crm-form/);
});

test('runtime verifies schema and exact approved inventory before admission, then stop blocks future provider calls',async t=>{
  const h=await clientHarness(t);await h.owner();const template={...require('./fixtures/workspace-meta-reviewed-2026-10-17.json'),id:'900001',wabaId:'900002',name:'shiloh_client_verification',language:'en_GB'};
  const methods=[];let approved=true;
  const runtime=createClientCodeRuntime({enabled:true,config:{reviewedForClients:true,template,wabaId:'900002',phoneNumberId:'900003',apiVersion:'v26.0',budget,smsFallbackEnabled:false},
    db:h.db,sessions:h.sessions,hmacKey:Buffer.alloc(32,5),metaCredentials:{accessToken:'synthetic-token-only'},now:h.now,
    fetchImpl:async(url,options)=>{methods.push(options.method);return new Response(JSON.stringify(options.method==='POST'?{messages:[{id:'wamid.synthetic'}]}:{data:url.includes('/phone_numbers')?[{id:'900003'}]:[{...template,status:approved?'APPROVED':'PAUSED'}]}),{status:200});}});
  assert.equal(runtime.service.enabled(),false);assert.equal(methods.length,0);
  approved=false;assert.equal((await runtime.prepare()).ok,false);assert.equal(runtime.service.enabled(),false);assert.equal(methods.includes('POST'),false);
  approved=true;assert.equal((await runtime.prepare()).ok,true);assert.equal(runtime.service.enabled(),true);assert.equal(runtime.service.smsEnabled(),false);
  const request=await runtime.service.begin(h.context);assert.equal(request.ok,true);assert.equal(methods.includes('POST'),false);
  await runtime.worker.runOnce();assert.equal(methods.filter(x=>x==='POST').length,1);
  runtime.stop();const count=methods.length;assert.equal(runtime.service.enabled(),false);assert.equal((await runtime.service.begin(h.context)).ok,false);assert.equal((await runtime.worker.runOnce()).ok,false);assert.equal(methods.length,count);
});

test('a pre-cutover remembered client session can save a real passkey, keep its fixed 30-day deadline and sign in after details retirement',async t=>{
  const h=await clientHarness(t),owner=await h.owner({mobile_verified_at:null});
  const issued=await h.sessions.issueCrmDetailSession({transaction:h.db,owner});assert.equal(issued.ok,true);
  const session=await h.sessions.validateSessionToken(issued.sessionToken);assert.equal(session.ok,true);
  const original=issued.expiresAt.getTime();assert.equal(original-h.now().getTime(),30*86400000);
  const {createClientPasskeyEnrollmentService}=require('../src/services/clientPasskeyEnrollment');
  const {createClientPasskeyAuthenticationService}=require('../src/services/clientPasskeyAuthentication');
  const {fixture,registrationResponse}=require('./helpers/workspaceWhatsAppWebauthn');
  const crypto=require('node:crypto'),origin='https://app.shilohmtc.co.za',rpId='app.shilohmtc.co.za';
  const authEnv={...env,SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'},enrollment=createClientPasskeyEnrollmentService({db:h.db,env:authEnv,now:h.now});
  const start=await enrollment.begin({session});assert.equal(start.ok,true);const f=fixture();
  const saved=await enrollment.finish({session,response:registrationResponse(f,{origin,rpId,challenge:start.options.challenge})});assert.equal(saved.ok,true);
  h.advance(60000);assert.equal(new Date((await h.db.query('SELECT expires_at FROM client_browser_sessions WHERE id=$1',[issued.sessionId])).rows[0].expires_at).getTime(),original);
  assert.equal((await h.db.query('SELECT mobile_verified_at FROM crm_v2_clients WHERE id=$1',[owner.id])).rows[0].mobile_verified_at,null);
  const authentication=createClientPasskeyAuthenticationService({db:h.db,env:authEnv,sessionService:h.sessions,now:h.now}),begin=await authentication.begin({requestFingerprintHash:'a'.repeat(64)});assert.equal(begin.ok,true);
  const cd=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:begin.options.challenge,origin,crossOrigin:false})),ad=Buffer.alloc(37);
  crypto.createHash('sha256').update(rpId).digest().copy(ad);ad[32]=5;ad.writeUInt32BE(1,33);
  const signature=crypto.sign('sha256',Buffer.concat([ad,crypto.createHash('sha256').update(cd).digest()]),f.privateKey);
  const login=await authentication.finish({browserToken:begin.browserToken,requestFingerprintHash:'a'.repeat(64),response:{id:f.credentialId.toString('base64url'),rawId:f.credentialId.toString('base64url'),type:'public-key',response:{clientDataJSON:cd.toString('base64url'),authenticatorData:ad.toString('base64url'),signature:signature.toString('base64url'),userHandle:null}}});
  assert.equal(login.ok,true);assert.equal((await h.sessions.validateSessionToken(login.sessionToken)).authMethod,'passkey');
  assert.equal(new Date((await h.db.query('SELECT expires_at FROM client_browser_sessions WHERE id=$1',[issued.sessionId])).rows[0].expires_at).getTime(),original);
});

test('production uses one explicitly gated client composition without changing the staff lifecycle',()=>{
  const source=require('node:fs').readFileSync('app.js','utf8');assert.match(source,/clientAuthReadinessProduction/);assert.match(source,/clientCodeProduction/);assert.match(source,/clientCodeRelease\.mount\(app\)/);assert.match(source,/await clientCodeRelease\.start\(\)/);assert.match(source,/clientCodeAvailable:\(\)=>clientCodeRelease\.status\(\)\.enabled/);
  assert.doesNotMatch(require('node:fs').readFileSync('src/routes/myShiloh.js','utf8'),/createClientCode(?:Runtime|Release)/);
});
