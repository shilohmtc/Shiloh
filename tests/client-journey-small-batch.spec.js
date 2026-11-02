'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const choice = { available: true, service: 'Full Body Swedish', startsAt: '2026-10-01T08:00:00Z', message: 'Review this treatment, then choose a new date and time. Current prices and availability apply. Nothing has been booked.', href: '/my-shiloh/book?service=101' };
async function open(page, { guest = false, previous = choice, status = 200 } = {}) {
  let reads = 0;
  const writes = [];
  page.on('request', request => { if (request.method() === 'POST' && /booking\/request|actions\/confirm/.test(request.url())) writes.push(request.url()); });
  await page.route('**/my-shiloh/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/my-shiloh/api/previous-treatment', route => { reads++; return route.fulfill({ status, json: previous }); });
  const visit = { id: 901, status: 'confirmed', startsAt: '2026-11-10T08:00:00Z', services: ['Full Body Swedish'], practitioners: ['Synthetic practitioner'] };
  const experience = buildClientExperience({ client: { id: 55, name: 'Synthetic' }, nextAppointment: visit, upcomingAppointments: [visit], forms: [], payment: { state: 'paid' } });
  await page.route('**/my-shiloh/api/experience', route => route.fulfill({ json: experience }));
  await page.goto(`/iframe.html?id=client-my-shiloh-pwa--${guest ? 'desktop-booking-handoff' : 'previous-treatment'}&viewMode=story${guest ? '#book-online' : '#bookings'}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-app-frame]')).toBeAttached();
  const surface = await page.locator('#storybook-root').innerHTML();
  await page.setContent(surface);
  await page.evaluate(standalone => Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true }), !guest);
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  return { reads: () => reads, writes };
}
for (const width of [390, 1440]) {
  test(`previous treatment and directions are reviewable at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await open(page);
    expect(calls.reads()).toBe(0);
    await page.getByRole('button', { name: 'Book a previous treatment', exact: true }).click();
    await expect(page.locator('[data-previous-treatment-status]')).toContainText('Full Body Swedish');
    await expect(page.locator('[data-previous-treatment-status]')).toContainText('Nothing has been booked');
    await expect(page.locator('[data-previous-treatment-continue]')).toHaveAttribute('href', '/my-shiloh/book?service=101');
    await page.getByText('Appointment details', { exact: true }).first().click();
    const directions = page.getByRole('link', { name: 'Get directions in Google Maps (opens in a new tab)' }).first();
    await expect(directions).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=37%20Jacobs%20Street%2C%20Heidelberg%2C%20Gauteng%2C%20South%20Africa');
    expect(calls.reads()).toBe(1);
    expect(calls.writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const a11y = await new AxeBuilder({ page }).include('#bookings').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(a11y.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`previous-treatment-directions-${width}.png`), fullPage: true });
  });
  test(`desktop QR preserves selected treatment at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, { guest: true });
    await expect(page.locator('[data-booking-phone-qr]')).toBeVisible();
    await expect(page.locator('[data-desktop-phone-link]')).toHaveAttribute('href', 'https://app.shilohmtc.co.za/my-shiloh/?service=101#book-online');
    await expect(page.locator('[data-install-desktop-handoff]')).toContainText('Full Body Swedish');
    await expect(page.locator('[data-app-frame]')).toBeHidden();
    const a11y = await new AxeBuilder({ page }).include('[data-install-gate]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(a11y.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`desktop-qr-${width}.png`), fullPage: true });
  });
}
for (const status of [401, 503]) test(`previous treatment ${status} keeps retry and hides stale continuation`, async ({ page }) => {
  await open(page, { status });
  await page.getByRole('button', { name: 'Book a previous treatment', exact: true }).click();
  await expect(page.locator('[data-previous-treatment-status]')).toContainText(status === 401 ? 'Sign in again' : 'Please try again');
  await expect(page.locator('[data-previous-treatment-continue]')).toBeHidden();
  await expect(page.locator('[data-previous-treatment]')).toBeEnabled();
});
test('no eligible history offers catalogue without an invented previous visit', async ({ page }) => {
  await open(page, { previous: { available: false, message: 'There is no completed individual visit available to repeat yet.', href: '/my-shiloh/book' } });
  await page.getByRole('button', { name: 'Book a previous treatment', exact: true }).click();
  await expect(page.locator('[data-previous-treatment-status]')).toContainText('no completed individual visit');
  await expect(page.locator('[data-previous-treatment-continue]')).toHaveText('Choose a treatment');
  await expect(page.locator('[data-previous-treatment-continue]')).toHaveAttribute('href', '/my-shiloh/book');
});
