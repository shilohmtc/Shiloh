const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createStaffPasskeyAuthService,b64url}=require('../src/services/staffPasskeyAuth');
const origin='https://staff.shiloh.example',now=new Date('2026-10-04T06:00:00Z');
function fixture(overrides={}) {
  const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),id=b64url(crypto.randomBytes(32));
  const state={challenge:null,consumed:false,updates:[],queries:[],credential:{id:8,admin_id:42,credential_id:id,public_key_spki:keys.publicKey.export({type:'spki',format:'der'}),algorithm:-7,sign_count:0,revoked_at:null,...overrides.credential},sessionActive:true,...overrides};
  const session={ok:true,adminId:42,sessionId:99,authMethod:'passkey',authenticatedAt:new Date(now-3600000)};
  const db={async query(sql,args=[]) {
    const q=sql.replace(/\s+/g,' ');state.queries.push(q);
    if(q.includes('FROM staff_admin_accounts a')) return {rows:[{id:Number(args[0]),admin_active:true,display_name:'JP',staff_id:null}]};
    if(q.startsWith('SELECT credential_id, transports')) return {rows:[{credential_id:id,transports:['internal']}]};
    if(q.startsWith('INSERT INTO staff_auth_webauthn_challenges')) {state.challenge={id:1,hash:args[0],admin_id:args[1],expires_at:args[3]};return {rows:[],rowCount:1};}
    if(q.startsWith('SELECT id, expires_at, admin_id FROM staff_auth_webauthn_challenges')) return {rows:!state.consumed&&state.challenge?.hash===args[0]?[state.challenge]:[]};
    if(q.startsWith('UPDATE staff_auth_webauthn_challenges')) {state.consumed=true;return {rowCount:1,rows:[]};}
    if(q.includes('FROM staff_auth_passkey_credentials WHERE credential_id')) return {rows:args[0]===id?[state.credential]:[]};
    if(q.startsWith('UPDATE staff_auth_passkey_credentials')) return {rowCount:1,rows:[]};
    if(q.startsWith('UPDATE staff_browser_sessions')) {if(!state.sessionActive)return {rowCount:0,rows:[]};state.updates.push(args);return {rowCount:1,rows:[{id:99}]};}
    if(q.startsWith('INSERT INTO staff_auth_security_events')||['BEGIN','COMMIT','ROLLBACK'].includes(q)) return {rows:[],rowCount:1};
    throw Error('Unexpected SQL '+q);
  }};
  const service=createStaffPasskeyAuthService({db,env:{SHILOH_STAFF_PASSKEY_AUTH_ENABLED:'true',SHILOH_CALENDAR_PUBLIC_ORIGIN:origin},now:()=>now});
  function assertion(challenge,changes={}) {
    const cd=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin:changes.origin||origin,crossOrigin:false}));
    const ad=Buffer.alloc(37);crypto.createHash('sha256').update('staff.shiloh.example').digest().copy(ad);ad[32]=changes.flags??5;ad.writeUInt32BE(1,33);
    const signed=Buffer.concat([ad,crypto.createHash('sha256').update(cd).digest()]);const signature=crypto.sign('sha256',signed,keys.privateKey);
    return {type:'public-key',id,rawId:id,response:{clientDataJSON:b64url(cd),authenticatorData:b64url(ad),signature:b64url(signature),userHandle:null}};
  }
  return {service,state,session,assertion};
}
test('inline verification binds options to the signed-in account and refreshes only its current live session',async()=>{
  const f=fixture();const start=await f.service.beginAuthentication({session:f.session});
  assert.equal(start.ok,true);assert.equal(f.state.challenge.admin_id,42);assert.equal(start.options.allowCredentials.length,1);assert.equal(start.discoverable,false);
  const result=await f.service.finishAuthentication({session:f.session,response:f.assertion(start.options.challenge)});
  assert.equal(result.ok,true);assert.equal(result.credentialHint,start.options.allowCredentials[0].id);
  assert.deepEqual(f.state.updates,[[99,42,now]]);
  const update=f.state.queries.find(q=>q.startsWith('UPDATE staff_browser_sessions'));
  assert.match(update,/revoked_at IS NULL AND expires_at > \$3/);assert.doesNotMatch(update,/SET expires_at|revoke_reason/);
  assert.equal(f.state.queries.some(q=>q.startsWith('INSERT INTO staff_browser_sessions')),false);
  assert.equal((await f.service.finishAuthentication({session:f.session,response:f.assertion(start.options.challenge)})).ok,false);
});
for(const scenario of ['unbound-challenge','other-account-challenge','other-account-credential','revoked-credential','expired-challenge','expired-session','wrong-origin','no-user-verification']) {
  test('inline verification rejects '+scenario+' without refreshing a session',async()=>{
    const f=fixture();const start=await f.service.beginAuthentication({session:f.session});let changes={};
    if(scenario==='unbound-challenge')f.state.challenge.admin_id=null;
    if(scenario==='other-account-challenge')f.state.challenge.admin_id=43;
    if(scenario==='other-account-credential')f.state.credential.admin_id=43;
    if(scenario==='revoked-credential')f.state.credential.revoked_at=now;
    if(scenario==='expired-challenge')f.state.challenge.expires_at=new Date(now-1);
    if(scenario==='expired-session')f.state.sessionActive=false;
    if(scenario==='wrong-origin')changes.origin='https://evil.example';
    if(scenario==='no-user-verification')changes.flags=1;
    const result=await f.service.finishAuthentication({session:f.session,response:f.assertion(start.options.challenge,changes)});
    assert.equal(result.ok,false);assert.equal(f.state.updates.length,0);
  });
}

test('verification routes enforce session, same origin and CSRF, and never accept a supplied account or issue a new session',async t=>{
  const express=require('express');const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
  const app=express(),env={NODE_ENV:'test'},calls=[];app.use(express.json());
  const sessionService={async validateSessionToken(token){return token==='fixture'?{ok:true,adminId:42,sessionId:99}: {ok:false};},validateCsrfToken(_session,token){return token==='csrf';}};
  const passkeyService={async beginAuthentication(input){calls.push(input);return {ok:true,options:{challenge:'abc'}};},async finishAuthentication(input){calls.push(input);return {ok:true,credentialHint:b64url(crypto.randomBytes(32))};}};
  app.use('/calendar/staff-auth/passkeys',createStaffPasskeyAuthRouter({env,sessionService,passkeyService}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;env.SHILOH_CALENDAR_PUBLIC_ORIGIN=base;
  async function post(path,headers={}){return fetch(base+'/calendar/staff-auth/passkeys/reauthentication/'+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify({session:{adminId:43,sessionId:7},response:{id:'fixture'}})});}
  for(const path of ['options','finish']) {
    assert.equal((await post(path)).status,401);
    assert.equal((await post(path,{cookie:'shiloh_staff_session=fixture'})).status,403);
    assert.equal((await post(path,{cookie:'shiloh_staff_session=fixture','x-shiloh-csrf-token':'csrf',origin:'https://evil.example'})).status,403);
  }
  assert.equal(calls.length,0);
  assert.equal((await post('options',{cookie:'shiloh_staff_session=fixture','x-shiloh-csrf-token':'csrf'})).status,200);
  const finish=await post('finish',{cookie:'shiloh_staff_session=fixture','x-shiloh-csrf-token':'csrf'});assert.equal(finish.status,204);
  assert.match(finish.headers.get('set-cookie'),/HttpOnly/);assert.doesNotMatch(finish.headers.get('set-cookie'),/shiloh_staff_session=/);
  assert(calls.every(c=>c.session.adminId===42&&c.session.sessionId===99));
});
