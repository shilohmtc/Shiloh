'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express');
const {chromium}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {renderDashboardPage}=require('../src/presentation/workspaceDashboardUx');
const {desktopDashboardModel,desktopNavigation}=require('../stories/fixtures/workspaceDesktopLayout');
const {workspacePwaClientScript}=require('../src/presentation/workspacePwa');
const {appRelease}=require('../src/presentation/appRelease');
async function main(){
  const app=express();app.use(express.json());let accountId=1,missingKey=true,subscribed=false,subscriptions=0,proofs=0;
  app.get('/calendar/pwa/icon-192.png',(_req,res)=>res.sendFile(require('node:path').resolve('public/assets/pwa/shiloh-pwa-192.png')));
  app.get('/calendar/workspace',(_req,res)=>res.type('html').send(renderDashboardPage(desktopDashboardModel(),{navigation:desktopNavigation}).replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,'').replace('</body>','<script src="/pwa-proof.js"></script></body>')));
  app.get('/pwa-proof.js',(_req,res)=>res.type('application/javascript').send(workspacePwaClientScript()));
  app.get('/calendar/staff-auth/session',(_req,res)=>res.json({viewer:{calendarScope:'business_all_staff'}}));
  app.get('/calendar/pwa/version',(_req,res)=>res.json({version:appRelease()}));
  app.get('/calendar/pwa/push/config',(_req,res)=>res.json({configured:true,allowed:true,publicKey:'c3ludGhldGlj'}));
  app.post('/calendar/pwa/push/status',(_req,res)=>res.json({enabled:subscribed}));
  app.post('/calendar/pwa/push/subscribe',(req,res)=>{assert.equal(req.headers['x-shiloh-csrf-token'],'synthetic');subscriptions++;subscribed=true;res.json({enabled:true});});
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:'synthetic'}));
  app.post('/calendar/staff-auth/whatsapp/invitations/visit',(req,res)=>{assert.equal(req.headers['x-shiloh-csrf-token'],'synthetic');res.json({ok:true,accountId,passkey:missingKey,show:false});});
  app.post('/calendar/staff-auth/whatsapp/enrollment/own',(req,res)=>{assert.equal(req.body.proof,'session');assert.equal(req.headers['x-shiloh-csrf-token'],'synthetic');proofs++;res.json({ok:true,grant:'G'.repeat(43)});});
  app.post('/calendar/staff-auth/whatsapp/passkey/start',(_req,res)=>res.json({ok:true,options:{challenge:'A'.repeat(43),user:{id:'B'.repeat(43)},excludeCredentials:[]}}));
  app.use('/storybook',express.static('storybook-static'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`,out='artifacts/workspace-account-setup';fs.mkdirSync(out,{recursive:true});
  const executablePath=['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  async function check(page,file){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(page.viewportSize().width<=700&&new URL(page.url()).pathname==='/calendar/workspace'){const card=await page.locator('[data-workspace-setup]').boundingBox(),menu=await page.locator('[data-workspace-drawer-toggle]').boundingBox();assert.ok(card.y>=menu.y+menu.height,'Setup card clears the fixed mobile navigation');}assert.deepEqual((await new AxeBuilder({page}).include('.workspace-setup-card').analyze()).violations,[]);await page.screenshot({path:out+'/'+file+'.png',fullPage:true});}
  try{for(const [label,width,height] of [['phone',390,844],['desktop',1280,900]]){
    accountId=1;missingKey=true;subscribed=false;
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'standalone',{value:true,configurable:true});window.setupProof={permissions:0,credentials:0};let permission='default',subscription=null;
      Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return permission;},requestPermission:async()=>{window.setupProof.permissions++;return permission='granted';}}});
      Object.defineProperty(window,'PushManager',{value:function(){},configurable:true});
      const saved={endpoint:'https://push.example.test/synthetic',toJSON:()=>({endpoint:'https://push.example.test/synthetic',keys:{p256dh:'synthetic',auth:'synthetic'}})};
      const registration={waiting:null,update:async()=>{},addEventListener(){},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription=saved}};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:null,ready:Promise.resolve(registration),register:async()=>registration,addEventListener(){}}});
      navigator.credentials.create=async()=>{window.setupProof.credentials++;throw new DOMException('Synthetic cancellation','NotAllowedError');};
    });
    await page.goto(origin+'/calendar/workspace');await page.locator('[data-workspace-setup][data-step="notifications"]').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.setupProof),{permissions:0,credentials:0});await check(page,label+'-notifications');
    await page.getByRole('button',{name:'Not now',exact:true}).click();await page.locator('[data-workspace-setup][data-step="passkey"]').waitFor();await check(page,label+'-passkey');
    await page.getByRole('button',{name:'Save a passkey',exact:true}).click();await page.locator('[data-workspace-setup-status]').filter({hasText:'No passkey was saved.'}).waitFor();assert.equal((await page.evaluate(()=>window.setupProof)).credentials,1);assert.equal(proofs>0,true);
    await page.getByRole('button',{name:'Not now',exact:true}).click();await page.reload();await page.waitForFunction(()=>document.querySelector('[data-workspace-setup]')?.hidden===true);
    assert.deepEqual(await page.evaluate(()=>Object.entries(localStorage).sort()),[['shiloh-workspace-notifications-later-v1:1','yes'],['shiloh-workspace-passkey-later-v1:1','yes']]);
    accountId=2;missingKey=false;subscribed=false;await page.goto(origin+'/calendar/workspace');await page.locator('[data-workspace-setup][data-step="notifications"]').waitFor();
    const before=subscriptions;await page.getByRole('button',{name:'Turn on notifications',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-workspace-setup]')?.hidden===true);
    assert.equal(subscriptions,before+1);assert.deepEqual(await page.evaluate(()=>window.setupProof),{permissions:1,credentials:0});assert.deepEqual(errors,[]);
    for(const story of ['workspace-notification-card','workspace-passkey-card']){await page.goto(origin+'/storybook/iframe.html?id=workspace-whatsapp-authentication-draft--'+story+'&viewMode=story');await page.locator('[data-workspace-setup]').waitFor();await page.waitForFunction(()=>window.axe&&!window.axe._running);await check(page,label+'-storybook-'+story);}
    await context.close();
  }console.log('Workspace notifications/passkey card: phone/desktop, account isolation, remembered choices, explicit-only native actions, cancellation, Storybook and zero axe violations passed. Synthetic only.');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
