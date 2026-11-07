const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { once } = require('node:events');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');
const { createCalendarCouplesBookingRouter } = require('../src/routes/calendarCouplesBooking');
const { createCalendarGroupBookingRouter } = require('../src/routes/calendarGroupBooking');

let fixture, server, origin;
test.beforeEach(async ({ context }, testInfo) => {
  fixture = await createFixture({ nativeUrl: null, morningOffer:testInfo.title.includes('Morning Welcome Offer') });
  if (testInfo.title.includes('Young Guest treatment label')) {
    const name = 'Young Guest Back &!Neck Massage (age 8-15)';
    await fixture.db.query('UPDATE services SET name=$1 WHERE id=81', [name]);
    const originalOptions = fixture.standardBooking.listBookableOptions;
    fixture.standardBooking.listBookableOptions = async (...args) => {
      const options = await originalOptions(...args);
      return { ...options, services: options.services.map(service => Number(service.id) === 81 ? { ...service, name } : service) };
    };
  }
  const app = express(); app.use(express.json());
  const sessionService = {
    validateSessionToken: async token => token === 'synthetic-staff' ? { ok: true, adminId: 7 } : { ok: false },
    validateCsrfToken: (_session, token) => token === 'synthetic-csrf',
  };
  app.post('/calendar/staff-auth/csrf', (_req, res) => res.json({ csrfToken: 'synthetic-csrf' }));
  app.use('/calendar/book/couples', createCalendarCouplesBookingRouter({
    env: { NODE_ENV: 'test' }, sessionService, bookingService: fixture.service,
  }));
  app.use('/calendar/book/group', createCalendarGroupBookingRouter({
    env: { NODE_ENV: 'test' }, sessionService, bookingService: fixture.groupService,
  }));
  app.get('/calendar/read-only', (_req, res) => res.send('<h1>Synthetic calendar destination</h1>'));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  await context.addCookies([{ name: 'shiloh_staff_session', value: 'synthetic-staff', url: origin }]);
});
test.afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture) await fixture.close();
});

async function fillBooking(page, discount, date = '2099-10-24') {
  await page.goto(`${origin}/calendar/book/couples`);
  for (let position = 1; position <= 2; position++) {
    await page.locator(`[data-name="${position}"]`).fill(`Synthetic Guest ${position === 1 ? 'Alpha' : 'Beta'}`);
    await page.locator(`[data-mobile="${position}"]`).fill(`082000000${position}`);
    await page.locator(`[data-service="${position}"]`).selectOption('81');
    await page.locator(`[data-staff="${position}"]`).selectOption(String(position + 10));
  }
  await page.locator('#couples-date').fill(date);
  await page.locator('#couples-time').fill('08:30');
  if (discount) {
    await page.locator('[data-discount-type]').selectOption('amount');
    await page.locator('[data-discount-value]').fill('100');
  }
  await page.getByRole('button', { name: 'Review couples booking' }).click();
  await expect(page.locator('[data-couples-review]')).toBeVisible();
}

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  for (const discount of [false, true]) {
    test(`new couples guests complete on ${viewport.name}, ${discount ? 'R100 discount' : 'no discount'}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await fillBooking(page, discount);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
        .filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`couples-review-${viewport.name}-${discount ? 'discount' : 'standard'}.png`), fullPage: true });
      const response = page.waitForResponse(r => r.url().endsWith('/couples/confirm'));
      await page.getByRole('button', { name: 'Create linked booking' }).click();
      expect((await response).status()).toBe(201);
      await expect(page).toHaveURL(/\/calendar\/read-only\?/);
      expect((await fixture.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n).toBe(2);
      expect((await fixture.db.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(2);
      expect(Number((await fixture.db.query('SELECT final_total FROM appointment_groups')).rows[0].final_total)).toBe(discount ? 1080 : 1180);
    });
  }
}

test('phone can review again after a rolled-back confirmation without duplicate guests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fillBooking(page, true);
  fixture.state.failQueue = true;
  await page.getByRole('button', { name: 'Create linked booking' }).click();
  await expect(page.locator('[data-couples-status]')).toContainText('nothing was created');
  expect((await fixture.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n).toBe(0);
  expect(fixture.state.sends).toEqual([]);
  fixture.state.failQueue = false;
  await page.getByRole('button', { name: 'Review couples booking' }).click();
  await expect(page.locator('[data-couples-review]')).toBeVisible();
  await page.getByRole('button', { name: 'Create linked booking' }).click();
  await expect(page).toHaveURL(/\/calendar\/read-only\?/);
  expect((await fixture.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n).toBe(2);
  expect((await fixture.db.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(2);
});

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test(`three new group guests complete on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/calendar/book/group`);
    for (let i = 0; i < 3; i++) {
      const card = page.locator('[data-guest]').nth(i);
      await card.locator('[data-name]').fill(`Synthetic Guest ${['Alpha', 'Beta', 'Gamma'][i]}`);
      await card.locator('[data-mobile]').fill(`082000000${i + 1}`);
      await card.locator('[data-service]').selectOption('81');
      await card.locator('[data-staff]').selectOption(String(i + 11));
    }
    await page.locator('#group-date').fill('2099-10-24');
    await page.locator('#group-time').fill('08:30');
    await page.getByRole('button', { name: 'Review group booking' }).click();
    await expect(page.locator('[data-group-review]')).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
      .filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`group-review-${viewport.name}.png`), fullPage: true });
    const response = page.waitForResponse(r => r.url().endsWith('/group/confirm'));
    await page.getByRole('button', { name: 'Create group booking' }).click();
    expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/calendar\/read-only\?/);
    expect((await fixture.db.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(3);
    expect((await fixture.db.query('SELECT count(*)::int AS n FROM crm_v2_clients')).rows[0].n).toBe(3);
  });
}

for (const width of [390,1440]) {
  test(`Young Guest treatment label stays clean without changing catalogue or review identity at ${width}px`, async ({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.goto(`${origin}/calendar/book/group`);
    for(let i=0;i<3;i++){
      const card=page.locator('[data-guest]').nth(i);
      await expect(card.locator('[data-service] option[value="81"]')).toHaveText('Young Guest Back & Neck Massage (age 8-15) · 90 min · R590.00');
      await card.locator('[data-name]').fill(`Synthetic Guest ${['Alpha','Beta','Gamma'][i]}`);
      await card.locator('[data-mobile]').fill(`082000000${i+1}`);
      await card.locator('[data-service]').selectOption('81');
      await card.locator('[data-staff]').selectOption(String(i+11));
    }
    await page.locator('#group-date').fill('2099-10-24');
    await page.locator('#group-time').fill('08:30');
    const response=page.waitForResponse(r=>r.url().endsWith('/group/prepare'));
    await page.getByRole('button',{name:'Review group booking'}).click();
    const prepared=await response;
    expect(prepared.status()).toBe(200);
    const body=await prepared.json();
    await expect(page.locator('[data-group-review]')).toBeVisible();
    await expect(page.locator('[data-review-rows]')).toContainText('Young Guest Back & Neck Massage (age 8-15)');
    await expect(page.locator('[data-review-rows]')).not.toContainText('&!');
    expect(body.review.assignments.map(a=>a.service.name)).toEqual(Array(3).fill('Young Guest Back &!Neck Massage (age 8-15)'));
    expect(body.review.assignments.map(a=>Number(a.service.id))).toEqual([81,81,81]);
    expect(body.review.pricing.total).toBe(1770);
    expect((await fixture.db.query('SELECT name FROM services WHERE id=81')).rows[0].name).toBe('Young Guest Back &!Neck Massage (age 8-15)');
    expect((await fixture.db.query('SELECT count(*)::int n FROM appointments')).rows[0].n).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`young-guest-label-${width}.png`),fullPage:true});
  });
}

for (const width of [390,1440]) {
  test(`Morning Welcome Offer review, opt-out and exact confirmed prices at ${width}px`,async ({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await fillBooking(page,false,'2099-10-26');
    await expect(page.locator('[data-review-rows]')).toContainText('Morning Welcome Offer saving');
    const offer=page.getByRole('checkbox',{name:/Apply Morning Welcome Offer/});
    await expect(offer).toBeChecked();
    await offer.uncheck();
    await expect(page.locator('[data-couples-review]')).toBeVisible();
    await expect(page.locator('[data-review-rows]')).toContainText('1 180');
    await page.getByRole('checkbox',{name:/Apply Morning Welcome Offer/}).check();
    await expect(page.locator('[data-couples-review]')).toBeVisible();
    await expect(page.locator('[data-review-rows]')).toContainText('944');
    expect((await new AxeBuilder({page}).include('[data-couples-review]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.locator('[data-couples-review]').screenshot({path:testInfo.outputPath(`morning-workspace-review-${width}.png`)});
    const request=page.waitForRequest(r=>r.url().endsWith('/couples/confirm'));
    await page.getByRole('button',{name:'Create linked booking'}).click();
    expect((await request).postDataJSON().quoteHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(page).toHaveURL(/\/calendar\/read-only\?/);
    expect((await fixture.db.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(a=>Number(a.total_price))).toEqual([472,472]);
  });
}
