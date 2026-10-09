const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');

const story = '/iframe.html?id=client-my-shiloh-pwa--bookings-without-upcoming&viewMode=story#bookings';
function experience(state) {
  const result = buildClientExperience({
    generatedAt: '2026-10-06T10:00:00.000Z', client: { id: 55, name: 'Synthetic Client' },
    nextAppointment: state.upcoming ? { id: 901, startsAt: '2026-10-09T08:00:00.000Z', endsAt: '2026-10-09T09:00:00.000Z', services: ['Hot Stone Massage'], practitioners: ['Synthetic Practitioner'], status: 'confirmed' } : null,
    forms: state.upcoming ? [{ id: 88, title: 'Consultation form', actionRequired: true }] : [],
    payment: state.upcoming ? { state: 'unpaid', depositState: 'awaiting', depositRequired: '400.00', depositOutstanding: '400.00', activePaymentPath: '/pay/synthetic_booking_901' } : null,
  });
  result.bookings.history = state.history;
  return result;
}

const pastRequest = { id: 904, canChangeVisibility: true, service: 'Quick Relief Back & Neck', date: 'Mon, 14 Sep', time: '10:00', practitioner: 'Synthetic Practitioner', status: 'Could not accommodate' };
for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }, { name: 'narrow', width: 320, height: 720 }]) {
  for (const scenario of [
    { name: 'hidden-history', upcoming: true, history: [{ ...pastRequest, hidden: true }] },
    { name: 'restored-history', upcoming: true, history: [{ ...pastRequest, hidden: false }] },
    { name: 'no-upcoming', upcoming: false, history: [{ ...pastRequest, hidden: true }] },
  ]) {
    test(`Bookings omits past requests and preserves current actions: ${scenario.name} on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const originalHistory = structuredClone(scenario.history);
      const mutations = [];
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/my-shiloh/api/experience', route => route.fulfill({ json: experience(scenario) }));
      await page.route('**/my-shiloh/api/booking-history/visibility', route => {
        mutations.push(route.request().postDataJSON());
        return route.fulfill({ status: 400, json: { error: 'Unexpected history mutation' } });
      });
      async function openBookings() {
        await page.goto(story, { waitUntil: 'networkidle' });
        await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
        await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
        const primary = page.locator('[data-client-experience-bookings] .action-card').first();
        await expect(primary).toContainText(scenario.upcoming ? 'Hot Stone Massage' : 'You don’t have an upcoming appointment');
        await expect(page.locator('[data-booking-history], [data-booking-history-status]')).toHaveCount(0);
        await expect(page.getByText('Past requests', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /hidden requests|Hide from my bookings|Restore to my bookings/i })).toHaveCount(0);
        await expect(page.locator('[data-view="bookings"]')).not.toContainText('Could not accommodate');
        if (scenario.upcoming) {
          await expect(primary.getByRole('link', { name: 'Pay R400 deposit' })).toHaveAttribute('href', '/pay/synthetic_booking_901');
          await primary.locator('summary').click();
          await expect(primary.getByRole('link', { name: 'Complete form: Consultation form' })).toHaveAttribute('href', '/my-shiloh/forms/complete?assignmentId=88');
        } else {
          await expect(primary.getByRole('link', { name: 'Start booking' })).toHaveAttribute('href', '/my-shiloh/book');
        }
        await expect(page.getByRole('link', { name: 'Ask Shiloh', exact: true })).toHaveAttribute('href', '#shiloh');
        await page.getByRole('link', { name: 'Ask Shiloh', exact: true }).click();
        await expect(page.locator('[data-view="shiloh"]')).toBeVisible();
        await page.locator('[data-view-target="bookings"]').click();
      }
      await openBookings();
      await page.locator('[data-view-target="home"]').click();
      await page.goBack();
      await expect(page.locator('[data-view="bookings"]')).toBeVisible();
      await openBookings();
      expect(mutations).toEqual([]);
      expect(scenario.history).toEqual(originalHistory);
      expect(errors).toEqual([]);
      const axe = await new AxeBuilder({ page }).include('[data-view="bookings"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`bookings-${scenario.name}-${viewport.name}.png`), fullPage: true });
    });
  }
}
