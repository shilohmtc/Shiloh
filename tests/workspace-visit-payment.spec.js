'use strict';
const {test,expect}=require('@playwright/test');
const {visitPaymentScript}=require('../src/presentation/workspaceVisitPaymentUx');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440]) for(const scenario of ['partial','paid','group','restricted','unavailable']) test(`completed visit payment ${scenario} at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:950});
  await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
  await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-active-no-show&viewMode=story',{waitUntil:'networkidle'});
  await page.route('**/calendar/payments/appointments/42/state',route=>route.fulfill({status:scenario==='unavailable'?503:200,json:{subject:{pricingRevision:'2030-01-01T00:00:00Z',groupId:scenario==='group'?7:null},payment:{outstanding:scenario==='paid'?'0.00':'125.00',paid:'375.00'},authority:{canCollect:scenario!=='restricted'}}}));
  await page.addScriptTag({content:visitPaymentScript()});await page.evaluate(()=>window.ShilohVisitPayment(42));
  const dialog=page.getByRole('dialog',{name:'Completed visit payment'});
  await expect(dialog).toBeVisible();
  if(scenario==='paid'){await expect(dialog).toContainText('No balance remains');await expect(dialog.getByText('Paid now',{exact:true})).toHaveCount(0);}
  else if(scenario==='unavailable')await expect(dialog).toContainText('no payment was recorded');
  else {
    await expect(dialog).toContainText('R125.00 remains');
    await expect(dialog.getByRole('button',{name:'Payment outstanding',exact:true})).toBeVisible();
    if(scenario==='restricted')await expect(dialog.getByRole('button',{name:'Paid now',exact:true})).toHaveCount(0);
    if(scenario==='group')await expect(dialog).toContainText('Choose the payer');
    if(scenario==='partial'){
      await dialog.getByRole('button',{name:'Paid now',exact:true}).click();
      await expect(dialog.getByRole('button',{name:'Paid now',exact:true})).toBeHidden();
      await expect(dialog.locator('[name="amount"]')).toHaveValue('125.00');
      await dialog.locator('[name="amount"]').fill('75');
      await dialog.getByRole('checkbox').check();
      const writes=[];
      await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic'}}));
      await page.route('**/calendar/payments/appointments/42/manual',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:503,json:{error:'Synthetic uncertain result'}});});
      await dialog.getByRole('button',{name:'Record payment'}).click();await expect(dialog).toContainText('Retry this unchanged receipt');
      await dialog.getByRole('button',{name:'Record payment'}).click();await expect.poll(()=>writes.length).toBe(2);
      expect(writes[0]).toEqual(writes[1]);expect(writes[0].amount).toBe('75');expect(writes[0].expectedRevision).toBe('2030-01-01T00:00:00Z');
    }
  }
  expect((await new AxeBuilder({page}).include('[role="dialog"],dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`payment-${scenario}-${width}.png`),fullPage:true});
});

for(const width of [390,1440])test(`payment requires explicit confirmation, shows saved receipt and always offers Close at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
 await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-active-no-show&viewMode=story',{waitUntil:'networkidle'});
 await page.route('**/calendar/payments/appointments/42/state',route=>route.fulfill({json:{subject:{pricingRevision:'2030-01-01T00:00:00Z'},payment:{outstanding:'650.00'},authority:{canCollect:true}}}));
 const writes=[];
 await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic'}}));
 await page.route('**/calendar/payments/appointments/42/manual',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{status:'recorded'}});});
 await page.addScriptTag({content:visitPaymentScript()});await page.evaluate(()=>window.ShilohVisitPayment(42));
 let dialog=page.getByRole('dialog',{name:'Completed visit payment'});
 await dialog.getByRole('button',{name:'Paid now',exact:true}).click();
 await dialog.getByRole('button',{name:'Record payment',exact:true}).click();
 await expect(dialog).toContainText('Tick the confirmation box');expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Close payment window'}).click();
 await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(0);
 await page.waitForLoadState('networkidle');
 await page.addScriptTag({content:visitPaymentScript()});await page.evaluate(()=>window.ShilohVisitPayment(42));
 dialog=page.getByRole('dialog',{name:'Completed visit payment'});
 await dialog.getByRole('button',{name:'Paid now',exact:true}).click();await dialog.getByRole('checkbox').check();
 await dialog.getByRole('button',{name:'Record payment',exact:true}).click();
 await expect(dialog).toContainText('R650.00 payment recorded.');expect(writes).toHaveLength(1);expect(writes[0].amount).toBe('650.00');
 await expect(dialog.getByRole('button',{name:'Record payment',exact:true})).toHaveCount(0);
 expect((await new AxeBuilder({page}).include('dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath('saved-receipt-'+width+'.png'),fullPage:true});
 await dialog.getByRole('button',{name:'Close payment window'}).click();await expect(dialog).toHaveCount(0);expect(writes).toHaveLength(1);
});
