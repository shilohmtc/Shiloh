'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {fixture,registrationResponse,RP_ID,ORIGIN}=require('./helpers/workspaceWhatsAppWebauthn');
const {createStaffDetailAuthRouter}=require('../src/routes/staffDetailAuth');
const {createStaffDetailAuthService}=require('../src/services/staffDetailAuth');
const {createStaffPasskeyAuthService}=require('../src/services/staffPasskeyAuth');
const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
const {createStaffPasskeyBootstrapRouter}=require('../src/routes/staffPasskeyBootstrap');
const {createWorkspaceStaffMutationRouter}=require('../src/routes/workspaceStaffMutations');
const {staffDetailAuthEnabled,staffOwnPasskeysEnabled}=require('../src/services/staffDetailIdentity');
const {bootstrapPolicy}=require('../src/services/staffPasskeyDeviceBootstrap');
const {createStaffSmsDeviceSetupService}=require('../src/services/staffSmsDeviceSetup');
const {createStaffCalendarAccessPageHandler,bootstrapAwareSigninScript}=require('../src/routes/staffCalendarAccessUx');
const {passkeyNavigationClientScript}=require('../src/routes/workspaceOperational');
const {staffSmsSetupPanel}=require('../src/presentation/workspaceAccessV2Ux');
const {workspaceStaffOnboardingClientScript}=require('../src/presentation/workspaceStaffOnboardingUx');
const {managePage,manageScript}=require('../src/presentation/staffPasskeyUx');
const env={SHILOH_STAFF_DETAIL_AUTH_RETIRED:'true',SHILOH_STAFF_DETAIL_AUTH_ENABLED:'true',
  SHILOH_STAFF_DETAIL_AUTH_RATE_KEY:'synthetic-rate-key'.repeat(3),SHILOH_STAFF_PASSKEY_AUTH_ENABLED:'true',
  SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true',
  MY_SHILOH_SMS_AUTH_ENABLED:'true',SHILOH_CALENDAR_PUBLIC_ORIGIN:ORIGIN};
async function serve(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
  return{origin,request:(path,method='GET',body={})=>fetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,
    'Content-Type':'application/json',Cookie:'shiloh_staff_session='+'B'.repeat(43),'x-shiloh-csrf-token':'synthetic-csrf'},...(method==='POST'?{body:JSON.stringify(body)}:{})})};}

test('retirement is explicit and overrides all old flags without consulting identity, session, database or gateway',async t=>{
  assert.equal(staffDetailAuthEnabled({...env,SHILOH_STAFF_DETAIL_AUTH_RETIRED:'false'}),true);
  assert.equal(staffDetailAuthEnabled(env),false);assert.equal(staffOwnPasskeysEnabled(env),true);
  let calls=0;const forbidden=()=>{calls++;throw Error('Retired dependency reached');};
  const auth=createStaffDetailAuthService({env,db:{query:forbidden,connect:forbidden}});
  assert.equal((await auth.attempt({input:{firstName:'Synthetic',surname:'Staff',dateOfBirth:'1990-01-01',mobile:'27820000001'},address:'192.0.2.1'})).ok,false);
  const app=express();app.use(express.json());app.use('/details',createStaffDetailAuthRouter({env,auth:{attempt:forbidden},
    setup:{read:forbidden,save:forbidden},sessions:{validateSessionToken:forbidden}}));const http=await serve(t,app);
  for(const [path,method] of [['/sign-in','POST'],['/signin.js','GET'],['/manage','GET'],['/setup','POST'],['/setup.js','GET']]){
    const r=await http.request('/details'+path,method);assert.equal(r.status,410);assert.match(r.headers.get('cache-control'),/no-store/);
    assert.equal(r.headers.get('set-cookie'),null);assert.match(await r.text(),/saved passkey or a WhatsApp code/);
  }
  assert.equal(calls,0);
});

test('retirement cannot revive SMS, private setup, replacement or rename even with the old details flag disabled',async t=>{
  for(const oldFlag of ['false','true']){
    const current={...env,SHILOH_STAFF_DETAIL_AUTH_ENABLED:oldFlag};let calls=0;const forbidden=()=>{calls++;throw Error('Retired sender reached');};
    assert.equal(bootstrapPolicy(current).enabled,false);
    const sms=createStaffSmsDeviceSetupService({env:current,db:{query:forbidden},gateway:{enabled:forbidden},bootstrapService:{}});
    assert.equal(sms.enabled(),false);assert.equal((await sms.issue({})).ok,false);assert.equal((await sms.verify({})).ok,false);
    const session={ok:true,sessionId:1,adminId:1,authMethod:'passkey'};
    const sessions={validateSessionToken:async()=>session,validateCsrfToken:()=>true};const app=express();app.use(express.json());
    app.use('/passkeys',createStaffPasskeyBootstrapRouter({env:current,bootstrapService:{startRegistration:forbidden},smsSetupService:{}}));
    app.use('/passkeys',createStaffPasskeyAuthRouter({env:current,sessionService:sessions,passkeyService:{},bootstrapService:{}}));
    app.use('/team',createWorkspaceStaffMutationRouter({env:current,sessionService:sessions,staffSmsDeviceSetupService:{issue:forbidden}}));
    const http=await serve(t,app);
    for(const [path,method] of [['/bootstrap','GET'],['/bootstrap/start','POST'],['/sms-setup','GET'],['/sms-setup/verify','POST'],['/self-bootstrap','POST'],['/9/rename','POST']]){
      const r=await http.request('/passkeys'+path,method);assert.equal(r.status,410,path);assert.doesNotMatch(await r.text(),/recorded details|Record staff sign-in details/);
    }
    assert.equal((await http.request('/passkeys/registration/options','POST',{mode:'replace'})).status,410);
    assert.equal((await http.request('/team/workspace-access/9/sms-device-setup','POST')).status,410);assert.equal(calls,0);
  }
});

test('retired public entry offers only saved passkeys and the live WhatsApp channel, including provider outages',async t=>{
  let available=true;const app=express();app.get('/staff',createStaffCalendarAccessPageHandler({env,whatsappAvailable:()=>available}));
  const http=await serve(t,app);const page=await(await http.request('/staff')).text();
  assert.match(page,/Use a saved passkey/);assert.match(page,/Sign in with WhatsApp/);assert.doesNotMatch(page,/date.of.birth|First name|Surname|details\/signin|private setup link/i);
  available=false;const fallback=await(await http.request('/staff')).text();assert.match(fallback,/Use a saved passkey/);assert.match(fallback,/WhatsApp sign-in is temporarily unavailable/);assert.doesNotMatch(fallback,/staff-auth\/whatsapp|details\/signin/);
  const script=bootstrapAwareSigninScript(env);assert.doesNotMatch(script,/staff details|SMS device setup|private setup link|Devices & sign-in|fresh setup link/i);
});

test('account, access, onboarding and own-passkey screens remove retired instructions without enabling new setup',()=>{
  const nav=passkeyNavigationClientScript(env);assert.match(nav,/My passkeys/);assert.doesNotMatch(nav,/details\/manage|My sign-in details/);
  const access=staffSmsSetupPanel({id:2,active:true},1,false,true);assert.match(access,/WhatsApp code/);assert.doesNotMatch(access,/details\/manage|data-staff-sms|date of birth/);
  const onboarding=workspaceStaffOnboardingClientScript({detailsRetired:true});assert.match(onboarding,/Ready for Workspace sign-in/);assert.doesNotMatch(onboarding,/date of birth|SMS setup|sign in with their details/);
  for(const html of [managePage({optionalPasskeys:true,detailsRetired:true}),manageScript({optionalPasskeys:true,detailsRetired:true})]){
    assert.match(html,/WhatsApp code/);assert.doesNotMatch(html,/staff details|recorded staff details|SMS device setup/);}
});

function assertion(f,challenge){const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin:ORIGIN,crossOrigin:false}));
  const authenticatorData=Buffer.alloc(37);crypto.createHash('sha256').update(RP_ID).digest().copy(authenticatorData);authenticatorData[32]=5;authenticatorData.writeUInt32BE(1,33);
  const signature=crypto.sign('sha256',Buffer.concat([authenticatorData,crypto.createHash('sha256').update(clientDataJSON).digest()]),f.privateKey);
  return{id:f.credentialId.toString('base64url'),rawId:f.credentialId.toString('base64url'),type:'public-key',response:{clientDataJSON:clientDataJSON.toString('base64url'),authenticatorData:authenticatorData.toString('base64url'),signature:signature.toString('base64url'),userHandle:null}};}

test('a real pre-cutover details session and saved passkey survive; new details issuance stops and native sign-in still works',async t=>{
  const h=await harness(t),current={...h.env,...env,SHILOH_STAFF_DETAIL_AUTH_RETIRED:'false'};
  await h.db.query("UPDATE staff_admin_accounts SET sign_in_first_name='Synthetic',sign_in_surname='Staff',sign_in_date_of_birth='1990-01-01' WHERE id=1");
  const auth=createStaffDetailAuthService({env:current,db:h.db,now:h.now});const input={firstName:'Synthetic',surname:'Staff',dateOfBirth:'1990-01-01',mobile:'27820000001'};
  const old=await auth.attempt({input,address:'192.0.2.1'});assert.equal(old.ok,true);
  const session=await h.sessions.validateSessionToken(old.sessionToken);assert.equal(session.authMethod,'staff_details');
  const before=(await h.db.query('SELECT expires_at FROM staff_browser_sessions WHERE id=$1',[old.sessionId])).rows[0].expires_at;
  const keys=createStaffPasskeyAuthService({db:h.db,env:current,now:h.now});const start=await keys.beginRegistration({session});assert.equal(start.ok,true);
  const f=fixture();assert.equal((await keys.finishRegistration({session,response:registrationResponse(f,{challenge:start.options.challenge})})).ok,true);
  current.SHILOH_STAFF_DETAIL_AUTH_RETIRED='true';current.SHILOH_STAFF_DETAIL_AUTH_ENABLED='false';
  const count=Number((await h.db.query('SELECT count(*) AS n FROM staff_browser_sessions')).rows[0].n);
  assert.equal((await auth.attempt({input,address:'192.0.2.1'})).ok,false);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM staff_browser_sessions')).rows[0].n),count);
  assert.equal((await h.sessions.validateSessionToken(old.sessionToken)).ok,true);
  assert.equal(+new Date((await h.db.query('SELECT expires_at FROM staff_browser_sessions WHERE id=$1',[old.sessionId])).rows[0].expires_at),+new Date(before));
  assert.equal((await keys.listCredentials({session})).ok,true);
  const begin=await keys.beginAuthentication({credentialIdHint:f.credentialId.toString('base64url')});assert.equal(begin.ok,true);
  const signed=await keys.finishAuthentication({response:assertion(f,begin.options.challenge)});assert.equal(signed.ok,true);
  assert.equal((await h.sessions.validateSessionToken(signed.sessionToken)).authMethod,'passkey');
  assert.equal((await h.sessions.validateSessionToken(old.sessionToken)).ok,true);
  assert.equal((await keys.beginRegistration({session})).ok,true); // existing bounded own-account right, not a new details login
  const invalid=await keys.beginRegistration({session:{...session,authMethod:'workspace_whatsapp'}});assert.equal(invalid.ok,false);
});

test('saved-passkey owners do not need old biographical fields; revoked, expired and recovery sessions still fail',async t=>{
  const h=await harness(t),keys=createStaffPasskeyAuthService({db:h.db,env,now:h.now});
  const session=await h.sessions.validateSessionToken(h.operatorSession.sessionToken);
  assert.equal((await keys.listCredentials({session})).ok,true);
  assert.equal((await keys.beginRegistration({session})).ok,true);
  assert.equal((await keys.listCredentials({session:{...session,recoveryRequired:true}})).ok,false);
  await h.db.query('UPDATE staff_browser_sessions SET revoked_at=NOW() WHERE id=$1',[session.sessionId]);
  assert.equal((await keys.listCredentials({session})).ok,false);
  await h.db.query('UPDATE staff_browser_sessions SET revoked_at=NULL WHERE id=$1',[session.sessionId]);
  h.advance(8*3600000+1000);
  assert.equal((await keys.listCredentials({session})).ok,false);
  assert.equal((await keys.beginRegistration({session})).ok,false);
});

test('WhatsApp sign-in and its eight-hour session remain available after details retirement',async t=>{
  const h=await harness(t,{env});const signed=await h.code();assert.equal(signed.ok,true);
  assert.equal((await h.sessions.validateSessionToken(signed.sessionToken)).authMethod,'workspace_whatsapp');
  assert.equal(+new Date(signed.expiresAt)-+h.now(),8*3600000);
  assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
});
