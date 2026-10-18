'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {harness}=require('../tests/helpers/workspaceWhatsAppHarness');
const {createStaffCalendarAccessPageHandler,createStaffPasskeySigninClientHandler}=require('../src/routes/staffCalendarAccessUx');
const {createStaffDetailAuthRouter}=require('../src/routes/staffDetailAuth');
const {createStaffPasskeyAuthRouter}=require('../src/routes/staffPasskeyAuth');
const {createStaffPasskeyAuthService}=require('../src/services/staffPasskeyAuth');
const {staffSmsSetupPanel}=require('../src/presentation/workspaceAccessV2Ux');
async function main(){
  const cleanups=[],h=await harness({after:fn=>cleanups.push(fn)}),app=express();
  const env={...h.env,SHILOH_STAFF_DETAIL_AUTH_RETIRED:'true',SHILOH_STAFF_DETAIL_AUTH_ENABLED:'false',
    SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'};
  let available=true;app.use(express.json());app.use('/storybook',express.static('storybook-static'));app.use('/assets',express.static('public/assets'));
  app.get('/calendar/pwa/icon-192.png',(_req,res)=>res.sendFile('public/assets/brand/shiloh-mark-192.png',{root:process.cwd()}));
  app.get('/calendar/staff',createStaffCalendarAccessPageHandler({env,whatsappAvailable:()=>available}));
  app.get('/calendar/staff/passkey-signin.js',createStaffPasskeySigninClientHandler({env}));
  app.get('/calendar/staff/client.js',(_req,res)=>res.type('js').send(''));
  app.use('/calendar/staff-auth/details',createStaffDetailAuthRouter({env,auth:{attempt(){throw Error('Retired');}},setup:{},sessions:h.sessions}));
  app.use('/calendar/staff-auth/passkeys',createStaffPasskeyAuthRouter({env,sessionService:h.sessions,
    passkeyService:createStaffPasskeyAuthService({db:h.db,env,now:h.now}),bootstrapService:{}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const origin=`http://127.0.0.1:${server.address().port}`,out='artifacts/staff-detail-retirement';fs.mkdirSync(out,{recursive:true});
  try{
    for(const [name,width,height] of [['phone',390,844],['desktop',1280,900]]){
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();let gets=0,creates=0;
      await page.exposeFunction('__get',()=>{gets++;});await page.exposeFunction('__create',()=>{creates++;});
      await page.addInitScript(()=>{navigator.credentials.get=async()=>{await window.__get();throw new DOMException('Cancelled','NotAllowedError');};navigator.credentials.create=async()=>{await window.__create();throw Error('No automatic enrollment');};});
      available=true;await page.goto(origin+'/calendar/staff');
      await page.getByRole('link',{name:'Sign in with WhatsApp',exact:true}).waitFor();
      assert.equal(await page.locator('[data-staff-detail-form]').count(),0);assert.equal(creates,0);assert.equal(gets,0);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${out}/${name}-entry.png`,fullPage:true});
      await page.getByRole('button',{name:'Use a saved passkey',exact:true}).click();
      await page.getByText('No saved Shiloh passkey was found. Use WhatsApp sign-in to continue.').waitFor();
      assert.equal(gets,1);assert.equal(creates,0);
      available=false;await page.reload();assert.equal(await page.getByRole('link',{name:'Sign in with WhatsApp',exact:true}).count(),0);
      await page.getByRole('button',{name:'Use a saved passkey',exact:true}).waitFor();
      await page.getByText('WhatsApp sign-in is temporarily unavailable. Use a saved passkey, or try again shortly.').waitFor();
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${out}/${name}-provider-unavailable.png`,fullPage:true});
      const closed=await context.request.post(origin+'/calendar/staff-auth/details/sign-in',{data:{firstName:'Synthetic',surname:'Staff',dateOfBirth:'1990-01-01',mobile:'27820000001'}});assert.equal(closed.status(),410);
      await context.addCookies([{name:'shiloh_staff_session',value:h.priorSession.sessionToken,url:origin}]);
      await page.goto(origin+'/calendar/staff-auth/passkeys/manage');await page.getByRole('heading',{name:'My passkeys',exact:true}).waitFor();
      assert.doesNotMatch(await page.locator('main').innerText(),/staff details/i);assert.equal(creates,0);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${out}/${name}-my-passkeys.png`,fullPage:true});
      for(const [story,heading] of [['staff-detail-sign-in--retired-details','Shiloh Workspace'],['staff-optional-passkeys--after-details-retirement','My passkeys'],['workspace-staff-sms-device-setup--retired-details','Access detail']]){
        await page.goto(origin+'/storybook/iframe.html?id='+story+'&viewMode=story');
        await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.waitForFunction(()=>window.axe&&!window.axe._running);
        assert.equal(await page.locator('[data-staff-detail-form]').count(),0);
        assert.deepEqual((await new AxeBuilder({page}).include('main').analyze()).violations,[]);
        await page.screenshot({path:`${out}/${name}-${story}.png`,fullPage:true});
      }
      const panel=staffSmsSetupPanel({id:1,active:true},2,false,true);assert.doesNotMatch(panel,/data-staff-sms|date of birth|details\/manage/);
      await context.close();
    }
    assert.equal((await h.sessions.validateSessionToken(h.priorSession.sessionToken)).ok,true);
    console.log('Retired staff details entry, saved-passkey cancellation/fallback, preserved session, My passkeys and Storybook passed on phone/desktop with zero axe violations and no automatic ceremonies. Synthetic only.');
  }finally{await browser.close();await new Promise(r=>server.close(r));for(const fn of cleanups)await fn();}
}
const deadline=setTimeout(()=>{console.error('Retirement browser proof timed out');process.exit(1);},120000);
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
