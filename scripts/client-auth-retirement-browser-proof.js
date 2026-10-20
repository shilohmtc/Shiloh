'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {createMyShilohRouter}=require('../src/routes/myShiloh');
const {createClientCodeRouter}=require('../src/routes/clientCodeAuth');
async function stable(page){
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>{for(let n=document.querySelector('[data-view="home"] [data-passkey-sign-in]');n;n=n.parentElement)if(Number(getComputedStyle(n).opacity)<.99)return false;return true;});
}
async function main(){
  const app=express();let available=true,starts=0;
  const env={MY_SHILOH_CRM_AUTH_RETIRED:'true',SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'};
  const sessions={validateSessionToken:async()=>({ok:false}),validateCsrfToken:()=>false};
  app.use('/storybook',express.static('storybook-static'));
  app.use('/my-shiloh/code-auth',createClientCodeRouter({enabled:true,env,sessions,service:{enabled:()=>true,smsEnabled:()=>false,
    admitRequest:async()=>true,begin:async()=>{starts++;return {ok:true,accepted:true,request:'R'.repeat(43)};}}}));
  app.use(express.json());app.use(createMyShilohRouter({env,sessionService:sessions,
    crmAuthService:{enabled:()=>true,attempt(){throw Error('Retired details reached');}},
    passkeyEnrollmentService:{policy:()=>({operational:true})},
    passkeyAuthenticationService:{begin:async()=>({ok:true,browserToken:'B'.repeat(43),options:{challenge:'A'.repeat(43),rpId:'127.0.0.1',allowCredentials:[],userVerification:'required'}})},
    whatsappResolver:async()=>null,catalogueProvider:async()=>[],clientCodeAvailable:()=>available}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const out='artifacts/client-auth-retirement';fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  try{
    for(const [label,width,height] of [['phone',390,844],['desktop',1280,900]]){
      const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage();let native=0;
      await page.exposeFunction('__native',()=>{native++;});
      await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});navigator.credentials.get=async()=>{await window.__native();throw new DOMException('Cancelled','NotAllowedError');};navigator.credentials.create=async()=>{await window.__native();throw Error('No automatic setup');};});
      available=true;const prior=starts;await page.goto(origin+'/my-shiloh/');const home=page.locator('[data-view="home"]');
      await home.getByRole('link',{name:'Sign in with WhatsApp',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-view="home"] [data-passkey-sign-in]').disabled);assert.equal(await page.locator('[data-client-crm-form]').count(),0);
      assert.equal(native,0);assert.equal(starts,prior);await stable(page);assert.deepEqual((await new AxeBuilder({page}).include('[data-app-frame]').analyze()).violations,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${out}/${label}-entry.png`,fullPage:true});
      await home.getByRole('button',{name:'Sign in with a passkey',exact:true}).click();
      await page.locator('[data-auth-status]').filter({hasText:/cancel|WhatsApp/i}).first().waitFor();assert.equal(native,1);assert.equal(starts,prior);
      await home.getByRole('link',{name:'Sign in with WhatsApp',exact:true}).click();await page.getByRole('button',{name:'Send me a WhatsApp code',exact:true}).waitFor();
      assert.equal(starts,prior);assert.equal(await page.locator('#sms').count(),0);
      await page.getByLabel('Mobile number',{exact:true}).fill('0820000001');await page.getByRole('button',{name:'Send me a WhatsApp code',exact:true}).click();
      await page.getByLabel('Verification code',{exact:true}).waitFor();assert.equal(starts,prior+1);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${out}/${label}-explicit-code-request.png`,fullPage:true});
      available=false;await page.goto(origin+'/my-shiloh/');await home.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
      assert.equal(await page.locator('[data-client-code-sign-in]').count(),0);await home.getByText('Use a saved passkey. WhatsApp sign-in is temporarily unavailable.').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-view="home"] [data-passkey-sign-in]').disabled);
      assert.equal(await page.locator('[data-client-crm-form]').count(),0);await stable(page);assert.deepEqual((await new AxeBuilder({page}).include('[data-app-frame]').analyze()).violations,[]);
      await page.screenshot({path:`${out}/${label}-channel-unavailable.png`,fullPage:true});
      for(const story of ['retired-details','code-unavailable','retired-signed-in']){
        await page.goto(origin+'/storybook/iframe.html?id=client-crm-detail-sign-in--'+story+'&viewMode=story');await page.locator('[data-app-frame]').waitFor();await page.waitForFunction(()=>window.axe&&!window.axe._running);
        assert.equal(await page.locator('[data-client-crm-form]').count(),0);await stable(page);assert.deepEqual((await new AxeBuilder({page}).include('[data-app-frame]').analyze()).violations,[]);
        await page.screenshot({path:`${out}/${label}-storybook-${story}.png`,fullPage:true});
      }
      await context.close();
    }
    console.log('Client retirement entry, saved-passkey cancellation, explicit-only code request, provider outage and Storybook passed on phone/desktop with zero axe violations. No provider connected.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
const deadline=setTimeout(()=>{console.error('Client retirement browser proof timed out');process.exit(1);},120000);
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(deadline));
