'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {fixture,registrationResponse}=require('./helpers/workspaceWhatsAppWebauthn');
const {createWorkspaceWhatsAppAuth}=require('../src/services/workspaceWhatsAppAuth');
const {createWorkspaceWhatsAppStaffPolicy}=require('../src/services/workspaceWhatsAppStaff');
const {createWorkspaceWhatsAppPilotPolicy}=require('../src/services/workspaceWhatsAppPilot');
const {createWorkspaceWhatsAppRelease,STAFF_ENABLED,STAFF_MANIFEST,ENABLED,TOKEN,KEY,parseManifest}=require('../src/services/workspaceWhatsAppRelease');
const budgets={currency:'ZAR',dailySpendMinor:500,whatsappCostMinor:100,smsCostMinor:100,smsAccountDailyLimit:2,smsClinicDailyLimit:2};
const staff={scopeId:'synthetic_ongoing_staff_01',startsAt:'2026-10-01T00:00:00Z',audience:'active_workspace_accounts'};
const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en',category:'AUTHENTICATION',message_send_ttl_seconds:300,
  components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},
    {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
const policy=()=>createWorkspaceWhatsAppStaffPolicy(staff);
const service=(h,extra={})=>createWorkspaceWhatsAppAuth({enabled:true,store:h.store,delivery:h.delivery,hmacKey:Buffer.alloc(32,7),
  env:h.env,now:h.now,budgets,accessPolicy:policy(),...extra});
const configuration=h=>({...h.env,[STAFF_ENABLED]:'true',[TOKEN]:'synthetic-only',[KEY]:'7a'.repeat(32),[STAFF_MANIFEST]:JSON.stringify({
  staff,template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',budgets})});
async function issue(h,s,input={}){const r=await s.begin({...h.context,...input});await s.dispatchOne();return r;}
const pilot=h=>createWorkspaceWhatsAppPilotPolicy({subjectId:1,operatorId:2,scopeId:'synthetic_previous_pilot_01',
  startsAt:new Date(+h.now()-60000).toISOString(),endsAt:new Date(+h.now()+3600000).toISOString(),maxMessages:3,maxSpendMinor:500},100);

test('ongoing staff policy is explicit, rejects extra authority and never expires by a pilot window',()=>{
  const p=policy();assert.equal(p.valid,true);assert.equal(p.withinWindow('2026-09-30T23:59:59Z'),false);
  assert.equal(p.allowsSubject(250,'signin','2030-01-01T00:00:00Z'),true);
  for(const id of [true,{},0,-1,'01','Christel'])assert.equal(p.allowsSubject(id,'signin',new Date()),false);
  assert.equal(p.allowsSubject(1,'recover',new Date()),false);assert.equal(p.allowsOperator(2,new Date()),false);
  for(const input of [null,{}, {...staff,audience:'clients'},{...staff,subjectId:1},{...staff,recoveryEnabled:true},
    {...staff,startsAt:'2026-10-01T00:00:00'},{...staff,scopeId:'short'}])assert.equal(createWorkspaceWhatsAppStaffPolicy(input).valid,false);
  assert.equal(parseManifest(JSON.stringify({staff}), 'staff').staff.audience,staff.audience);
  assert.equal(parseManifest(JSON.stringify({staff,pilot:{}}),'staff'),null);
});

test('default-off, conflicting modes and malformed staff configuration perform no database or provider work',async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('No I/O');};
  for(const env of [{},{[STAFF_ENABLED]:'true'}, {[STAFF_ENABLED]:'true',[ENABLED]:'true'}]){
    const r=createWorkspaceWhatsAppRelease({env,db:{query:forbidden,connect:forbidden},fetchImpl:forbidden});
    assert.equal((await r.start()).ok,false);assert.equal(r.status().enabled,false);await r.stop();
  }
  assert.equal(calls,0);
});

test('all eligible canonical accounts can sign in; enrollment uses own session rather than submitted identity',async t=>{
  const h=await harness(t),s=service(h);
  for(const [id,sessionId] of [[1,h.priorSession.sessionId],[2,h.operatorSession.sessionId]]){
    const input={mobile:`2782000000${id}`,browserToken:String(id).repeat(43)},r=await issue(h,s,input);
    const verified=await s.verify({...h.context,...input,request:r.request,code:h.sent.at(-1).code});assert.equal(verified.ok,true);
    const validated=await h.sessions.validateSessionToken(verified.sessionToken);assert.equal(validated.adminId,id);
    assert.equal(+new Date(verified.expiresAt)-+h.now(),8*3600000);
    const grant=await s.requestOwnEnrollment({...h.context,...input,sessionId,proof:'passkey',adminId:3-id,mobile:`2782000000${3-id}`});
    assert.equal(grant.ok,true);const start=await s.beginRegistration({grant:grant.grant,browserToken:input.browserToken});
    const result=await s.finishRegistration({grant:grant.grant,browserToken:input.browserToken,
      response:registrationResponse(fixture(),{challenge:start.options.challenge}),deviceLabel:'Synthetic staff phone'});
    assert.equal(result.ok,true);assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).adminId,id);
    assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:input.browserToken})).ok,false);
  }
  assert.equal((await h.db.query('SELECT id FROM staff_auth_passkey_credentials WHERE revoked_at IS NULL')).rows.length,2);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
  assert.equal((await h.sessions.validateSessionToken(h.operatorSession.sessionToken)).ok,true);
});

test('ineligible and unknown identities receive generic intake without provider reads or sends',async t=>{
  const h=await harness(t);let reads=0;
  const s=service(h,{delivery:{...h.delivery,readiness:async()=>{reads++;return{ready:true,codeTtlSeconds:300};}}});
  for(const [setup,restore,mobile] of [
    ['SELECT 1','SELECT 1','27820000999'],
    ['UPDATE staff_admin_accounts SET active=false WHERE id=1','UPDATE staff_admin_accounts SET active=true WHERE id=1','27820000001'],
    ["UPDATE staff_admin_accounts SET normalized_whatsapp='27820000001' WHERE id=2","UPDATE staff_admin_accounts SET normalized_whatsapp='27820000002' WHERE id=2",'27820000001'],
    ["INSERT INTO staff VALUES(9,'inactive'); UPDATE staff_admin_accounts SET staff_id=9 WHERE id=1",'UPDATE staff_admin_accounts SET staff_id=NULL WHERE id=1','27820000001'],
    ["UPDATE staff_admin_accounts SET role='unknown',business_role='unknown',permissions='{}' WHERE id=1","UPDATE staff_admin_accounts SET role='owner',business_role='owner',permissions='{\"appointment:view\":true}' WHERE id=1",'27820000001'],
  ]){
    await h.pg.exec(setup);const r=await s.begin({...h.context,mobile});assert.equal(r.accepted,true);assert.equal(reads,0);
    await s.dispatchOne();assert.equal(reads,0);assert.equal(h.sent.length,0);await h.db.query(restore);h.advance(11*60000);
  }
  await h.db.query("UPDATE staff_admin_accounts SET normalized_whatsapp='invalid' WHERE id=1");
  assert.equal((await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'})).ok,false);
});

test('R5 allowance and resend cooldown survive pilot cutover, staff scope change and restart',async t=>{
  const h=await harness(t),old=service(h,{accessPolicy:pilot(h)}),s=service(h);
  await issue(h,old);assert.equal(h.sent.length,1);
  await issue(h,s);assert.equal(h.sent.length,1); // existing cooldown defers new-mode intake
  h.advance(60000);await s.dispatchOne();assert.equal(h.sent.length,2);
  for(let i=0;i<4;i++){
    h.advance(11*60000);await issue(h,service(h,{accessPolicy:createWorkspaceWhatsAppStaffPolicy({...staff,scopeId:'synthetic_changed_scope_02'})}),{mobile:`2782000000${i%2+1}`});
  }
  assert.equal(h.sent.length,5); // sixth reservation cannot exceed R5
  const spend=(await h.db.query('SELECT attempts FROM workspace_whatsapp_rate_buckets WHERE attempts=500')).rows;assert.equal(spend.length,1);
});

test('clinic ten-code ceiling is shared across people even when budget is higher',async t=>{
  const h=await harness(t);h.advance(+new Date('2026-10-18T08:00:00Z')-+h.now());for(let i=0;i<11;i++){
    if(i)h.advance(11*60000);
    await issue(h,service(h,{budgets:{...budgets,dailySpendMinor:100000}}),{mobile:`2782000000${i%2+1}`});
  }
  assert.equal(h.sent.length,10);
});

test('pilot and staff workers claim only matching queues; stale grants and codes cannot cross modes',async t=>{
  const h=await harness(t),old=service(h,{accessPolicy:pilot(h)}),s=service(h);
  const oldRequest=await old.begin(h.context),newRequest=await s.begin({...h.context,mobile:'27820000002'});
  await s.dispatchOne();assert.equal(h.sent.length,1);assert.equal(h.sent[0].mobile,'27820000002');
  await old.dispatchOne();assert.equal(h.sent.length,2);assert.equal(h.sent[1].mobile,'27820000001');
  assert.equal((await s.verify({...h.context,request:oldRequest.request,code:h.sent[1].code})).ok,false);
  assert.equal((await old.verify({...h.context,request:newRequest.request,code:h.sent[0].code})).ok,false);
  const oldGrant=await old.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'});
  assert.equal((await s.beginRegistration({grant:oldGrant.grant,browserToken:h.context.browserToken})).ok,false);
  const grant=await s.requestOwnEnrollment({...h.context,sessionId:h.priorSession.sessionId,proof:'passkey'});
  assert.equal((await old.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken})).ok,false);
  assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken})).ok,true);
  assert.equal((await old.verify({...h.context,request:oldRequest.request,code:h.sent[1].code})).ok,true);
});

test('legacy unscoped pilot requests remain pilot-only and cannot be consumed by staff mode',async t=>{
  const h=await harness(t),old=service(h,{accessPolicy:pilot(h)}),s=service(h);
  const r=await old.begin(h.context);
  await h.db.query("UPDATE workspace_whatsapp_dispatch SET payload=payload-'accessScope'");
  assert.equal((await s.dispatchOne()).processed,false);assert.equal(h.sent.length,0);
  await old.dispatchOne();assert.equal(h.sent.length,1);
  assert.equal((await s.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,false);
  assert.equal((await old.verify({...h.context,request:r.request,code:h.sent[0].code})).ok,true);
});

test('staff recovery and operator approval never dispatch; SMS cannot bypass the disabled channel',async t=>{
  const h=await harness(t),s=service(h);const r=await issue(h,s,{purpose:'recover'});assert.equal(h.sent.length,0);
  assert.equal((await s.requestSmsFallback({...h.context,request:r.request})).code,'WORKSPACE_WHATSAPP_DISABLED');
  const setup=await s.requestSetup({...h.context,purpose:'enroll'});
  assert.equal((await s.approveSetup({intent:setup.intent,sessionId:h.operatorSession.sessionId,identityConfirmed:true})).ok,false);
});

test('staff startup reports bounded canonical eligibility, rereads Meta and never sends automatically',async t=>{
  const h=await harness(t);await h.db.query("UPDATE staff_admin_accounts SET normalized_whatsapp='invalid' WHERE id=2");let reads=0;
  const r=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,fetchImpl:async(url,options)=>{
    assert.equal(options.method,'GET');reads++;return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:'789'}]:[{...template,status:'APPROVED'}]}));
  }});t.after(()=>r.stop());const start=await r.start();assert.equal(start.ok,true);assert.equal(reads,2);
  assert.equal(start.mode,'staff');assert.equal(start.staffReadiness.eligibleAccounts,1);
  assert.deepEqual(start.staffReadiness.blockedAccounts,[{id:2,displayName:'Synthetic Staff 2',reason:'recorded_mobile_missing_or_invalid'}]);
  assert.equal(JSON.stringify(start).includes('27820000001'),false);assert.equal(r.status().smsEnabled,false);
  assert.equal(await r.passkeySuccessDestination(h.priorSession.sessionToken),'/calendar/staff-auth/whatsapp/welcome');
  await r.stop();assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});

test('staff readiness with no eligible account or rejected Meta stays closed',async t=>{
  const h=await harness(t);let calls=0;
  await h.db.query('UPDATE staff_admin_accounts SET active=false');
  const r=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,fetchImpl:()=>{calls++;throw Error();}});
  assert.equal((await r.start()).code,'STAFF_NO_ELIGIBLE_ACCOUNTS');assert.equal(calls,0);await r.stop();
  await h.db.query('UPDATE staff_admin_accounts SET active=true');
  const rejected=createWorkspaceWhatsAppRelease({env:configuration(h),db:h.db,sessions:h.sessions,now:h.now,fetchImpl:async()=>new Response('{}',{status:401})});
  assert.equal((await rejected.start()).code,'STAFF_PROVIDER_UNREADY');assert.equal(rejected.status().enabled,false);await rejected.stop();
});

test('staff WhatsApp session can enroll only its own account with a fresh code and real attestation',async t=>{
  const h=await harness(t),s=service(h),r=await issue(h,s,{mobile:'27820000002'});
  const verified=await s.verify({...h.context,request:r.request,code:h.sent[0].code});assert.equal(verified.ok,true);
  const session=await h.sessions.validateSessionToken(verified.sessionToken);assert.equal(session.adminId,2);
  h.advance(60000);
  const own=await s.requestOwnEnrollment({...h.context,sessionId:session.sessionId,proof:'code',mobile:'27820000001',adminId:1});
  assert.equal(own.accepted,true);await s.dispatchOne();assert.equal(h.sent.at(-1).mobile,'27820000002');
  const grant=await s.verify({...h.context,purpose:'enroll',request:own.request,code:h.sent.at(-1).code});assert.equal(grant.ok,true);
  assert.equal((await s.beginRegistration({grant:grant.grant,browserToken:'X'.repeat(43)})).ok,false);
  const start=await s.beginRegistration({grant:grant.grant,browserToken:h.context.browserToken});assert.equal(start.ok,true);
  const result=await s.finishRegistration({grant:grant.grant,browserToken:h.context.browserToken,
    response:registrationResponse(fixture(),{challenge:start.options.challenge}),deviceLabel:'Synthetic new staff'});
  assert.equal(result.ok,true);assert.equal((await h.sessions.validateSessionToken(result.sessionToken)).adminId,2);
  assert.equal((await h.sessions.validateSessionToken(verified.sessionToken)).ok,true);
});
