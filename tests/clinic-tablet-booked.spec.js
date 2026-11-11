'use strict';
const {test,expect}=require('@playwright/test');
const {default:AxeBuilder}=require('@axe-core/playwright');
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const {tabletBookedFixture}=require('./support/tabletBookedFixture');
const {createClinicTabletBookedRouter}=require('../src/routes/clinicTabletBooked');
const {BASE}=require('../src/presentation/clinicTabletBookedUx');
const {IDLE_MS}=require('../src/services/clinicTabletBookedJourney');
let h,server,origin;
test.beforeEach(async({context})=>{
 h=await tabletBookedFixture();const app=express();
 app.use('/assets/brand',express.static(path.join(__dirname,'../public/assets/brand')));
 app.use(BASE,createClinicTabletBookedRouter({enabled:true,service:h.service,env:{NODE_ENV:'test'}}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;
 await context.addCookies([{name:'shiloh_checkin_device',value:h.deviceToken,url:origin}]);
 fs.mkdirSync('artifacts/tablet-booked-review',{recursive:true});
});
test.afterEach(async({page})=>{await page.close();server.closeAllConnections();await new Promise(r=>server.close(r));await h.close();});
async function shot(page,name){await page.evaluate(()=>scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);await page.screenshot({path:`artifacts/tablet-booked-review/${name}.png`,fullPage:true});}
async function start(page){await page.goto(origin+BASE+'/');await page.getByLabel('Mobile number',{exact:true}).fill('0820000001');await page.getByRole('button',{name:'Send WhatsApp code'}).click();await expect(page.getByRole('heading',{name:'Check WhatsApp'})).toBeVisible();await h.otp.dispatchOne();}
async function verify(page){await page.getByLabel('WhatsApp code',{exact:true}).fill(h.sent.at(-1).code);await page.getByRole('button',{name:'Verify code',exact:true}).click();}
async function sign(page){await page.locator('[name=consent_acknowledged]').check();await page.locator('[name=signature_name]').fill('Synthetic Client');await page.locator('[name=signature_confirm]').check();await page.getByRole('button',{name:'Sign & submit securely'}).click();}
for(const [name,viewport] of [['tablet',{width:1024,height:1366}],['phone',{width:390,height:844}]])
 test(`booked shared ${name} verifies, selects explicitly, saves both canonical forms and clears`,async({page,context})=>{
  test.setTimeout(60000);await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+BASE+'/');await shot(page,`${name}-welcome`);
  await start(page);await shot(page,`${name}-code`);await verify(page);
  await expect(page.getByRole('heading',{name:'Choose your visit'})).toBeVisible();await expect(page.locator('input[type=radio]:checked')).toHaveCount(0);
  await shot(page,`${name}-visits`);await page.locator('input[name=appointment_id]').check();await page.getByRole('button',{name:'Continue to forms'}).click();
  await expect(page.getByRole('status')).toContainText('Form 1 of 2');await shot(page,`${name}-first-form`);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await sign(page);await expect(page.getByRole('status')).toContainText('Form 2 of 2');await sign(page);
  await expect(page.getByRole('heading',{name:'You’re all set'})).toBeVisible();await shot(page,`${name}-complete`);
  expect((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n).toBe(2);
  expect((await h.db.query('SELECT COUNT(*)::int AS n FROM client_browser_sessions')).rows[0].n).toBe(0);
  expect((await context.cookies()).some(c=>c.name==='shiloh_tablet_visit')).toBe(false);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.goBack();await expect(page.locator('[name=signature_name]')).toHaveCount(0);expect(errors).toEqual([]);
 });
test('shared number, wrong code, cancellation, stale step and inactivity stay private',async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width:1024,height:1366});await start(page);
 await page.getByLabel('WhatsApp code',{exact:true}).fill('xxxxxx');
 // Native numeric pattern prevents malformed input; submit a numeric wrong code.
 const wrong=h.sent[0].code==='000000'?'999999':'000000';await page.getByLabel('WhatsApp code',{exact:true}).fill(wrong);await page.getByRole('button',{name:'Verify code',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('could not verify');await shot(page,'tablet-wrong-code');
 await verify(page);await page.locator('input[name=appointment_id]').check();await page.getByRole('button',{name:'Continue to forms'}).click();
 h.advance(IDLE_MS);await page.reload();await expect(page.getByRole('heading',{name:'Reception can help'})).toBeVisible();await expect(page.locator('[name=signature_name]')).toHaveCount(0);
 await page.goto(origin+BASE+'/');await h.db.query("INSERT INTO client_contacts VALUES(1,1,'mobile','27820000001')");h.advance(61000);
 await start(page);await verify(page);await expect(page.getByRole('heading',{name:'Reception can help'})).toBeVisible();await expect(page.locator('[name=appointment_id]')).toHaveCount(0);await shot(page,'tablet-shared-phone-help');
});
test('duplicate start and lost form response recover backend state without another send or submission',async({page})=>{
 test.setTimeout(60000);await start(page);
 const csrf=await page.locator('[name=tablet_csrf]').first().getAttribute('value');
 await page.request.post(origin+BASE+'/start',{form:{tablet_csrf:csrf,mobile:'0820000002'},headers:{origin}});
 expect((await h.db.query('SELECT COUNT(*)::int AS n FROM client_code_records')).rows[0].n).toBe(1);expect(h.sent.length).toBe(1);
 await verify(page);await page.locator('[name=appointment_id]').check();await page.getByRole('button',{name:'Continue to forms'}).click();
 let lost=true;await page.route('**/check-in/booked/form',async route=>{const response=await route.fetch();if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.locator('[name=consent_acknowledged]').check();await page.locator('[name=signature_name]').fill('Synthetic Client');await page.locator('[name=signature_confirm]').check();
 const originalPost={tablet_csrf:csrf,assignment_id:'7',consent_acknowledged:'yes',signature_name:'Synthetic Client',signature_confirm:'yes'};
 const networkErrorShown=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame()&&frame.url().startsWith('chrome-error:')});
 await page.getByRole('button',{name:'Sign & submit securely'}).click();await networkErrorShown;
 const repeated=await page.request.post(origin+BASE+'/form',{form:originalPost,headers:{origin}});
 expect(repeated.ok()).toBe(true);expect(await repeated.text()).toContain('Form 2 of 2');
 expect((await page.context().cookies()).some(c=>c.name==='shiloh_tablet_visit')).toBe(true);
 await page.goto(origin+BASE+'/current');await expect(page.getByRole('status')).toContainText('Form 2 of 2');
 await shot(page,'tablet-recovered-second-form');
 expect((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n).toBe(1);expect(h.sent.length).toBe(1);
 await page.getByRole('button',{name:'Clear and start again'}).click();await expect(page.getByRole('heading',{name:'Welcome to Shiloh'})).toBeVisible();await expect(page.locator('[name=signature_name]')).toHaveCount(0);
});
test('welcome keeps active typing beyond thirty seconds without a grant heartbeat',async({page})=>{
 await page.clock.install();let touches=0;page.on('request',request=>{if(request.url().endsWith('/touch'))touches++;});
 await page.goto(origin+BASE+'/');const mobile=page.getByLabel('Mobile number',{exact:true});await mobile.fill('082');
 await page.clock.runFor(31000);await mobile.fill('082000');await page.clock.runFor(31000);
 await expect(mobile).toHaveValue('082000');await expect(page.getByRole('heading',{name:'Welcome to Shiloh'})).toBeVisible();expect(touches).toBe(0);
 await shot(page,'tablet-welcome-active-typing');
 await page.clock.runFor(300000);await expect(mobile).toHaveValue('');expect(touches).toBe(0);
});
test('ownership changes after proof and an opened form fail closed at the HTTP boundary',async({page,context})=>{
 test.setTimeout(60000);await page.setViewportSize({width:1024,height:1366});await start(page);await verify(page);
 await h.db.query("INSERT INTO client_contacts VALUES(1,1,'mobile','27820000001')");await page.reload();
 await expect(page.getByRole('heading',{name:'Reception can help'})).toBeVisible();await expect(page.locator('[name=appointment_id]')).toHaveCount(0);
 expect((await context.cookies()).some(c=>c.name==='shiloh_tablet_visit')).toBe(false);
 await h.db.query('DELETE FROM client_contacts');h.advance(61000);await start(page);await verify(page);await page.locator('input[name=appointment_id]').check();await page.getByRole('button',{name:'Continue to forms'}).click();
 await h.db.query("UPDATE crm_v2_clients SET normalized_mobile='27820000001' WHERE id=11");
 const csrf=await page.locator('[name=tablet_csrf]').first().getAttribute('value');
 const denied=await page.request.post(origin+BASE+'/form',{headers:{origin},form:{tablet_csrf:csrf,assignment_id:'7',consent_acknowledged:'yes',signature_name:'Synthetic Client',signature_confirm:'yes'}});
 expect(denied.status()).toBe(409);expect(await denied.text()).not.toContain('name="signature_name"');
 await page.goto(origin+BASE+'/current');await expect(page.getByRole('heading',{name:'Reception can help'})).toBeVisible();await expect(page.locator('[name=signature_name]')).toHaveCount(0);
 expect((await h.db.query('SELECT COUNT(*)::int AS n FROM consultation_form_submissions')).rows[0].n).toBe(0);await shot(page,'tablet-ownership-changed');
});
for(const [name,viewport] of [['tablet',{width:1024,height:1366}],['phone',{width:390,height:844}]])
 test(`booked ${name} Storybook catalogue preserves all six presentation states`,async({page})=>{
  test.setTimeout(60000);await page.setViewportSize(viewport);
  for(const [story,heading] of [['welcome','Welcome to Shiloh'],['whats-app-code','Check WhatsApp'],['choose-visit','Choose your visit'],['required-form','Your visit details'],['reception-help','Reception can help'],['complete','You’re all set']]){
   await page.goto(`/iframe.html?id=clinic-tablet-booked-client--${story}&viewMode=story`);
   await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
   await shot(page,`${name}-storybook-${story}`);
  }
 });
