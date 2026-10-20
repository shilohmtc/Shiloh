'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express'),{chromium}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {createClientCodeRouter,BASE}=require('../src/routes/clientCodeAuth');
const {createWorkspaceWhatsAppRouter,BASE:STAFF}=require('../src/routes/workspaceWhatsAppAuth');
async function main(){
  const app=express(),actions=[];
  const client={enabled:()=>true,admitRequest:async()=>true,smsEnabled:()=>true,begin:async input=>{actions.push(input);return {ok:true,request:'R'.repeat(43)};},requestSmsFallback:async()=>({ok:true,accepted:true}),
    verify:async input=>input.code==='222222'?{ok:true,accountAccessRequired:true}:input.code==='123456'?{ok:true,profileRequired:true,grant:'G'.repeat(43)}:{ok:false},completeRegistration:async input=>{actions.push(input);return {ok:false};}};
  const sessions={validateSessionToken:async()=>({ok:true,sessionId:1,adminId:1}),validateCsrfToken:()=>true};
  const invitations={visit:async()=>({ok:true,show:true,passkey:true})};
  const service={enabled:()=>true,admitRequest:async()=>true,fallbackEnabled:()=>false,requestOwnEnrollment:async input=>{actions.push(input);return {ok:true,request:'E'.repeat(43)};}};
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:'C'.repeat(43)}));
  app.use(BASE,createClientCodeRouter({enabled:true,service:client,sessions,invitations}));app.use(STAFF,createWorkspaceWhatsAppRouter({enabled:true,service,sessions,invitations}));
  app.use('/storybook',express.static('storybook-static'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const executablePath=['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const origin=`http://127.0.0.1:${server.address().port}`,output='artifacts/workspace-whatsapp';fs.mkdirSync(output,{recursive:true});
  try{for(const [label,width,height]of[['phone',390,844],['desktop',1280,900]]){
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+BASE+'/');assert.doesNotMatch(await page.locator('main').innerText(),/Reception|Christel|\bJP\b/);assert.equal(await page.locator('#purpose').count(),0);await page.screenshot({path:`${output}/${label}-client-support-copy.png`,fullPage:true});await page.getByLabel('Mobile number',{exact:true}).fill('0820000001');
    await page.getByRole('button',{name:'Continue with WhatsApp',exact:true}).click();await page.getByLabel('Verification code',{exact:true}).fill('000000');
    await page.getByRole('button',{name:'Verify code',exact:true}).click();await page.getByRole('status').filter({hasText:'could not verify'}).waitFor();
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`${output}/${label}-client-error.png`,fullPage:true});
    await page.getByRole('button',{name:'Continue with WhatsApp',exact:true}).click();
    await page.getByLabel('Verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify code',exact:true}).click();
    await page.getByLabel('First name',{exact:true}).fill('Synthetic');await page.getByLabel('Surname',{exact:true}).fill('Client');await page.getByLabel('Date of birth').fill('1990-01-01');await page.getByLabel('Gender',{exact:true}).selectOption('female');
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${output}/${label}-client-registration.png`,fullPage:true});
    await page.getByRole('button',{name:'Complete registration',exact:true}).click();await page.getByRole('status').filter({hasText:'could not verify'}).waitFor();
    await page.goto(origin+BASE+'/');await page.getByLabel('Mobile number',{exact:true}).fill('0820000001');await page.getByRole('button',{name:'Continue with WhatsApp',exact:true}).click();
    await page.getByLabel('Verification code',{exact:true}).fill('222222');await page.getByRole('button',{name:'Verify code',exact:true}).click();
    await page.getByRole('status').filter({hasText:'This code has not opened or changed any profile.'}).waitFor();assert.equal(await page.locator('#profile').isVisible(),false);assert.equal(await page.locator('#account-help').getAttribute('open'),'');
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${output}/${label}-client-account-help.png`,fullPage:true});
    await page.goto(origin+STAFF+'/enroll');await page.getByRole('button',{name:'Send WhatsApp code',exact:true}).click();await page.getByLabel('Verification code',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/${label}-self-enrollment.png`,fullPage:true});
    await page.goto(origin+STAFF+'/welcome');await page.getByRole('status').filter({hasText:'choices are optional'}).waitFor();
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:`${output}/${label}-invitations.png`,fullPage:true});
    if(fs.existsSync('storybook-static/iframe.html'))for(const story of['client-code-sign-in','client-registration','client-account-help','optional-invitations']){
      await page.goto(origin+'/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--'+story+'&viewMode=story');await page.locator('main').waitFor();await page.waitForFunction(()=>window.axe && !window.axe._running);
      assert.deepEqual((await new AxeBuilder({page}).include('main').analyze()).violations,[]);await page.screenshot({path:`${output}/${label}-storybook-${story}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);await context.close();
  }assert.ok(actions.some(x=>x.proof==='code'));assert.ok(actions.some(x=>x.profile?.firstName==='Synthetic'));
    fs.writeFileSync(output+'/client-summary.json',JSON.stringify({passed:true,viewports:['phone','desktop'],axeViolations:0,provider:'synthetic'}));console.log('Client code, self-service enrollment and optional invitations browser proof passed.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
