'use strict';
const { test,expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const { renderLucideIcon } = require('../src/presentation/lucideIcons');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const { renderMyShilohCouplesBookingPage } = require('../src/presentation/myShilohCouplesBooking');
for (const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1365,height:950 }]) {
  test(`Book for two keeps each person separate and recovers safely on ${viewport.name}`, async ({ page },testInfo) => {
    await page.setViewportSize({ width:viewport.width,height:viewport.height });
    let availabilityCalls=0,reviewCalls=0;
    const confirms=[];
    const slot={ startsAt:'2026-11-02T08:00:00.000Z',time:'10:00',endTime:'11:00',guestEndTime:'11:15' };
    await page.route('**/my-shiloh/api/booking/practitioners?*',route => route.fulfill({ json:{ practitioners:[{ id:11,name:'Synthetic Client AN' },{ id:12,name:'Abigail' }] } }));
    await page.route('**/my-shiloh/api/booking/couples/**',async route => {
      const action=route.request().url().split('/').pop(); const body=route.request().postDataJSON();
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('storybook-csrf');
      expect(body.crmV2ClientId).toBeUndefined();
      if(action==='availability') { availabilityCalls++; expect(body.staffIds).toEqual([11,12]); return route.fulfill({ json:{ slots:availabilityCalls===1 ? [] : [slot] } }); }
      if(action==='review') { reviewCalls++; expect(body.guest).toEqual({ name:'Synthetic Client BG',mobile:'0822345678',consent:true });
        expect(body.treatments.map(item=>item.serviceId)).toEqual([101,102]); expect(body.treatments.map(item=>item.startsAt)).toEqual([slot.startsAt,slot.startsAt]);
        return reviewCalls===1 ? route.fulfill({ status:409,json:{ code:'BOOKING_SLOT_UNAVAILABLE',error:'This time changed. Check again or choose another time.' } }) : route.fulfill({ json:{ total:'1570.00',deposit:'785.00',quoteHash:'a'.repeat(64) } }); }
      if(action==='confirm') { confirms.push(body); if(confirms.length===1) return route.abort('failed'); expect(body).toEqual(confirms[0]); return route.fulfill({ status:201,json:{ message:'Both times are held. One combined deposit is due after both appointments are approved.' } }); }
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--book-for-two&viewMode=story',{ waitUntil:'networkidle' });
    const root=page.locator('[data-my-shiloh-couples]'); await expect(root).toBeVisible();
    await page.addScriptTag({ path:path.join(__dirname,'../public/my-shiloh/assets/couples-booking.js') });
    async function evidence(step) {
      // Native controls can scroll the page while being filled; align the active step for visual review.
      await root.locator('[data-couples-step]:not([hidden])').evaluate(node=>node.scrollIntoView({ block:'start',behavior:'instant' }));
      const axe=await new AxeBuilder({ page }).include('[data-my-shiloh-couples]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      expect(await root.locator('[data-couples-step]:not([hidden]) > .step-head > h2, [data-couples-step]:not([hidden]) > .success-card > h2').evaluate(heading=>heading.getBoundingClientRect().top >= document.querySelector('.top').getBoundingClientRect().bottom)).toBe(true);
      await page.screenshot({ path:testInfo.outputPath(`couples-${viewport.name}-${step}.png`),fullPage:true,animations:'disabled' });
    }
    await evidence('guest');
    await page.getByLabel('Guest’s first name and surname').fill('Synthetic Client BG'); await page.getByLabel('Guest’s mobile number').fill('0822345678');
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
    await expect(root.locator('[data-couples-review-items]')).toContainText('Synthetic Client BG'); await expect(root.locator('[data-couples-review-items]')).toContainText('Hot Stone Massage'); await evidence('review');
    await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('occasion');
    await root.locator('[name="couples-occasion"][value="no"]').check(); await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('accept');
    await root.locator('[data-couples-policy]').check(); await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-confirm-status]')).toContainText('retry this same request safely');
    await root.locator('[data-couples-submit]').click(); await expect(root.locator('[data-couples-success]')).toContainText('One combined deposit'); await evidence('success');
    expect(confirms).toHaveLength(2);
  });
}

for (const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1365,height:950 }]) {
  test(`Couples booking has a shared Workspace icon and separate entry on ${viewport.name}`, async ({ page },testInfo) => {
    await page.setViewportSize({ width:viewport.width,height:viewport.height });
    let paymentDue = false;
    await page.route('**/my-shiloh/api/experience',route => {
      const experience = buildClientExperience({ generatedAt:'2026-10-06T06:00:00.000Z',client:{ id:55,name:'Synthetic Client AO' },nextAppointment:null,forms:[],payment:null });
      if (paymentDue) experience.home.primaryAction = { kind:'payment',label:'Pay deposit',href:'/pay/test_deposit' };
      return route.fulfill({ json:experience });
    });
    await page.route('**/my-shiloh/api/profile',route => route.fulfill({ json:{ profile:{ revision:'a'.repeat(64),name:'Synthetic Client AA',dateOfBirth:'2000-01-01',gender:'male',registrationComplete:true } } }));
    await page.route('**/my-shiloh/api/notifications',route => route.fulfill({ json:{ notifications:[] } }));
    await page.route('**/my-shiloh/api/welcome-voucher',route => route.fulfill({ json:{ eligibility:{ complete:true,steps:[] },voucher:{ state:'redeemed' },eligibleBookings:[],terms:[] } }));
    await page.route('**/my-shiloh/book?for=two',route => route.fulfill({ contentType:'text/html',body:renderMyShilohCouplesBookingPage({ clientFirstName:'Synthetic Client AI',csrfToken:'storybook-csrf' }) }));
    async function openHome() {
      await page.goto('/iframe.html?id=client-my-shiloh-pwa--couples-booking-choices&viewMode=story#home',{ waitUntil:'networkidle' });
      await page.evaluate(() => { localStorage.setItem('my-shiloh-install-whatsapp-verified-v1','1'); Object.defineProperty(navigator,'standalone',{ value:true,configurable:true }); });
      await page.addScriptTag({ path:path.join(__dirname,'../public/my-shiloh/assets/app.js') });
    }
    async function evidence(view) {
      const axe = await new AxeBuilder({ page }).include(`[data-view="${view}"]`).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({ path:testInfo.outputPath(`couples-entry-${view}-${viewport.name}.png`),fullPage:true,animations:'disabled' });
    }
    await openHome();
    const home = page.locator('[data-client-experience-home]');
    await expect(home.locator('[data-client-home-couples]')).toBeVisible();
    await expect(home.locator('[data-client-experience-primary]')).toHaveText('Book an appointment');
    await evidence('home');
    await page.getByRole('link',{ name:'Bookings',exact:true }).click();
    const bookings = page.locator('[data-view="bookings"]');
    const couples = bookings.getByRole('link',{ name:'Couples booking',exact:true });
    await expect(couples).toHaveAttribute('href','/my-shiloh/book?for=two');
    await expect(bookings.getByRole('link',{ name:'Book another appointment' })).toBeVisible();
    const expectedGlyph = await page.evaluate(html=>{ const node=document.createElement('div');node.innerHTML=html;return node.querySelector('svg').innerHTML; },renderLucideIcon('couples',{ size:22 }));
    expect(await couples.locator('svg').evaluate(node=>node.innerHTML)).toBe(expectedGlyph);
    await expect(couples.locator('svg')).toHaveAttribute('aria-hidden','true');
    const regular = await bookings.getByRole('link',{ name:'Book another appointment' }).boundingBox();
    const pair = await couples.boundingBox();
    expect(pair.height).toBeGreaterThanOrEqual(44);
    expect(viewport.name==='desktop' ? pair.x>=regular.x+regular.width : pair.y>=regular.y+regular.height).toBe(true);
    await evidence('bookings');
    await couples.click();
    await expect(page.locator('[data-couples-guest-form]')).toBeVisible();
    paymentDue = true;
    await openHome();
    await expect(home.locator('[data-client-experience-primary]')).toHaveText('Pay deposit');
    await expect(home.locator('[data-client-home-couples]')).toBeHidden();
    await page.getByRole('link',{ name:'Bookings',exact:true }).click();
    await expect(bookings.getByRole('link',{ name:'Couples booking',exact:true })).toBeVisible();
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--sms-and-passkey-guest&viewMode=story',{ waitUntil:'networkidle' });
    await expect(page.locator('[data-couples-booking-entry]')).toHaveCount(0);
  });
}
