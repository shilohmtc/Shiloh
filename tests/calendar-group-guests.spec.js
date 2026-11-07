const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { once } = require('node:events');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');
const { createCalendarGroupBookingRouter } = require('../src/routes/calendarGroupBooking');

let fixture, server, origin;
test.beforeEach(async ({ context }) => {
  fixture = await createFixture({ nativeUrl: null, guestBooking: true, morningOffer: true });
  await fixture.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(201,'Synthetic Organiser','27810000201','test')");
  await fixture.db.query("INSERT INTO crm_v2_client_relationships(client_id,relationship_type,source) VALUES(201,'clinic','test')");
  fixture.standardBooking.searchClients = async (_adminId, term) => ({ clients:
    (await fixture.db.query('SELECT id,name FROM crm_v2_clients WHERE name ILIKE $1 ORDER BY id LIMIT 10', [`%${term}%`])).rows
      .map(c => ({ id: String(c.id), displayName: c.name, profileStatus: 'minimal' })) });
  const app = express();
  app.use(express.json());
  app.post('/calendar/staff-auth/csrf', (_req, res) => res.json({ csrfToken: 'synthetic-csrf' }));
  app.use('/calendar/book/group', createCalendarGroupBookingRouter({
    env: { NODE_ENV: 'test' }, bookingService: fixture.groupService,
    sessionService: {
      validateSessionToken: async token => token === 'synthetic-staff' ? { ok: true, adminId: 7 } : { ok: false },
      validateCsrfToken: (_session, token) => token === 'synthetic-csrf',
    },
  }));
  app.get('/calendar/read-only', (_req, res) => res.send('<h1>Synthetic calendar</h1>'));
  app.use((error, _req, res, _next) => res.status(error.httpStatus || 503).json({ error: error.message, code: error.code }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  await context.addCookies([{ name: 'shiloh_staff_session', value: 'synthetic-staff', url: origin }]);
});
test.afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture) await fixture.close();
});

async function prepare(page) {
  await page.goto(`${origin}/calendar/book/group`);
  await page.locator('#group-organiser-search').fill('Organiser');
  await page.locator('[data-organiser-results] button').filter({ hasText: 'Synthetic Organiser' }).click();
  for (let i = 0; i < 3; i++) {
    const card = page.locator('[data-guest]').nth(i);
    await card.locator('[data-name]').fill(`Synthetic Guest ${['Alpha', 'Beta', 'Gamma'][i]}`);
    if (i < 2) await card.locator('[data-no-mobile]').check();
    else await card.locator('[data-mobile]').fill('0820000003');
    await card.locator('[data-service]').selectOption('81');
    await card.locator('[data-staff]').selectOption(String(i + 11));
  }
  await page.locator('#group-date').fill('2099-10-24');
  await page.locator('#group-time').fill('08:30');
  await page.getByRole('button', { name: 'Review group booking' }).click();
  await expect(page.locator('[data-group-review]')).toBeVisible();
  await expect(page.locator('[data-review-rows]')).toContainText('Synthetic Organiser');
}

for (const width of [390, 1440]) {
  test(`separate guest profiles and organiser booking updates complete at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await prepare(page);
    await expect(page.locator('[data-guest]').first().locator('[data-mobile]')).toBeDisabled();
    if (width === 390) {
      await page.locator('[data-discount-controls]').scrollIntoViewIfNeeded();
      const positions = await page.evaluate(() => ({
        discountBottom: document.querySelector('[data-discount-controls]').getBoundingClientRect().bottom,
        reviewTop: document.querySelector('[data-review-group]').getBoundingClientRect().top,
      }));
      expect(positions.reviewTop).toBeGreaterThanOrEqual(positions.discountBottom);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`guest-group-review-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Create group booking' }).click();
    await expect(page).toHaveURL(/date=2099-10-24/);
    expect((await fixture.db.query("SELECT COUNT(*)::int n FROM crm_v2_clients WHERE contact_mode='organiser'")).rows[0].n).toBe(2);
    expect(fixture.state.organiserWakes).toEqual([201]);
    expect(fixture.state.sends).toHaveLength(1);
  });
}

test('manual group discount shows the actual allocation for each guest without stacking an offer', async ({ page }, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await prepare(page);
  await page.locator('#group-date').fill('2099-10-26');
  await page.locator('[data-guest]').first().locator('[data-first-visit-choice]').selectOption('first_visit');
  await page.locator('[data-discount-type]').selectOption('amount');
  await page.locator('[data-discount-value]').fill('100');
  await page.getByRole('button',{name:'Review group booking'}).click();
  const rows=page.locator('[data-review-rows] .review-row');
  await expect(rows.filter({has:page.locator('span',{hasText:/^Guest 1$/})})).toContainText(/R\s*556[,.]67/);
  await expect(rows.filter({has:page.locator('span',{hasText:/^Guest 2$/})})).toContainText(/R\s*556[,.]67/);
  await expect(rows.filter({has:page.locator('span',{hasText:/^Guest 3$/})})).toContainText(/R\s*556[,.]66/);
  await expect(page.locator('[data-review-rows]')).toContainText(/Final totalR\s*1[\s,]670/);
  await expect(page.locator('[data-review-rows]')).not.toContainText('Morning Welcome Offer saving');
  await page.screenshot({path:testInfo.outputPath('guest-manual-discount-review.png'),fullPage:true});
  await page.getByRole('button',{name:'Create group booking'}).click();
  await expect(page).toHaveURL(/date=2099-10-26/);
  expect((await fixture.db.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(p=>Number(p.total_price))).toEqual([556.67,556.67,556.66]);
  expect((await fixture.db.query('SELECT COUNT(*)::int n FROM morning_offer_booking_prices')).rows[0].n).toBe(0);
});

test('an interrupted committed response survives refresh and checks the same group instead of creating it again', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.route('**/calendar/book/group/confirm', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Create group booking' }).click();
  await expect(page.getByRole('button', { name: 'Check booking result' })).toBeVisible();
  const newReview = page.getByRole('button', { name: 'Review group booking', includeHidden: true });
  await expect(newReview).toBeDisabled();
  await expect(newReview).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check booking result' })).toBeVisible();
  await expect(page.locator('#group-date')).toBeDisabled();
  await expect(page.locator('[data-guest-grid]')).toBeHidden();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Check booking result' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('guest-group-uncertain-refreshed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Check booking result' }).click();
  await expect(page).toHaveURL(/date=2099-10-24/);
  expect((await fixture.db.query('SELECT COUNT(*)::int n FROM appointment_groups')).rows[0].n).toBe(1);
  expect((await fixture.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n).toBe(3);
  expect(fixture.state.organiserWakes).toEqual([201]);
  expect(fixture.state.sends).toHaveLength(1);
});

test('selecting an existing client with a mobile cannot clear that identity through the no-mobile option', async ({ page }) => {
  await page.goto(`${origin}/calendar/book/group`);
  const card = page.locator('[data-guest]').first();
  await card.locator('[data-client-search-input]').fill('Organiser');
  await card.locator('[data-client-results] button').filter({ hasText: 'Synthetic Organiser' }).click();
  await card.locator('[data-no-mobile]').click();
  await expect(card.locator('[data-no-mobile]')).not.toBeChecked();
  await expect(card.locator('[data-client-id]')).toHaveValue('201');
  await expect(card.locator('[data-mobile]')).toBeEnabled();
  await expect(card.locator('[data-mobile]')).not.toHaveValue('');
  await expect(page.locator('[data-group-status]')).toContainText('client profile first');
});

for (const width of [390, 1440]) {
  test(`first-visit choices show each guest saving before confirmation at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await prepare(page);
    const first = page.locator('[data-guest]').nth(0), second = page.locator('[data-guest]').nth(1);
    await expect(first.locator('[data-first-visit-choice]')).toHaveValue('unknown');
    await expect(page.locator('[data-guest]').nth(2).locator('[data-guest-visit-choice]')).toBeHidden();
    await page.locator('#group-date').fill('2099-10-26');
    await first.getByLabel('Has this guest visited Shiloh before?').selectOption('first_visit');
    await second.getByLabel('Has this guest visited Shiloh before?').selectOption('returning');
    await expect(page.locator('[data-group-review]')).toBeHidden();
    await page.getByRole('button', { name: 'Review group booking' }).click();
    const review = page.locator('[data-review-rows]');
    await expect(review).toContainText(/First visit · Saving R\s*118/);
    await expect(review).toContainText('Visited before · No morning offer applied');
    await expect(review).toContainText(/Final totalR\s*1[\s,]534/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`guest-first-visit-review-${width}.png`), fullPage: true });
    await first.getByLabel('Has this guest visited Shiloh before?').selectOption('unknown');
    await expect(page.locator('[data-group-review]')).toBeHidden();
    await page.getByRole('button', { name: 'Review group booking' }).click();
    await expect(review).toContainText('Not sure · No morning offer applied');
    await expect(review).toContainText(/Final totalR\s*1[\s,]652/);
    await page.getByRole('button', { name: 'Create group booking' }).click();
    await expect(page).toHaveURL(/date=2099-10-26/);
    expect((await fixture.db.query('SELECT discount_amount FROM morning_offer_booking_prices')).rows.map(p => Number(p.discount_amount))).toEqual([118]);
  });
}
