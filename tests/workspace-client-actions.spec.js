'use strict';
const {test,expect}=require('@playwright/test');
const {clientActionsScript}=require('../src/presentation/workspaceClientActionsUx');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440]) for(const kind of ['vouchers','rewards']) test(`context ${kind} keeps its client and retries unchanged at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:950});
  await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')}));
  await page.goto(`/iframe.html?id=workspace-production-surfaces--client-home-${kind}&viewMode=story`,{waitUntil:'networkidle'});
  await page.locator('.client-action summary').click();
  const form=page.locator('[data-client-action]');
  await form.locator('[name="amount"]').fill('125');
  if(kind==='vouchers'){
    await form.locator('[name="purchaserName"]').fill('Synthetic purchaser');
    await form.locator('[name="fromName"]').fill('Synthetic sender');
    await form.locator('[name="paymentConfirmed"]').check();
  }
  const requests=[];
  await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic'}}));
  await page.route(`**/calendar/clients/9012/actions/${kind}`,route=>{requests.push(route.request().postDataJSON());return route.fulfill({status:requests.length===1?503:200,json:requests.length===1?{error:'Synthetic uncertain result'}:kind==='vouchers'?{voucher:{voucher_code:'SV-SYNTHETIC'}}:{status:'adjusted'}});});
  await page.addScriptTag({content:clientActionsScript()});
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[data-client-action-status]')).toContainText('Retry this unchanged action');
  await expect(form.locator('[name="amount"]')).toBeDisabled();
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[data-client-action-status]')).toContainText(kind==='vouchers'?'Voucher issued':'Reward saved');
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  await expect(form.locator('[type="submit"]')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('[data-client-detail-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`${kind}-${width}.png`),fullPage:true});
});
