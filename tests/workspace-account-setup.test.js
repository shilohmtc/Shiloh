'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {harness}=require('./helpers/workspaceWhatsAppHarness');
const {createWorkspaceWhatsAppRouter,BASE}=require('../src/routes/workspaceWhatsAppAuth');
const {createAuthInvitations}=require('../src/services/authInvitations');
test('in-app staff setup uses only its authenticated owner, requires CSRF, and needs no previous OTP cookie',async t=>{
  const h=await harness(t),app=express();
  await h.db.query(`INSERT INTO staff_auth_passkey_credentials(admin_id,credential_id,public_key_spki,algorithm,sign_count,transports,device_label)
    VALUES(2,$1,$2,-7,0,'[]','Synthetic other account')`,['Q'.repeat(43),Buffer.from('synthetic')]);
  app.use(BASE,createWorkspaceWhatsAppRouter({enabled:true,service:h.service,sessions:h.sessions,invitations:createAuthInvitations({db:h.db,audience:'staff'}),env:h.env,recoveryEnabled:false}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,headers={Origin:origin,'Content-Type':'application/json',Cookie:'shiloh_staff_session='+h.priorSession.sessionToken,'x-shiloh-csrf-token':h.priorSession.csrfToken};
  const post=(extra={},path='/invitations/visit')=>fetch(origin+BASE+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify({adminId:2,sessionId:h.operatorSession.sessionId})});
  assert.equal((await post({Cookie:''})).status,401);const denied=await post({'x-shiloh-csrf-token':'wrong'});assert.equal(denied.status,403);assert.equal(denied.headers.get('set-cookie'),null);
  assert.equal((await post({Origin:'https://other.example'})).status,403);
  const allowed=await post();assert.equal(allowed.status,200);assert.match(allowed.headers.get('cache-control'),/private.*no-store/);assert.match(allowed.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const result=await allowed.json();assert.equal(result.accountId,1);assert.equal(result.passkey,true);assert.equal(result.show,true);
  const other=await post({Cookie:'shiloh_staff_session='+h.operatorSession.sessionToken,'x-shiloh-csrf-token':h.operatorSession.csrfToken});const own=await other.json();assert.equal(own.accountId,2);assert.equal(own.passkey,false);
  assert.equal((await post({},'/start')).status,429);assert.equal(h.sent.length,0);
  const welcome=await fetch(origin+BASE+'/welcome',{headers:{Cookie:headers.Cookie},redirect:'manual'});assert.equal(welcome.status,303);assert.equal(welcome.headers.get('location'),'/calendar/workspace');
});
