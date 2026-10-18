'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {harness}=require('../tests/helpers/workspaceWhatsAppHarness');
const {issueStaffBrowserSession}=require('../src/services/staffBrowserSession');
const ux=require('../src/presentation/staffPasskeyUx');
const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
const {createWorkspaceWhatsAppRelease,ENABLED,MANIFEST,TOKEN,KEY}=require('../src/services/workspaceWhatsAppRelease');
async function main() {
  const cleanups=[],h=await harness({after:fn=>cleanups.push(fn)}),app=express();
  const template={id:'123',wabaId:'456',name:'shiloh_workspace_verification',language:'en',category:'AUTHENTICATION',message_send_ttl_seconds:300,
    components:[{type:'BODY',text:'{{1}} is your verification code.'},{type:'FOOTER',code_expiration_minutes:5},
      {type:'BUTTONS',buttons:[{type:'OTP',otp_type:'COPY_CODE',text:'Copy code'}]}]};
  const env={...h.env,[ENABLED]:'true',[TOKEN]:'synthetic-only',[KEY]:'7a'.repeat(32),[MANIFEST]:JSON.stringify({
    pilot:{subjectId:1,operatorId:2,scopeId:'synthetic_browser_pilot_01',startsAt:new Date(+h.now()-60000).toISOString(),endsAt:new Date(+h.now()+3600000).toISOString(),maxMessages:3,maxSpendMinor:500},
    template,wabaId:'456',phoneNumberId:'789',apiVersion:'v99.0',budgets:{currency:'ZAR',dailySpendMinor:500,whatsappCostMinor:100,smsCostMinor:100,smsAccountDailyLimit:2,smsClinicDailyLimit:2}})};
  let sends=0;
  const release=createWorkspaceWhatsAppRelease({env,db:h.db,sessions:h.sessions,now:h.now,fetchImpl:async(url,options)=>{
    if(options.method!=='GET'){sends++;throw Error('No synthetic send expected');}
    return new Response(JSON.stringify({data:url.includes('/phone_numbers')?[{id:'789'}]:[{...template,status:'APPROVED'}]}));
  }});
  release.mount(app);app.use(express.json());
  app.get('/signin',(_req,res)=>res.type('html').send(`<!doctype html><html lang="en"><head><title>Staff passkey proof</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;max-width:540px;margin:24px auto;padding:16px}button{font:inherit;min-height:48px;padding:12px}</style></head><body><h1>Workspace</h1>${ux.signinPanel()}<script src="/signin.js"></script></body></html>`));
  app.get('/signin.js',(_req,res)=>res.type('application/javascript').send(ux.signinScript()));
  app.get('/calendar/workspace',(_req,res)=>res.type('html').send('<h1>Existing Workspace</h1>'));
  let currentSession;
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:currentSession?.csrfToken}));
  app.use('/calendar/staff-auth/passkeys',createStaffPasskeyAuthRouter({env,sessionService:h.sessions,bootstrapService:{},
    successDestination:release.passkeySuccessDestination,passkeyService:{
      knownPrincipal:async()=>({ok:true,displayName:'Synthetic pilot staff'}),
      beginAuthentication:async()=>({ok:true,options:{challenge:'B'.repeat(43),allowCredentials:[],userVerification:'required',timeout:60000}}),
      finishAuthentication:async()=>{
        const admin=(await h.db.query('SELECT *,active AS admin_active FROM staff_admin_accounts WHERE id=1')).rows[0];
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
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),counts={get:0,create:0};
      await page.exposeFunction('__recordCeremony',kind=>{counts[kind]++;});
      await page.addInitScript(()=>{
        Object.defineProperty(window,'Notification',{value:{permission:'denied'},configurable:true});
        navigator.credentials.get=async()=>{await window.__recordCeremony('get');return {id:'synthetic',rawId:new Uint8Array([1]).buffer,type:'public-key',
          response:{clientDataJSON:new Uint8Array([1]).buffer,authenticatorData:new Uint8Array([1]).buffer,signature:new Uint8Array([1]).buffer,userHandle:null}};};
        navigator.credentials.create=async()=>{await window.__recordCeremony('create');throw Error('No automatic enrollment');};
      });
      await page.goto(origin+'/signin');await page.getByRole('button',{name:'Continue as Synthetic pilot staff'}).waitFor();
      assert.equal(counts.get,0);await page.getByRole('button',{name:'Continue as Synthetic pilot staff'}).click();
      await page.waitForURL('**/calendar/staff-auth/whatsapp/welcome');
      await page.getByText('These choices are optional. You can continue now.').waitFor();
      await page.getByRole('heading',{name:'Make next time easier'}).waitFor();
      assert.equal(counts.get,1);assert.equal(counts.create,0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:`${out}/${label}-saved-passkey-pilot-welcome.png`,fullPage:true});
      await page.getByRole('link',{name:'Not now — continue'}).click();await page.waitForURL('**/calendar/workspace');
      await context.close();
    }
    assert.equal(sends,0);
    console.log('Saved-passkey pilot welcome phone/desktop, explicit ceremony, optional invitations and accessibility proof passed. Synthetic only.');
  } finally {
    await browser.close();await release.stop();await new Promise(r=>server.close(r));for(const fn of cleanups)await fn();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
