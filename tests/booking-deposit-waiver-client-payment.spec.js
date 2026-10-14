'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const fs = require('node:fs'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

for (const shared of [false, true]) for (const width of [1180, 1440, 390, 500]) {
  test(`waived ${shared ? 'shared' : 'ordinary'} client retains real treatment-payment actions at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 757 });
    const writes = [], errors = [], records = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/my-shiloh/api/**', async route => {
      if (route.request().method() !== 'GET') writes.push(route.request().url());
      await route.fallback();
    });
    for (const state of ['paid', 'partially_paid', 'unpaid']) {
      const payment = { accountId: 80, state, outstanding: state === 'paid' ? '0.00' : '400.00', depositState: 'waived', depositOutstanding: '0.00', depositRequired: '250.00', activePaymentPurpose: 'balance', activePaymentPath: '/pay/SYNTHETIC_TREATMENT' };
      const appointments = (shared ? [201, 203] : [201]).map(id => ({ id, startsAt: '2099-10-15T08:00:00Z', endsAt: '2099-10-15T09:00:00Z', status: 'confirmed', services: ['Synthetic treatment'], practitioners: ['Synthetic practitioner'] }));
      const model = buildClientExperience({ client: { id: 101, name: 'Synthetic client' }, nextAppointment: appointments[0], upcomingAppointments: appointments, forms: [], payment, appointmentPayments: appointments.map(item => ({ appointmentId: item.id, payment })) });
      await page.route('**/my-shiloh/api/experience', route => route.fulfill({ json: model }));
      // Repeated goto of the same story can retain the previous document and handlers.
      await page.goto('about:blank');
      await page.goto('/iframe.html?id=client-my-shiloh-pwa--bookings-without-upcoming&viewMode=story#bookings', { waitUntil: 'networkidle' });
      // Storybook can finish network loading before it mounts the production surface.
      // The application captures these nodes at startup, so mount before injecting it.
      await expect(page.locator('[data-app-frame]')).toHaveAttribute('data-client-authenticated', 'true');
      await expect(page.locator('[data-client-experience-bookings] .action-card').first()).toBeVisible();
      // Finished follows the addon's afterEach accessibility scan; do not race it.
      await page.waitForFunction(() => window.__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished');
      await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
      await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
      const bookings = page.locator('[data-client-experience-bookings]');
      await expect(bookings).toContainText('Deposit waived');
      await expect(bookings).toContainText(state === 'paid' ? 'Paid' : 'R400');
      const paymentLinks = bookings.getByRole('link', { name: 'Open payment', exact: true });
      await expect(paymentLinks).toHaveCount(state === 'paid' ? 0 : appointments.length);
      if (state !== 'paid') for (const link of await paymentLinks.all()) {
        await expect(link).toHaveAttribute('href', payment.activePaymentPath);
        expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      await expect(bookings.getByRole('link', { name: /Pay .* deposit/ })).toHaveCount(0);
      await page.locator('[data-view-target="home"]').click();
      await expect(page.locator('[data-client-home-payments] .action-card')).toHaveCount(state === 'paid' ? 0 : 1);
      await page.goBack();
      await expect(page.locator('[data-view="bookings"]')).toBeVisible();
      // Storybook also scans this same page; let its current scan finish before ours.
      await page.waitForFunction(() => !window.axe || !window.axe._running);
      const axe = await new AxeBuilder({ page }).include('[data-view="bookings"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const filename = `waived-client-${state}-${width}.png`, file = testInfo.outputPath(filename);
      await page.screenshot({ path: file, fullPage: true });
      records.push({ state, shared, width, filename, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), model });
      await page.unroute('**/my-shiloh/api/experience');
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    fs.writeFileSync(testInfo.outputPath('source-bound-client-payments.json'), JSON.stringify({ sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()), provenance: 'Synthetic model and GET-only browser fixtures; no live records, money submissions or device proof.', records }, null, 2));
  });
}
