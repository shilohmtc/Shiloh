'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {createWorkspaceWhatsAppRouter,BASE}=require('../src/routes/workspaceWhatsAppAuth');
async function main(){
  const app=express(), actions=[];
  const service={enabled:()=>true,admitRequest:async()=>true,
    begin:async input=>{actions.push(['begin',input]);return{ok:true,accepted:true,request:'R'.repeat(43)};},
    verify:async input=>{actions.push(['verify',input]);return input.code==='123456'?{ok:true,grant:'G'.repeat(43)}:{ok:false};},
    requestSetup:async()=>({ok:true,intent:'I'.repeat(43)}),
    inspectSetup:async()=>({ok:true,displayName:'Synthetic Staff',mobileEnding:'0001',purpose:'recover'}),
    approveSetup:async()=>({ok:true}),
  };
  const sessions={validateSessionToken:async()=>({ok:true,sessionId:99}),validateCsrfToken:()=>true};
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:'C'.repeat(43)}));
  app.use(BASE,createWorkspaceWhatsAppRouter({enabled:true,service,sessions}));
  app.use('/storybook',express.static('storybook-static'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const executablePath=['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  const output='artifacts/workspace-whatsapp';fs.mkdirSync(output,{recursive:true});
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const [label,width,height] of [['phone',390,844],['desktop',1280,900]]){
      const context=await browser.newContext({viewport:{width,height}});
      const page=await context.newPage(), errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+BASE+'/');
      await page.getByLabel('Staff mobile number').fill('0820000001');
      await page.getByRole('button',{name:'Send WhatsApp code',exact:true}).click();
      await page.getByLabel('WhatsApp code',{exact:true}).fill('000000');
      await page.getByRole('button',{name:'Verify code',exact:true}).click();
      await page.getByRole('status').filter({hasText:'could not be verified'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations,[]);
      await page.screenshot({path:path.join(output,`${label}-code-error.png`),fullPage:true});
      await page.getByLabel('What would you like to do?').selectOption('recover');
      await page.getByRole('button',{name:'Get setup reference',exact:true}).click();
      await page.locator('#setup-reference').filter({hasText:'Setup reference:'}).waitFor();
      await page.getByRole('button',{name:'Send WhatsApp code',exact:true}).click();
      await page.getByLabel('WhatsApp code',{exact:true}).fill('123456');
      await page.getByRole('button',{name:'Verify code',exact:true}).click();
      await page.getByRole('button',{name:'Save this passkey',exact:true}).waitFor();
      await page.screenshot({path:path.join(output,`${label}-phone-verified.png`),fullPage:true});
      await page.goto(origin+BASE+'/approve');
      await page.getByLabel('Staff setup reference').fill('I'.repeat(43));
      await page.getByRole('button',{name:'Review request',exact:true}).click();
      await page.locator('#subject').filter({hasText:'Synthetic Staff'}).waitFor();
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      await page.screenshot({path:path.join(output,`${label}-approval.png`),fullPage:true});
      await page.getByRole('button',{name:'Approve this setup',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Confirm the staff member'}).waitFor();
      await page.getByRole('checkbox').check();
      await page.getByRole('button',{name:'Approve this setup',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Approved.'}).waitFor();
      if(fs.existsSync('storybook-static/iframe.html')){
        await page.goto(origin+'/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--sign-in&viewMode=story');
        await page.getByRole('heading',{name:'Welcome to Workspace'}).waitFor();
        await page.screenshot({path:path.join(output,`${label}-storybook.png`),fullPage:true});
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    assert.ok(actions.some(([type,input])=>type==='begin'&&input.purpose==='recover'&&input.setupIntent==='I'.repeat(43)));
    fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({passed:true,viewports:['phone','desktop'],axeViolations:0,provider:'synthetic',webauthn:'covered separately by SQL integration'},null,2));
    console.log('Workspace WhatsApp phone/desktop, errors, approval, Storybook and accessibility proof passed.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
