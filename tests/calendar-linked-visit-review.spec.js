'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const width of [390, 1440]) {
  for (const failure of ['none', 'rejected', 'network', 'malformed', 'render']) {
    test(`Linked visit review ${failure} and recovery at ${width}`, async ({ page }, info) => {
      let mode = failure, prepares = 0, confirms = 0;
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.syntheticUnhandledRejections = [];
        window.addEventListener('unhandledrejection', (event) => {
          window.syntheticUnhandledRejections.push(String(event.reason));
        });
      });
      await page.route('**/calendar/staff-auth/csrf', (route) =>
        route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }),
      );
      await page.route('**/calendar/book/multiple/**', async (route) => {
        const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
        if (endpoint === 'client-search')
          return route.fulfill({ json: { clients: [{ id: '55', displayName: 'Synthetic client' }] } });
        if (endpoint === 'confirm') {
          confirms++;
          return route.fulfill({ status: 500, json: { error: 'Unexpected synthetic confirmation' } });
        }
        expect(endpoint).toBe('prepare');
        prepares++;
        const payload = route.request().postDataJSON();
        expect(payload.treatments.map((item) => item.startTime)).toEqual(['10:30', '12:00', '13:30']);
        if (mode === 'network') return route.abort('failed');
        if (mode === 'rejected')
          return route.fulfill({ status: 409, json: { error: 'Synthetic calendar conflict. Choose another time.' } });
        if (mode === 'malformed') return route.fulfill({ json: {} });
        return route.fulfill({ json: { review: {
          client: { displayName: 'Synthetic client' }, subtotal: 1600, quoteHash: 'synthetic-quote',
          assignments: payload.treatments.map((item, index) => ({
            position: index + 1,
            service: { name: `Synthetic treatment ${index + 1}`, price: [650, 550, 400][index] },
            practitioner: { displayName: 'Synthetic practitioner' },
            startsAt: mode === 'render' ? 'invalid-date' : `2099-11-20T${item.startTime}:00+02:00`,
            endsAt: `2099-11-20T${['12:00', '13:30', '14:30'][index]}:00+02:00`,
          })),
        } } });
      });
      await page.setViewportSize({ width, height: 950 });
      await page.goto('/iframe.html?id=calendar-linked-visit--three-treatments&viewMode=story');
      await page.getByRole('searchbox', { name: 'Find client' }).fill('Synthetic');
      await page.getByRole('button', { name: 'Find', exact: true }).click();
      await page.locator('.client-result').click();
      await page.getByRole('button', { name: 'Add treatment' }).click();
      for (let i = 0; i < 3; i++) {
        const card = page.locator('[data-treatment]').nth(i);
        await card.locator('[data-service]').selectOption(String(10 + i));
        await card.locator('[data-staff]').selectOption('3');
        await card.locator('[data-start-time]').fill(['10:30', '12:00', '13:30'][i]);
      }
      const review = page.locator('[data-multiple-review]');
      const status = page.locator('[data-multiple-status]');
      const reviewButton = page.getByRole('button', { name: 'Review linked visit', exact: true });
      await reviewButton.click();
      if (failure !== 'none') {
        await expect(status).toHaveClass('status error');
        await expect(status).not.toContainText('Checking');
        await expect(review).toBeHidden();
        await expect(reviewButton).toBeEnabled();
        await expect(page.locator('[data-treatment]').nth(2).locator('[data-start-time]')).toHaveValue('13:30');
        await page.locator('[data-confirm-multiple]').dispatchEvent('click');
        expect(confirms).toBe(0);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(`linked-visit-${failure}-${width}.png`), fullPage: true });
        mode = 'none';
        await reviewButton.click();
      }
      await expect(review).toBeVisible();
      await expect(status).toHaveClass('status ready');
      await expect(review.locator('.review-row').first()).toHaveText('ClientSynthetic client');
      await expect(review.locator('.review-treatment')).toHaveCount(3);
      for (let i = 0; i < 3; i++)
        await expect(review.locator('.review-treatment').nth(i)).toContainText(
          ['10:30–12:00', '12:00–13:30', '13:30–14:30'][i],
        );
      await expect(review.locator('.review-row').last()).toContainText(/Booking total.*1[\s\u00a0]?600/);
      await expect(reviewButton).toBeEnabled();
      expect(prepares).toBe(failure === 'none' ? 1 : 2);
      expect(confirms).toBe(0);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.syntheticUnhandledRejections)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(scan.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`linked-visit-ready-${failure}-${width}.png`), fullPage: true });
    });
  }
}
