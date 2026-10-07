const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { createClinicIpadPublicRouter } = require('../src/routes/clinicIpadCheckin');

test('clinic iPad check-in screens fit phone, tablet and desktop with accessible form controls', async ({ page }, testInfo) => {
  for (const viewport of [
    { name:'phone', width:390, height:844 },
    { name:'ipad', width:820, height:1180 },
    { name:'desktop', width:1280, height:900 },
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    for (const state of [
      { name:'setup-needed', id:'client-clinic-ipad-check-in--setup-needed' },
      { name:'new-client', id:'client-clinic-ipad-check-in--new-client' },
      { name:'verify-for-form', id:'client-clinic-ipad-check-in--verify-for-form' },
      { name:'missing-dob', id:'client-clinic-ipad-check-in--missing-dob' },
      { name:'incorrect-details', id:'client-clinic-ipad-check-in--incorrect-details' },
      { name:'form-ready', id:'client-clinic-ipad-check-in--form-ready' },
    ]) {
      await page.goto(`/iframe.html?id=${state.id}&viewMode=story`,{ waitUntil:'networkidle' });
      await expect(page.locator('[data-checkin-story]')).toBeVisible();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      expect(overflow).toBe(false);
      const accessibility=await new AxeBuilder({ page }).include('[data-checkin-story]')
        .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({ path:testInfo.outputPath(`clinic-ipad-${state.name}-${viewport.name}.png`),
        fullPage:true,animations:'disabled' });
    }
  }
});

test('Christel and Reception form handoff screen fits phone and desktop',async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=client-clinic-ipad-check-in--staff-form-preparation&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.locator('[data-checkin-story]')).toBeVisible();
    await expect(page.getByRole('button',{name:'Prepare on iPad'})).toBeVisible();
    await expect(page.getByText('Clients can also complete assigned forms in My Shiloh.',{exact:false})).toBeVisible();
    expect(await page.locator('[data-checkin-story]').innerText()).not.toMatch(/WhatsApp/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    const accessibility=await new AxeBuilder({page}).include('[data-checkin-story]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`clinic-ipad-staff-handoff-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
});

test('a completed iPad visit cannot reopen personal details through navigation', async ({ page }) => {
  const app=express();
  let active=true;
  const device='d'.repeat(43),visit='v'.repeat(43);
  app.use('/check-in',createClinicIpadPublicRouter({
    env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},
    service:{deviceFor:async value=>value===device?{id:1}:null,
      cancelDeviceForm:async()=>{},readyForm:async()=>false,
      begin:async()=>({token:visit}),active:async(_device,value)=>value===visit&&active?{id:2}:null,
      finish:async()=>{active=false;},register:async()=>{active=false;return {state:'completed'};}}
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    await page.context().addCookies([{name:'shiloh_checkin_device',value:device,domain:'127.0.0.1',path:'/check-in'}]);
    await page.goto(`${base}/check-in/`);
    await page.getByRole('button',{name:'Enter my details'}).click();
    await page.getByLabel('Full name').fill('Sarah Jacobs');
    await page.getByLabel('Mobile number').fill('0821234567');
    await page.getByLabel('Date of birth').fill('1985-05-14');
    await page.getByRole('button',{name:'Continue'}).click();
    await expect(page.getByRole('heading',{name:'Your details are saved.'})).toBeVisible();
    await page.getByRole('link',{name:'Finish'}).click();
    await expect(page.getByRole('heading',{name:'Let’s get you checked in.'})).toBeVisible();
    await page.goto(`${base}/check-in/details`);
    await expect(page.getByRole('heading',{name:'Let’s get you checked in.'})).toBeVisible();
    expect(await page.locator('input[name="name"]').count()).toBe(0);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
