'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {createProductionClientCode,productionClientEnv}=require('../src/services/clientCodeProduction');
const {createMyShilohRouter}=require('../src/routes/myShiloh');
const {inspectClientCodeHttp}=require('../src/services/clientCodeHttpProof');
const manifest=require('../src/config/clientWhatsAppManifest.json');
function settings(extra={}) {return {NODE_ENV:'test',MY_SHILOH_CRM_AUTH_RETIRED:'true',MY_SHILOH_CLIENT_CODE_AUTH_ENABLED:'true',
  MY_SHILOH_CLIENT_CODE_AUTH_KEY:'09'.repeat(32),MY_SHILOH_CLIENT_CODE_AUTH_MANIFEST:JSON.stringify(manifest),
  MY_SHILOH_CLIENT_WHATSAPP_CREDENTIAL_SOURCE:'workspace_business',SHILOH_WORKSPACE_WHATSAPP_META_ACCESS_TOKEN:'synthetic-only-token',
  SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST:JSON.stringify({wabaId:manifest.wabaId,phoneNumberId:manifest.phoneNumberId,apiVersion:manifest.apiVersion}),...extra};}
async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
async function waitUntil(fn){const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('Synthetic worker timed out');await new Promise(r=>setTimeout(r,10));}}
function fakePool(h){return class {on(){}query(...a){return h.db.query(...a);}connect(){return h.db.connect();}async end(){}};}
function provider(sent,{approved=true}={}){return async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer synthetic-only-token');
  if(options.method==='GET')return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:manifest.phoneNumberId}]:[{...manifest.template,status:approved?'APPROVED':'PAUSED'}]}),{status:200});
  assert.equal(options.method,'POST');assert.equal(url,`https://graph.facebook.com/${manifest.apiVersion}/${manifest.phoneNumberId}/messages`);
  const body=JSON.parse(options.body);assert.equal(body.template.name,'shiloh_client_verification');assert.equal(body.template.language.code,'en');sent.push(body);
  return new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]}),{status:200});
};}

test('disabled production construction/start/stop is inert and never mutates source credential settings',async()=>{
  let calls=0;const no=()=>{calls++;throw Error('Disabled dependency reached');},env=settings({MY_SHILOH_CLIENT_CODE_AUTH_ENABLED:'false'}),before=JSON.stringify(env);
  const release=createProductionClientCode({env,canonicalDb:{query:no,connect:no},PoolClass:class{constructor(){no();}},fetchImpl:no});
  assert.equal(release.status().enabled,false);assert.equal((await release.start()).ok,false);await release.stop();assert.equal(calls,0);assert.equal(JSON.stringify(env),before);
  for(const property of ['wabaId','phoneNumberId','apiVersion']){
    const bad=settings({SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST:JSON.stringify({...JSON.parse(env.SHILOH_WORKSPACE_WHATSAPP_STAFF_MANIFEST),[property]:'wrong'})});
    assert.equal(productionClientEnv(bad).MY_SHILOH_CLIENT_WHATSAPP_META_ACCESS_TOKEN,undefined);
  }
  assert.equal(productionClientEnv({...env,MY_SHILOH_CLIENT_WHATSAPP_CREDENTIAL_SOURCE:undefined}).MY_SHILOH_CLIENT_WHATSAPP_META_ACCESS_TOKEN,undefined);
});

test('production mount starts only after readiness; explicit HTTP request signs in canonical client and leaves details closed',async t=>{
  const h=await clientHarness(t),owner=await h.owner(),sent=[],env=settings();
  const release=createProductionClientCode({env,canonicalDb:h.db,PoolClass:fakePool(h),fetchImpl:provider(sent),now:h.now});t.after(()=>release.stop());
  const app=express();release.mount(app);app.use(express.json());app.use(createMyShilohRouter({env,sessionService:h.sessions,clientCodeAvailable:()=>release.status().enabled,
    passkeyEnrollmentService:{policy:()=>({operational:true})},whatsappResolver:async()=>null,catalogueProvider:async()=>[]}));
  const origin=await serve(t,app),post=(path,body,cookie)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await fetch(origin+'/my-shiloh/code-auth/')).status,404);
  assert.deepEqual(await inspectClientCodeHttp({fetchImpl:()=>{throw Error('Disabled proof I/O');}}),{enabled:false});
  const started=await release.start();assert.equal(started.ok,true);assert.equal(started.smsEnabled,false);assert.equal(started.detailsSigninRetired,true);assert.equal(sent.length,0);
  const proof=await inspectClientCodeHttp({port:new URL(origin).port,requested:true,retired:true});assert.equal(proof.ok,true);assert.equal(proof.clientEntryHelpRemoved,true);assert.equal(proof.clientUnifiedEntry,true);assert.equal(sent.length,0);
  const page=await fetch(origin+'/my-shiloh/code-auth/'),browserCookie=page.headers.get('set-cookie').split(';')[0];assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);
  let html=await (await fetch(origin+'/my-shiloh/')).text();assert.match(html,/data-client-code-sign-in/);assert.doesNotMatch(html,/data-client-crm-form/);
  const response=await post('/my-shiloh/code-auth/start',{mobile:h.context.mobile},browserCookie),request=(await response.json()).request;assert.equal(response.status,200);
  await waitUntil(()=>sent.length===1);const code=sent[0].template.components.find(c=>c.type==='body').parameters[0].text;
  let verified;await waitUntil(async()=>{verified=await post('/my-shiloh/code-auth/verify',{request,code},browserCookie);return verified.status===200;});
  const result=await verified.json();assert.equal(result.authenticated,true);assert.equal(String(result.client.id),String(owner.id));const sessionCookie=verified.headers.get('set-cookie').split(';')[0];
  const token=sessionCookie.split('=')[1],session=await h.sessions.validateSessionToken(token);assert.equal(session.ok,true);assert.equal(session.authMethod,'whatsapp_challenge');const stored=(await h.db.query('SELECT expires_at,issued_at FROM client_browser_sessions WHERE id=$1',[session.sessionId])).rows[0];assert.equal(new Date(stored.expires_at)-new Date(stored.issued_at),30*86400000);
  assert.equal((await post('/my-shiloh/code-auth/verify',{request,code},browserCookie)).status,401);
  assert.equal((await post('/my-shiloh/auth/crm/sign-in',{})).status,410);assert.equal((await post('/my-shiloh/auth/crm/reauthenticate',{},sessionCookie)).status,410);
  const oldWelcome=await fetch(origin+'/my-shiloh/code-auth/welcome',{headers:{Cookie:sessionCookie},redirect:'manual'});assert.equal(oldWelcome.status,303);assert.equal(oldWelcome.headers.get('location'),'/my-shiloh/');
  assert.equal((await post('/my-shiloh/code-auth/fallback/sms',{purpose:'signin',request},browserCookie)).status,401);
  await release.stop();assert.equal(release.status().enabled,false);assert.equal((await fetch(origin+'/my-shiloh/code-auth/')).status,404);
  html=await (await fetch(origin+'/my-shiloh/')).text();assert.doesNotMatch(html,/data-client-code-sign-in|data-client-crm-form/);
  assert.equal((await h.sessions.validateSessionToken(token)).ok,true);assert.equal((await post('/my-shiloh/auth/crm/sign-in',{})).status,410);
});

test('paused approved-contract inventory cannot open production sender or resurrect retired details',async t=>{
  const h=await clientHarness(t),sent=[];const release=createProductionClientCode({env:settings(),canonicalDb:h.db,PoolClass:fakePool(h),fetchImpl:provider(sent,{approved:false})});t.after(()=>release.stop());
  assert.equal((await release.start()).ok,false);assert.equal(release.status().enabled,false);assert.equal(release.status().detailsSigninRetired,true);assert.equal(sent.length,0);
});

test('My Shiloh production worker survives temporary database failure without hiding sign-in',async t=>{
  const h=await clientHarness(t),owner=await h.owner(),sent=[],events=[];let fail=false;
  const Base=fakePool(h);class FlakyPool extends Base {async connect(){if(fail)throw Error('synthetic private DB failure');return super.connect();}}
  const log={warn:event=>events.push(event),info:event=>events.push(event)};
  const release=createProductionClientCode({env:settings(),canonicalDb:h.db,PoolClass:FlakyPool,fetchImpl:provider(sent),now:h.now,log});
  t.after(()=>release.stop());const app=express();release.mount(app);const origin=await serve(t,app);
  assert.equal((await release.start()).ok,true);fail=true;
  await waitUntil(()=>events.some(e=>e.event==='worker_recovering'));
  assert.equal(release.status().enabled,true);assert.equal(release.status().worker.state,'recovering');
  const page=await fetch(origin+'/my-shiloh/code-auth/');assert.equal(page.status,200);
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  fail=false;
  await waitUntil(()=>events.some(e=>e.event==='worker_recovered'));
  assert.equal(release.status().enabled,true);assert.equal(release.status().worker.state,'running');
  assert.equal(sent.length,0);assert.doesNotMatch(JSON.stringify(events),/private DB|synthetic-only-token/);
  const start=await post('/my-shiloh/code-auth/start',{mobile:h.context.mobile});assert.equal(start.status,200);
  const request=(await start.json()).request;await waitUntil(()=>sent.length===1);
  const code=sent[0].template.components.find(c=>c.type==='body').parameters[0].text;
  let verified;await waitUntil(async()=>{verified=await post('/my-shiloh/code-auth/verify',{request,code});return verified.status===200;});
  assert.equal(String((await verified.json()).client.id),String(owner.id));assert.equal(sent.length,1);
  await release.stop();assert.equal(release.status().enabled,false);assert.equal(release.status().worker.state,'stopped');
});

test('migration 198 is additive and transactionally preserves existing sessions, credentials and invitation visits',async t=>{
  const h=await clientHarness(t,{applyClientMigration:false}),owner=await h.owner({mobile_verified_at:null});
  const issued=await h.sessions.issueCrmDetailSession({transaction:h.db,owner});
  await h.db.query("CREATE TABLE code_auth_invitation_visits(audience TEXT,session_id BIGINT,expires_at TIMESTAMPTZ,PRIMARY KEY(audience,session_id))");
  await h.db.query("INSERT INTO code_auth_invitation_visits VALUES('staff',900001,NOW()+INTERVAL '1 hour')");
  const before=(await h.db.query('SELECT * FROM client_browser_sessions')).rows,visits=(await h.db.query('SELECT * FROM code_auth_invitation_visits')).rows;
  const sql=fs.readFileSync('migrations/198_my_shiloh_client_code_auth.sql','utf8'),c=await h.db.connect();
  const statements=sql.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);const apply=async()=>{for(const s of statements)await c.query(s);};
  try{await c.query('BEGIN');await apply();await c.query('ROLLBACK');assert.equal((await c.query("SELECT to_regclass('client_code_records') AS r")).rows[0].r,null);
    await c.query('BEGIN');await apply();await c.query('COMMIT');}finally{c.release();}
  assert.deepEqual((await h.db.query('SELECT * FROM code_auth_invitation_visits')).rows,visits);
  assert.deepEqual((await h.db.query('SELECT id,token_hash,csrf_hash,issued_at,expires_at,auth_method FROM client_browser_sessions')).rows,before.map(({id,token_hash,csrf_hash,issued_at,expires_at,auth_method})=>({id,token_hash,csrf_hash,issued_at,expires_at,auth_method})));
  assert.equal((await h.sessions.validateSessionToken(issued.sessionToken)).ok,true);assert.equal((await h.db.query('SELECT * FROM client_code_records')).rows.length,0);assert.equal((await h.db.query('SELECT * FROM client_code_rates')).rows.length,0);
  assert.doesNotMatch(sql.replace(/^--.*$/gm,''),/UPDATE\s+crm_v2_clients|DELETE|DROP|GRANT|TRUNCATE/i);
});
