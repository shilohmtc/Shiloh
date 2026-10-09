'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');
const { renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const { injectClientDetailManagement } = require('../src/presentation/workspaceClientsManageUx');
const { renderCalendarPaymentPage, calendarPaymentsClientScript } = require('../src/presentation/calendarPaymentsUx');
const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');
const { phonePresentationClientScript } = require('../src/presentation/southAfricanPhone');

for (const [label, width, height] of [['desktop',1280,900],['mobile',390,844],['narrow',320,720]]) {
  test(`local phone display, prefill and canonical round trip on ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.resolve('public/assets/pwa/shiloh-pwa-192.png'))}));
    await page.goto('/iframe.html?id=workspace-clients--marietjie-client-management&viewMode=story', {waitUntil:'networkidle'});
    await expect(page.locator('#edit-client-mobile')).toHaveValue('0821234001');
    await expect(page.locator('.contact-card strong')).toHaveText('082 123 4001');
    await expect(page.locator('body')).not.toContainText('+27');
    const results = await new AxeBuilder({page}).include('[data-story-surface]').analyze();
    expect(results.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    const dir=path.resolve('artifacts/south-african-phone');fs.mkdirSync(dir,{recursive:true});
    await page.screenshot({path:path.join(dir,`crm-local-${label}.png`),fullPage:true});
    await page.addScriptTag({ content:phonePresentationClientScript() });
    for (const entry of ['0821234567','27821234567','+27 82 123 4567']) {
      await page.locator('#edit-client-mobile').fill(entry);
      const canonical=await page.locator('#edit-client-mobile').evaluate(input=>window.canonicalPhoneInput(input.value));
      expect(canonical).toBe('27821234567');
    }
    const foreign='+44 20 7946 0958';
    const client={id:91,name:'Synthetic Foreign Phone Client',normalized_mobile:foreign,status:'active',revision:'a'.repeat(64)};
    const model={client,manageAllowed:true,appointments:[],policyAcceptances:[],hasMore:false};
    const html=injectClientDetailManagement(renderClientDetailPage(model),model);
    await page.route('https://synthetic.shiloh.test/**',route=> {
      if(route.request().url().includes('/calendar/pwa/icon-192.png')) return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.resolve('public/assets/pwa/shiloh-pwa-192.png'))});
      if(route.request().url().endsWith('/client')) return route.fulfill({contentType:'text/html',body:html});
      return route.fulfill({contentType:'application/javascript',body:''});
    });
    await page.goto('https://synthetic.shiloh.test/client');
    await expect(page.locator('#edit-client-mobile')).toHaveValue(foreign);
    await expect(page.locator('.contact-card strong')).toHaveText(foreign);
    expect(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:path.join(dir,`crm-foreign-${label}.png`),fullPage:true});
  });
}

test('payment phone prefill and submitted provider payload preserve international identity', async ({ page }) => {
  const model=paymentFixture({paid:false}); model.subject.clientMobile='27821234567';
  const html=renderCalendarPaymentPage({model,clientScriptPath:'/phone-payment.js'});
  await page.route('https://synthetic.shiloh.test/**',route=> {
    if(route.request().url().endsWith('/phone-payment.js')) return route.fulfill({contentType:'application/javascript',body:calendarPaymentsClientScript()});
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('https://synthetic.shiloh.test/payment');
  const form=page.locator('[data-manual-form]');
  await page.locator('details.manual-payment > summary').click();
  await expect(form.locator('[name=payerMobile]')).toHaveValue('0821234567');
  await form.getByLabel('Amount (R)', {exact:true}).fill('25.50');
  await form.getByRole('checkbox').check();
  const payloads=[];
  await page.route('**/manual',route=>{payloads.push(route.request().postDataJSON());return route.fulfill({status:400,json:{error:'Synthetic stop before payment'}});});
  for(const entry of ['082 123 4567','27821234567','+27 82 123 4567','+44 20 7946 0958']) {
    await form.locator('[name=payerMobile]').fill(entry);
    await form.getByRole('button',{name:'Record payment',exact:true}).click();
    await expect(page.locator('[data-payment-status]')).toContainText('Synthetic stop before payment');
    expect(payloads.at(-1).payerMobile).toBe(entry.startsWith('+44')?entry:'27821234567');
  }
});
