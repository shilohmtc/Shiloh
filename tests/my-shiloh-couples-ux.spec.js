'use strict';
const { test,expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
for (const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1365,height:950 }]) {
  test(`Book for two keeps each person separate and recovers safely on ${viewport.name}`, async ({ page },testInfo) => {
    await page.setViewportSize(viewport);
    let availabilityCalls=0,reviewCalls=0;
    const confirms=[];
    const slot={ startsAt:'2026-11-02T08:00:00.000Z',time:'10:00',endTime:'11:00',guestEndTime:'11:15' };
    await page.route('**/my-shiloh/api/booking/practitioners?*',route => route.fulfill({ json:{ practitioners:[{ id:11,name:'Christel' },{ id:12,name:'Abigail' }] } }));
    await page.route('**/my-shiloh/api/booking/couples/**',async route => {
      const action=route.request().url().split('/').pop(); const body=route.request().postDataJSON();
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('storybook-csrf');
      expect(body.crmV2ClientId).toBeUndefined();
      if(action==='availability') { availabilityCalls++; expect(body.staffIds).toEqual([11,12]); return route.fulfill({ json:{ slots:availabilityCalls===1 ? [] : [slot] } }); }
      if(action==='review') { reviewCalls++; expect(body.guest).toEqual({ name:'Guest Person',mobile:'0822345678',consent:true });
        expect(body.treatments.map(item=>item.serviceId)).toEqual([101,102]); expect(body.treatments.map(item=>item.startsAt)).toEqual([slot.startsAt,slot.startsAt]);
        return reviewCalls===1 ? route.fulfill({ status:409,json:{ code:'BOOKING_SLOT_UNAVAILABLE',error:'This time changed. Check again or choose another time.' } }) : route.fulfill({ json:{ total:'1570.00',deposit:'785.00',quoteHash:'a'.repeat(64) } }); }
      if(action==='confirm') { confirms.push(body); if(confirms.length===1) return route.abort('failed'); expect(body).toEqual(confirms[0]); return route.fulfill({ status:201,json:{ message:'Both times are held. One combined deposit is due after both appointments are approved.' } }); }
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--book-for-two&viewMode=story',{ waitUntil:'networkidle' });
    const root=page.locator('[data-my-shiloh-couples]'); await expect(root).toBeVisible();
    await page.addScriptTag({ path:path.join(__dirname,'../public/my-shiloh/assets/couples-booking.js') });
    async function evidence(step) {
      const axe=await new AxeBuilder({ page }).include('[data-my-shiloh-couples]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.screenshot({ path:testInfo.outputPath(`couples-${viewport.name}-${step}.png`),fullPage:true,animations:'disabled' });
    }
    await evidence('guest');
    await page.getByLabel('Guest’s first name and surname').fill('Guest Person'); await page.getByLabel('Guest’s mobile number').fill('0822345678');
    await page.getByRole('button',{ name:'Choose our treatments' }).click(); await expect(root.locator('[data-couples-step="1"]')).toBeVisible();
    await root.locator('[name="consent"]').check(); await page.getByRole('button',{ name:'Choose our treatments' }).click();
    for(const index of [0,1]) { await root.locator(`[data-couples-service="${index}"]`).selectOption(index ? '102' : '101'); await expect(root.locator(`[data-couples-staff="${index}"]`)).toBeEnabled(); await root.locator(`[data-couples-staff="${index}"]`).selectOption('11'); }
    await page.getByRole('button',{ name:'Find a shared time' }).click(); await expect(root.locator('[data-couples-selection-status]')).toContainText('two different therapists');
    await root.locator('[data-couples-staff="1"]').selectOption('12'); await evidence('treatments');
    await page.getByRole('button',{ name:'Find a shared time' }).click(); await root.locator('[data-couples-date]').fill('2026-11-02');
    await page.getByRole('button',{ name:'Show shared times' }).click(); await expect(root.locator('[data-couples-slot-status]')).toContainText('No shared times');
    await page.getByRole('button',{ name:'Show shared times' }).click(); await page.getByRole('button',{ name:'10:00 · Both therapists available' }).click();
    await expect(root.locator('[data-couples-total]')).toHaveText('Not available yet'); await expect(root.locator('[data-couples-submit]')).toBeDisabled(); await evidence('review-error');
    await page.getByRole('button',{ name:'Check our appointments again' }).click(); await expect(root.locator('[data-couples-total]')).toHaveText('R1570.00'); await expect(root.locator('[data-couples-deposit]')).toHaveText('R785.00');
    await expect(root.locator('[data-couples-review-items]')).toContainText('Guest Person'); await expect(root.locator('[data-couples-review-items]')).toContainText('Hot Stone Massage'); await evidence('review');
    await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('occasion');
    await root.locator('[name="couples-occasion"][value="no"]').check(); await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('accept');
    await root.locator('[data-couples-policy]').check(); await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('retry this same request safely');
    await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-success]')).toContainText('One combined deposit'); await evidence('success');
    expect(confirms).toHaveLength(2);
  });
}
