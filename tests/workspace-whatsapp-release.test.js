'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {createWorkspaceWhatsAppRelease,parseManifest,ENABLED,MANIFEST,TOKEN,KEY}=require('../src/services/workspaceWhatsAppRelease');
const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
const BASE='/calendar/staff-auth/whatsapp';
const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en',category:'AUTHENTICATION',message_send_ttl_seconds:300,
  components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},
    {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
function configuration(h) {
  return {...h.env,[ENABLED]:'true',[TOKEN]:'synthetic-never-print-token',[KEY]:'7a'.repeat(32),[MANIFEST]:JSON.stringify({
    pilot:{subjectId:1,operatorId:2,scopeId:'synthetic_release_scope_01',startsAt:new Date(+h.now()-60000).toISOString(),
      endsAt:new Date(+h.now()+3600000).toISOString(),maxMessages:3,maxSpendMinor:500,recoveryEnabled:true},
    template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',
    budgets:{currency:'ZAR',dailySpendMinor:500,whatsappCostMinor:100,smsCostMinor:100,smsAccountDailyLimit:2,smsClinicDailyLimit:2},
  })};
}
async function serve(t,release,options={}) {
  const app=express();app.use(express.json());release.mount(app);
  app.use('/calendar/staff-auth/passkeys',createStaffPasskeyAuthRouter({env:{SHILOH_STAFF_DETAIL_SIGNIN_ENABLED:'false'},
    sessionService:{},bootstrapService:{},passkeyService:{finishAuthentication:async()=>({ok:true,
      sessionToken:'synthetic-session',csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+60000)})},
    successDestination:options.destination??release.passkeySuccessDestination}));
  app.get('/existing',(_req,res)=>res.send('existing access'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await release.stop();await new Promise(r=>server.close(r));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {get:path=>fetch(origin+path),post:path=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})};
}

test('release manifest is bounded and cannot carry arbitrary extra configuration',()=>{
  for(const value of [undefined,'[]','null','{','x'.repeat(32769),JSON.stringify({pilot:{},accessToken:'not-allowed'})])assert.equal(parseManifest(value),null);
  assert.deepEqual(parseManifest('{"pilot":{}}'),{pilot:{}});
});

test('production pool is lazy and bounded; idle errors cannot crash existing access or expose raw errors',async()=>{
  const pools=[],warnings=[],canonical={};let composition;
  class SyntheticPool extends EventEmitter {
    constructor(options){super();this.options=options;this.ends=0;pools.push(this);}
    async query(){return {rows:[]};}
    async end(){this.ends++;}
  }
  const dependencies={pg:{Pool:SyntheticPool},'../lib/logger':{warn:value=>warnings.push(value)},
    '../db/pool':{pool:canonical},'./staffBrowserSession':{createStaffBrowserSessionService:({db})=>{assert.equal(db,canonical);return {}; }},
    './workspaceWhatsAppRelease':{createWorkspaceWhatsAppRelease:options=>{composition=options;return {};}}};
  vm.runInNewContext(fs.readFileSync('src/services/workspaceWhatsAppProduction.js','utf8'),{
    module:{exports:{}},process:{env:{DATABASE_URL:'postgres://synthetic.invalid/synthetic'}},globalThis:{fetch:()=>{throw Error('No I/O');}},
    require:name=>{assert.ok(name in dependencies);return dependencies[name];},
  });
  assert.equal(pools.length,0);await composition.db.query('SELECT 1');assert.equal(pools.length,1);
  assert.equal(pools[0].options.max,2);assert.equal(pools[0].options.statement_timeout,5000);
  assert.doesNotThrow(()=>pools[0].emit('error',Error('synthetic-private-connection-detail')));
  assert.deepEqual(warnings,['Workspace WhatsApp pilot database connection unavailable']);
  await composition.close();assert.equal(pools[0].ends,1);
});

test('disabled production composition performs no I/O and leaves ordinary passkey authentication working',async t=>{
  let calls=0;const release=createWorkspaceWhatsAppRelease({env:{[ENABLED]:'false',[TOKEN]:'synthetic-private-value',[KEY]:'6b'.repeat(32)},
    db:{query:()=>{calls++;throw Error();},connect:()=>{calls++;throw Error();}},fetchImpl:()=>{calls++;throw Error();}});
  const http=await serve(t,release);await release.start();assert.equal(calls,0);
  assert.equal((await http.get(BASE+'/')).status,404);assert.equal((await http.get('/existing')).status,200);
  const response=await http.post('/calendar/staff-auth/passkeys/authentication/finish');assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.authenticated,true);assert.equal(body.nextPath,undefined);
  assert.ok(!JSON.stringify(release.status()).includes('synthetic-private-value'));
});

test('configured release verifies Meta before opening intake, keeps recovery/SMS off and validates passkey destinations',async t=>{
  const h=await harness(t),calls=[];let closed=false;
  const release=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,close:async()=>{closed=true;},
    fetchImpl:async(url,options)=>{
      calls.push({url,method:options.method});assert.equal(options.method,'GET');
      return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:'789'}]:[{...template,status:'APPROVED'}]}));
    }});
  const http=await serve(t,release);assert.equal((await http.get(BASE+'/')).status,404);
  assert.equal((await release.start()).ok,true);assert.equal(calls.length,2);const entry=await http.get(BASE+'/');assert.equal(entry.status,200);
  assert.doesNotMatch(await entry.text(),/Replace lost passkeys|For lost-passkey replacement/);
  assert.equal((await http.get(BASE+'/approve')).status,404);
  assert.equal(await release.passkeySuccessDestination(h.priorSession.sessionToken),BASE+'/welcome');
  assert.equal(await release.passkeySuccessDestination(h.operatorSession.sessionToken),'/calendar/workspace');
  assert.equal(await release.passkeySuccessDestination('invalid'),'/calendar/workspace');
  assert.equal(release.status().smsEnabled,false);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM workspace_whatsapp_dispatch')).rows[0].n),0);
  await release.stop();assert.equal(closed,true);assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('invalid Meta credentials keep the pilot closed while preserved routes remain available',async t=>{
  const h=await harness(t);let posts=0;
  const release=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,
    fetchImpl:async(_url,options)=>{if(options.method==='POST')posts++;return new Response('{"error":{"message":"synthetic-private-error"}}',{status:401});}});
  const http=await serve(t,release);assert.equal((await release.start()).code,'PILOT_PROVIDER_UNREADY');
  assert.equal((await http.get(BASE+'/')).status,404);assert.equal((await http.get('/existing')).status,200);assert.equal(posts,0);
  assert.ok(!JSON.stringify(release.status()).includes('synthetic-private-error'));
});

test('private participant inspection returns canonical IDs and phone endings without selecting authentication material',async t=>{
  const h=await harness(t);await h.db.query("UPDATE staff_admin_accounts SET display_name=CASE id WHEN 1 THEN 'Christel' ELSE 'Jean-Pierre' END");
  const release=createWorkspaceWhatsAppRelease({env:{SHILOH_WORKSPACE_WHATSAPP_PILOT_INSPECT:'true'},db:h.db});
  const result=await release.inspectParticipants();assert.equal(result.participants.length,2);
  assert.deepEqual(result.participants.map(x=>Number(x.id)),[1,2]);
  assert.equal(result.participants[0].phone_ending,'0001');assert.ok(!JSON.stringify(result).includes('27820000001'));
  assert.ok(result.participants.every(x=>!('normalized_whatsapp'in x)&&!('token_hash'in x)));
  await release.stop();
});

test('release rejects ambiguous phones, inactive participants and unlinked authority before Meta I/O',async t=>{
  const h=await harness(t);let calls=0;
  for(const [setup,restore] of [
    ["UPDATE staff_admin_accounts SET normalized_whatsapp='27820000001' WHERE id=2","UPDATE staff_admin_accounts SET normalized_whatsapp='27820000002' WHERE id=2"],
    ["UPDATE staff_admin_accounts SET active=false WHERE id=1","UPDATE staff_admin_accounts SET active=true WHERE id=1"],
    ["UPDATE staff_admin_accounts SET active=false WHERE id=2","UPDATE staff_admin_accounts SET active=true WHERE id=2"],
    ["UPDATE staff_admin_accounts SET normalized_whatsapp='invalid' WHERE id=1","UPDATE staff_admin_accounts SET normalized_whatsapp='27820000001' WHERE id=1"],
    ["UPDATE staff_admin_accounts SET role='unknown',business_role='unknown',permissions='{}' WHERE id=1","UPDATE staff_admin_accounts SET role='owner',business_role='owner',permissions='{\"appointment:view\":true}' WHERE id=1"],
  ]) {
    await h.db.query(setup);
    const release=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,
      fetchImpl:async()=>{calls++;throw Error('Must not contact provider');}});
    assert.equal((await release.start()).code,'PILOT_PARTICIPANTS_UNREADY');
    assert.equal(release.status().enabled,false);await release.stop();await h.db.query(restore);
  }
  assert.equal(calls,0);
});

test('passkey completion only returns the fixed welcome destination and survives hook failures',async t=>{
  for(const [destination,expected] of [[async()=>BASE+'/welcome',BASE+'/welcome'],[async()=>'https://evil.example/',undefined],[async()=>{throw Error('synthetic');},undefined]]) {
    const release=createWorkspaceWhatsAppRelease(),http=await serve(t,release,{destination});
    const r=await http.post('/calendar/staff-auth/passkeys/authentication/finish');assert.equal(r.status,200);
    const body=await r.json();assert.equal(body.authenticated,true);assert.equal(body.nextPath,expected);
  }
});

test('staff migration preserves an existing future auth method while adding the new channel methods',async t=>{
  const h=await harness(t,{beforeWorkspaceMigration:pg=>pg.exec(`ALTER TABLE staff_browser_sessions DROP CONSTRAINT staff_browser_session_auth_method_check;
    ALTER TABLE staff_browser_sessions ADD CONSTRAINT staff_browser_session_auth_method_check
    CHECK(auth_method IN ('passkey','staff_details','future_verified_method'));`)});
  for(const [i,method] of ['future_verified_method','workspace_whatsapp','workspace_sms'].entries()) {
    await h.db.query(`INSERT INTO staff_browser_sessions(admin_id,token_hash,csrf_hash,auth_method,expires_at)
      VALUES(1,$1,$2,$3,NOW()+INTERVAL '1 hour')`,[(i+3).toString(16).repeat(64),'e'.repeat(64),method]);
  }
  assert.equal(Number((await h.db.query("SELECT count(*) AS n FROM staff_browser_sessions WHERE auth_method='future_verified_method'")).rows[0].n),1);
  await assert.rejects(h.db.query(`INSERT INTO staff_browser_sessions(admin_id,token_hash,csrf_hash,auth_method,expires_at)
    VALUES(1,$1,$2,'unapproved_method',NOW()+INTERVAL '1 hour')`,['a'.repeat(64),'b'.repeat(64)]));
});
