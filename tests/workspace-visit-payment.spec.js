'use strict';
const {test,expect}=require('@playwright/test');
const {visitPaymentScript}=require('../src/presentation/workspaceVisitPaymentUx');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440])for(const scenario of ['partial','paid','group','restricted','unavailable'])test(`mandatory completion choice ${scenario} at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
 await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-active-no-show&viewMode=story',{waitUntil:'networkidle'});
 await page.route('**/calendar/payments/appointments/42/completion-state',route=>route.fulfill({status:scenario==='unavailable'?503:200,json:{subject:{pricingRevision:'2030-01-01T00:00:00Z',groupId:scenario==='group'?7:null},payment:{outstanding:scenario==='paid'?'0.00':'125.00'},authority:{canCollect:scenario!=='restricted'}}}));
 await page.addScriptTag({content:visitPaymentScript()});
 await page.evaluate(()=>{window.decisions=[];window.finished=null;window.ShilohVisitPayment(42,async decision=>{window.decisions.push(structuredClone(decision));if(decision.choice==='paid'&&window.decisions.length===1)throw Error('Synthetic uncertain result');return {ok:true,paymentOutcome:{...decision,outstanding:'50.00'}};}).then(result=>window.finished=result);});
 const dialog=page.getByRole('dialog',{name:'Complete visit and payment'});await expect(dialog).toBeVisible();
 expect(await page.evaluate(()=>window.decisions)).toEqual([]);
 await expect(dialog.getByRole('button',{name:'Close payment window'})).toBeVisible();
 if(scenario==='paid'){
  await expect(dialog).toContainText('No balance remains');await expect(dialog.getByRole('button',{name:'Paid',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Complete visit · no balance due'}).click();expect(await page.evaluate(()=>window.decisions)).toEqual([{choice:'settled'}]);
 }else{
  await expect(dialog.getByRole('button',{name:'Payment outstanding',exact:true})).toBeVisible();
  if(scenario==='unavailable')await expect(dialog).toContainText('Payment details are unavailable');else await expect(dialog).toContainText('R125.00 remains');
  if(scenario==='restricted'||scenario==='unavailable')await expect(dialog.getByRole('button',{name:'Paid',exact:true})).toHaveCount(0);
  if(scenario==='group'){
   await dialog.getByRole('button',{name:'Paid',exact:true}).click();await expect(dialog).toContainText('with its payer');await expect(dialog.locator('[name="amount"]')).toHaveCount(0);expect(await page.evaluate(()=>window.decisions)).toEqual([]);
  }
  if(scenario==='partial'){
   await dialog.getByRole('button',{name:'Paid',exact:true}).click();await expect(dialog.locator('[name="amount"]')).toHaveValue('125.00');await dialog.locator('[name="amount"]').fill('75');
   await page.screenshot({path:info.outputPath(`payment-entry-${width}.png`),fullPage:true});
   await dialog.getByRole('button',{name:'Record payment and complete visit'}).click();expect(await page.evaluate(()=>window.decisions)).toEqual([]);
   await expect(dialog).toContainText('Enter the amount and method');await dialog.locator('[name="method"]').selectOption('cash');await dialog.getByRole('checkbox').check();
   await dialog.getByRole('button',{name:'Record payment and complete visit'}).click();await expect(dialog).toContainText('Retry this unchanged choice');await expect(dialog.locator('[name="amount"]')).toBeDisabled();
   await dialog.getByRole('button',{name:'Retry same choice'}).click();await expect(dialog).toContainText('R75.00 payment recorded. R50.00 remains outstanding.');
   const decisions=await page.evaluate(()=>window.decisions);expect(decisions).toHaveLength(2);expect(decisions[0]).toEqual(decisions[1]);expect(decisions[0]).toMatchObject({choice:'paid',amount:'75',method:'cash',confirmed:true,expectedRevision:'2030-01-01T00:00:00Z'});
  }else{await dialog.getByRole('button',{name:'Payment outstanding',exact:true}).click();await expect(dialog).toContainText('No receipt was created');expect(await page.evaluate(()=>window.decisions)).toEqual([{choice:'outstanding'}]);}
 }
 await expect(dialog.getByRole('heading',{name:'Visit completed'})).toBeVisible();
 expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`choice-${scenario}-${width}.png`),fullPage:true});
 await dialog.getByRole('button',{name:'Close payment window'}).click();await expect(dialog).toHaveCount(0);expect((await page.evaluate(()=>window.finished)).completed).toBe(true);
});
for(const width of [390,1440])test(`Close or Escape before payment choice leaves visit unfinished at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:950});await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-active-no-show&viewMode=story');
 await page.route('**/calendar/payments/appointments/42/completion-state',route=>route.fulfill({json:{payment:{outstanding:'650.00'},subject:{pricingRevision:'revision'},authority:{canCollect:true}}}));
 await page.addScriptTag({content:visitPaymentScript()});
 for(const action of ['close','escape']){
  await page.evaluate(()=>{window.decisions=[];window.finished=null;window.ShilohVisitPayment(42,async decision=>{window.decisions.push(decision);}).then(result=>window.finished=result);});
  const dialog=page.getByRole('dialog',{name:'Complete visit and payment'});await dialog.getByRole('button',{name:'Paid',exact:true}).click();
  if(action==='close')await dialog.getByRole('button',{name:'Close payment window'}).click();else await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.decisions)).toEqual([]);expect(await page.evaluate(()=>window.finished)).toEqual({completed:false,uncertain:false});
 }
});
