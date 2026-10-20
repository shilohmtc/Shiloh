'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {harness}=require('../tests/helpers/workspaceWhatsAppHarness');
const {issueStaffBrowserSession}=require('../src/services/staffBrowserSession');
const {workspaceWhatsAppRevision}=require('../src/services/workspaceWhatsAppIdentity');
const ux=require('../src/presentation/staffPasskeyUx');
const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
const {createWorkspaceWhatsAppRelease,ENABLED,MANIFEST,STAFF_ENABLED,STAFF_MANIFEST,TOKEN,KEY}=require('../src/services/workspaceWhatsAppRelease');
async function main() {
  const staffMode=process.argv.includes('--staff');
  const cleanups=[],h=await harness({after:fn=>cleanups.push(fn)}),app=express();
  const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en',category:'AUTHENTICATION',message_send_ttl_seconds:300,
    components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},
      {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
  const env={...h.env,SHILOH_STAFF_DETAIL_AUTH_ENABLED:'true',SHILOH_STAFF_DETAIL_AUTH_RATE_KEY:'synthetic-rate-key'.repeat(3),[ENABLED]:'true',[TOKEN]:'synthetic-only',[KEY]:'7a'.repeat(32),[MANIFEST]:JSON.stringify({
    pilot:{subjectId:1,operatorId:2,scopeId:'synthetic_browser_pilot_01',startsAt:new Date(+h.now()-60000).toISOString(),endsAt:new Date(+h.now()+3600000).toISOString(),maxMessages:3,maxSpendMinor:500},
    template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',budgets:{currency:'ZAR',dailySpendMinor:500,whatsappCostMinor:100,smsCostMinor:100,smsAccountDailyLimit:2,smsClinicDailyLimit:2}})};
  if(staffMode){
    const manifest=JSON.parse(env[MANIFEST]);delete manifest.pilot;
    manifest.staff={audience:'active_workspace_accounts',scopeId:'synthetic_browser_staff_01',startsAt:new Date(+h.now()-60000).toISOString()};
    env[ENABLED]='false';env[STAFF_ENABLED]='true';env[STAFF_MANIFEST]=JSON.stringify(manifest);
  }
  let sends=0;
  const release=createWorkspaceWhatsAppRelease({env,db:h.db,sessions:h.sessions,now:h.now,fetchImpl:async(url,options)=>{
    if(options.method!=='GET'){sends++;throw Error('No synthetic send expected');}
    return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:'789'}]:[{...template,status:'APPROVED'}]}));
  }});
  release.mount(app);app.use(express.json());
  app.use('/storybook',express.static('storybook-static'));
  app.get('/signin',(_req,res)=>res.type('html').send(`<!doctype html><html lang="en"><head><title>Staff passkey proof</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;max-width:540px;margin:24px auto;padding:16px}button{font:inherit;min-height:48px;padding:12px}</style></head><body><h1>Workspace</h1>${ux.signinPanel()}<script src="/signin.js"></script></body></html>`));
  app.get('/signin.js',(_req,res)=>res.type('application/javascript').send(ux.signinScript()));
  app.get('/calendar/workspace',(_req,res)=>res.type('html').send('<h1>Existing Workspace</h1>'));
  let currentSession,subjectId=1;
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:currentSession?.csrfToken}));
  app.use('/calendar/staff-auth/passkeys',createStaffPasskeyAuthRouter({env,sessionService:h.sessions,bootstrapService:{},
    successDestination:release.passkeySuccessDestination,whatsappEnrollmentAvailable:()=>release.status().enabled,passkeyService:{
      listCredentials:async()=>({ok:false,code:'STAFF_AUTH_FORBIDDEN'}),
      knownPrincipal:async()=>({ok:true,displayName:'Synthetic pilot staff'}),
      beginAuthentication:async()=>({ok:true,options:{challenge:'B'.repeat(43),allowCredentials:[],userVerification:'required',timeout:60000}}),
      finishAuthentication:async()=>{
        const admin=(await h.db.query('SELECT *,active AS admin_active FROM staff_admin_accounts WHERE id=$1',[subjectId])).rows[0];
        currentSession=await issueStaffBrowserSession({client:h.db,admin,current:h.now(),authMethod:'passkey'});
        return {ok:true,...currentSession};
      },
    }}));
  assert.equal((await release.start()).ok,true);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const executablePath=['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const origin=`http://127.0.0.1:${server.address().port}`,out='artifacts/workspace-whatsapp';fs.mkdirSync(out,{recursive:true});
  try {
    for(const [label,width,height] of [['phone',390,844],['desktop',1280,900]]) {
      subjectId=staffMode && label==='desktop'?2:1;
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),counts={get:0,create:0};
      await page.exposeFunction('__recordCeremony',kind=>{counts[kind]++;});
      await page.addInitScript(()=>{
        Object.defineProperty(window,'Notification',{value:{permission:'denied'},configurable:true});
        navigator.credentials.get=async()=>{await window.__recordCeremony('get');return {id:'synthetic',rawId:new Uint8Array([1]).buffer,type:'public-key',
          response:{clientDataJSON:new Uint8Array([1]).buffer,authenticatorData:new Uint8Array([1]).buffer,signature:new Uint8Array([1]).buffer,userHandle:null}};};
        navigator.credentials.create=async()=>{await window.__recordCeremony('create');throw Error('No automatic enrollment');};
      });
      for(const path of ['/calendar/staff-auth/whatsapp/',...(fs.existsSync('storybook-static/iframe.html')?
        ['/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--active-workspace-staff&viewMode=story']:[])]) {
        await page.goto(origin+path);await page.getByRole('heading',{name:'Welcome to Workspace'}).waitFor();
        assert.equal(await page.locator('select#purpose').count(),0);assert.equal(await page.locator('#purpose').inputValue(),'signin');assert.equal(await page.getByRole('option',{name:'Add a passkey',exact:true}).count(),0);
        assert.equal(await page.getByRole('button',{name:'Try an SMS code instead',exact:true}).count(),0);
        if(path.startsWith('/storybook'))await page.waitForFunction(()=>window.axe && !window.axe._running);
        assert.deepEqual((await new AxeBuilder({page}).include('main').analyze()).violations,[]);
        await page.screenshot({path:`${out}/${staffMode?'staff':'pilot'}-${label}-pilot-${path.startsWith('/storybook')?'storybook':'entry'}.png`,fullPage:true});
      }
      await page.goto(origin+'/signin');await page.getByRole('button',{name:'Continue as Synthetic pilot staff'}).waitFor();
      assert.equal(counts.get,0);await page.getByRole('button',{name:'Continue as Synthetic pilot staff'}).click();
      await page.waitForURL('**/calendar/staff-auth/whatsapp/welcome');
      await page.getByText('These choices are optional. You can continue now.').waitFor();
      await page.getByRole('heading',{name:'Make next time easier'}).waitFor();
      assert.equal(counts.get,1);assert.equal(counts.create,0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:`${out}/${staffMode?'staff':'pilot'}-${label}-saved-passkey-pilot-welcome.png`,fullPage:true});
      await page.getByRole('link',{name:'Continue to Workspace'}).click();await page.waitForURL('**/calendar/workspace');
      const admin=(await h.db.query('SELECT *,active AS admin_active FROM staff_admin_accounts WHERE id=$1',[subjectId])).rows[0];
      const codeSession=await issueStaffBrowserSession({client:h.db,admin,current:h.now(),authMethod:'workspace_whatsapp'});
      await h.db.query('UPDATE staff_browser_sessions SET detail_identity_revision=$2 WHERE token_hash=$1',
        [require('../src/services/staffBrowserSession').sha256(codeSession.sessionToken),workspaceWhatsAppRevision(admin)]);
      await context.addCookies([{name:'shiloh_staff_session',value:codeSession.sessionToken,url:origin}]);
      await page.goto(origin+'/calendar/staff-auth/passkeys/manage');
      await page.waitForURL('**/calendar/staff-auth/whatsapp/enroll');
      await page.getByRole('button',{name:'Send WhatsApp code',exact:true}).waitFor();
      assert.equal(await page.locator('#purpose').inputValue(),'enroll');
      assert.equal(await page.locator('#mobile').isVisible(),false);
      assert.equal(counts.create,0);
      assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM workspace_whatsapp_dispatch')).rows[0].n),0);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:`${out}/${staffMode?'staff':'pilot'}-${label}-whatsapp-my-passkeys-enrollment.png`,fullPage:true});
      if(fs.existsSync('storybook-static/iframe.html')) {
        await page.goto(origin+'/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--own-account-passkey-setup&viewMode=story');
        await page.getByRole('heading',{name:'Save a passkey',exact:true}).waitFor();
        assert.equal(await page.locator('#purpose').inputValue(),'enroll');
        assert.equal(await page.locator('#mobile').isVisible(),false);
        await page.waitForFunction(()=>window.axe && !window.axe._running);
        assert.deepEqual((await new AxeBuilder({page}).include('main').analyze()).violations,[]);
        await page.screenshot({path:`${out}/${staffMode?'staff':'pilot'}-${label}-own-passkey-storybook.png`,fullPage:true});
      }
      await context.close();
    }
    assert.equal(sends,0);
    console.log((staffMode?'All-staff mode (two canonical accounts): ':'Pilot mode: ')+'Saved-passkey welcome and WhatsApp-session My passkeys enrollment navigation passed on phone/desktop, without automatic codes or ceremonies. Synthetic only.');
  } finally {
    await browser.close();await release.stop();await new Promise(r=>server.close(r));for(const fn of cleanups)await fn();
  }
}
// Keep asynchronous PGlite/browser work alive, and fail explicitly if it stalls.
const deadline=setTimeout(()=>{console.error('Workspace authentication browser proof timed out');process.exit(1);},120000);
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
