'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs');
async function capture(page,info,name){await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>scrollY===0);await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:true});fs.writeFileSync(info.outputPath(`${name}.html`),await page.content());}
async function surface(page,kind='ordinary'){
 await page.goto(`/iframe.html?id=client-payment-choice--${kind}&viewMode=story`,{waitUntil:'networkidle'});
 await page.addScriptTag({url:'/my-shiloh/assets/payment-choice.js'});
}
for(const width of [390,500,1180,1440])test(`client payment choice review, busy, retry and scope at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:920});let calls=0,release;const gate=new Promise(r=>{release=r;});let submitted;
 await page.route('**/my-shiloh/api/payments/collect',async route=>{calls++;submitted=route.request().postDataJSON();await gate;await route.fulfill({json:{status:'ready',amount:'1000.00',message:'Your reviewed payment is ready. Continue through the secure payment page.',paymentPath:'/pay/cpc_SYNTHETIC_REVIEW'}});});
 await surface(page);await expect(page.getByRole('button',{name:'Prepare secure payment'})).toBeDisabled();
 await expect(page.getByRole('main')).toContainText('Synthetic relaxation treatment');await expect(page.getByRole('main')).toContainText('2 Nov 2026');
 await capture(page,info,`choices-${width}`);
 await page.getByRole('radio',{name:'Pay remaining amount in full'}).check();await page.getByRole('checkbox').check();
 const submit=page.getByRole('button',{name:'Prepare secure payment'});await submit.click();await expect(submit).toBeDisabled();await expect(page.getByRole('status')).toContainText('Preparing');
 await page.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(calls).toBe(1);
 await capture(page,info,`busy-${width}`);release();await expect(page.getByRole('link',{name:'Continue to secure payment'})).toBeVisible();
 expect(submitted).toMatchObject({appointmentId:201,choice:'full',confirmed:true,review:'synthetic-review'});expect(submitted).not.toHaveProperty('amount');
 await capture(page,info,`ready-${width}`);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.getByRole('radio',{name:'Pay deposit',exact:false}).check();await submit.click();await expect(page.getByRole('status')).toContainText('earlier attempt');expect(calls).toBe(1);
 await surface(page,'shared-review');await expect(page.getByRole('main')).toContainText('Reception must confirm');await expect(page.getByRole('radio')).toHaveCount(0);await capture(page,info,`shared-${width}`);
 await surface(page,'earlier-attempt');await expect(page.getByRole('main')).toContainText('Returning from Ozow does not cancel');await expect(page.getByRole('radio')).toHaveCount(0);
 await capture(page,info,`pending-${width}`);
});
test('payment chooser interruption retries exact operation; native back does not submit; text200 reflows',async({page},info)=>{
 await page.setViewportSize({width:390,height:920});let calls=0,first;
 await page.route('**/my-shiloh/api/payments/collect',async route=>{const body=route.request().postDataJSON();calls++;if(calls===1){first=body;await route.abort('failed');}else{expect(body).toEqual(first);await route.fulfill({json:{status:'needs_review',message:'The payment attempt is unresolved.'}});}});
 await surface(page,'partial');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 await expect(page.getByRole('main')).toContainText('R700.00');await page.getByRole('radio',{name:'Pay remaining amount in full'}).check();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Prepare secure payment'}).click();
 await expect(page.getByRole('status')).toContainText('unresolved');await capture(page,info,'interrupted-390-text200');await page.getByRole('button',{name:'Prepare secure payment'}).click();await expect(page.getByRole('status')).toContainText('needs review');expect(calls).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.goto('/iframe.html?id=client-payment-choice--settled&viewMode=story');await page.goBack();expect(calls).toBe(2);
 await capture(page,info,'returned-390');
});

for(const width of [390,1440])test(`assistant renders exact selected payment card and secure review navigation at ${width}`,async({page},info)=>{
 const {createAssistantPreparation}=require('../src/services/myShilohAssistantPreparation');
 const preparation=createAssistantPreparation({contextService:{loadUpcomingAppointments:async()=>[{id:201,startsAt:'2026-11-02T08:00:00.000Z',services:['Synthetic selected treatment']}]},payments:{getClientPaymentChoices:async()=>({scopeLabel:'This appointment only',choices:[{label:'Pay deposit',amount:'500.00'},{label:'Pay remaining amount in full',amount:'1000.00'}],remaining:'1000.00',depositRemaining:'500.00',message:'Review your choice on the secure page.'})}});
 const prepared=await preparation.preparePayment({appointmentStartsAt:'2026-11-02T08:00:00.000Z'},55,1001);
 await page.setViewportSize({width,height:920});let submitted=0;
 await page.route('**/my-shiloh/api/payments/collect',route=>{submitted++;return route.abort();});
 await page.route('**/my-shiloh/api/shiloh/message',route=>route.fulfill({json:{reply:'Your payment options are ready to review. Nothing has been submitted or charged.',action:prepared.clientAction}}));
 await page.route('**/my-shiloh/api/experience',route=>route.fulfill({json:require('../src/services/myShilohExperienceOrchestrator').buildClientExperience({client:{name:'Synthetic Client'},forms:[],rescheduleHistory:[],pendingRescheduleRequests:[]})}));
 await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-assistant-composer&viewMode=story#shiloh',{waitUntil:'networkidle'});
 // Storybook wraps the extracted body in a div. Restore the skip link's
 // production body-child position before the full-page accessibility check.
 await page.evaluate(()=>{Object.defineProperty(navigator,'standalone',{value:true,configurable:true});const skip=document.querySelector('.skip-link');if(skip)document.body.prepend(skip);});await page.addScriptTag({url:'/my-shiloh/assets/app.js'});
 await page.locator('[data-shiloh-chat-input]').fill('Show payment choices for my selected treatment');await page.locator('[data-shiloh-chat-send]').click();
 const card=page.locator('[data-client-action-card]');await expect(card).toContainText('Synthetic selected treatment');await expect(card).toContainText('R500.00');await expect(card).toContainText('R1000.00');
 await expect(card.getByRole('link',{name:'Review secure payment'})).toHaveAttribute('href','/my-shiloh/payment?appointment=201');expect(submitted).toBe(0);
 await expect(page.locator('[data-assistant-request-current]')).not.toContainText('Checking your requests');
 await capture(page,info,`assistant-payment-${width}`);await card.evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:info.outputPath(`assistant-payment-card-${width}.png`)});fs.writeFileSync(info.outputPath(`assistant-payment-card-${width}.html`),await page.content());expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});

test('mixed-client explicit payer keeps real service fixed continuation without full totals or guest details',async({page},info)=>{
 const {PGlite}=require('@electric-sql/pglite');const {install,mixedPayer,serviceFor,input}=require('./helpers/clientPaymentChoiceFixture');const {renderClientPaymentChoice}=require('../src/presentation/myShilohPaymentChoice');
 const pg=new PGlite();const query=async(sql,args)=>{const r=args?await pg.query(sql,args):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};const db={query,connect:async()=>({query,release(){}})};
 try{await install(db);await mixedPayer(db);const service=serviceFor(db);const own=await service.getClientPaymentChoices(input()),other=await service.getClientPaymentChoices(input({appointmentId:203,crmV2ClientId:102,sessionId:1002}));
 await page.route('**/synthetic-mixed-payment',route=>route.fulfill({contentType:'text/html',body:renderClientPaymentChoice({model:own,appointmentId:201})}));
 await page.route('**/synthetic-other-payment',route=>route.fulfill({contentType:'text/html',body:renderClientPaymentChoice({model:other,appointmentId:203})}));
 for(const width of [390,1180]){await page.setViewportSize({width,height:920});await page.goto('/synthetic-mixed-payment');await expect(page.getByRole('link',{name:'Continue existing payment'})).toHaveAttribute('href','/pay/synthetic_mixed_payer_fixed');await expect(page.getByRole('main')).toContainText('R500.00');await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('main')).not.toContainText('R1500');await expect(page.getByRole('main')).not.toContainText('Synthetic Other');await capture(page,info,`mixed-payer-${width}`);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);}
 await page.goto('/synthetic-other-payment');await expect(page.getByRole('link',{name:'Continue existing payment'})).toHaveCount(0);await expect(page.getByRole('main')).not.toContainText('R500');await capture(page,info,'mixed-other-payer');
 }finally{await pg.close();}
});
