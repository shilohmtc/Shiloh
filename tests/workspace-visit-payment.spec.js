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
