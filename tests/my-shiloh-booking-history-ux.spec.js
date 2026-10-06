const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');

const story = '/iframe.html?id=client-my-shiloh-pwa--booking-history-hidden&viewMode=story#bookings';
function experience(hidden = true) {
  const result = buildClientExperience({
    generatedAt: '2026-10-06T10:00:00.000Z', client: { id: 55, name: 'Synthetic Client' },
    nextAppointment: { id: 901, startsAt: '2026-10-09T08:00:00.000Z', endsAt: '2026-10-09T09:00:00.000Z', services: ['Hot Stone Massage'], practitioners: ['Christel'], status: 'confirmed' },
    forms: [{ id: 88, title: 'Consultation form', actionRequired: true }],
    payment: { state: 'unpaid', depositState: 'awaiting', depositRequired: '400.00', depositOutstanding: '400.00', activePaymentPath: '/pay/synthetic_booking_901' },
  });
  result.bookings.history = [{ id: 904, hidden, canChangeVisibility: true, service: 'Quick Relief Back & Neck', date: 'Mon, 14 Sep', time: '10:00', practitioner: 'Christel', status: 'Could not accommodate' }];
  return result;
}

async function installMocks(page, state) {
  await page.route('**/my-shiloh/auth/csrf', route => route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }));
  await page.route('**/my-shiloh/api/experience', route => route.fulfill({ json: experience(state.hidden) }));
  await page.route('**/my-shiloh/api/booking-history/visibility', async route => {
    const payload = route.request().postDataJSON();
    state.requests.push(payload);
    expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
    expect(Object.keys(payload).sort()).toEqual(['appointmentId', 'hidden']);
    if (state.hold) await state.hold;
    if (state.failure) return route.fulfill({ status: state.failure, json: { error: state.failure === 401 ? 'Sign in again.' : 'This request is no longer available.' } });
    state.hidden = payload.hidden;
    await route.fulfill({ json: { appointmentId: payload.appointmentId, hidden: state.hidden } });
  });
}

async function openBookings(page) {
  await page.goto(story, { waitUntil: 'networkidle' });
  await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  await expect(page.locator('[data-client-experience-bookings] .action-card').first()).toContainText('Hot Stone Massage');
}

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`booking-history hide, restore, reload and interruptions on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = { hidden: true, requests: [] };
    await installMocks(page, state);
    await openBookings(page);
    const active = page.locator('[data-client-experience-bookings]');
    const host = page.locator('[data-booking-history]');
    const toggle = page.locator('[data-booking-history-toggle]');
    const status = page.locator('[data-booking-history-status]');
    await expect(active).not.toContainText('Could not accommodate');
    await expect(active.locator('[data-booking-history-action]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore to my bookings' })).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: testInfo.outputPath(`booking-history-tidy-${viewport.name}.png`), fullPage: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(host).toContainText('The clinic keeps its records.');
    await expect(page.getByRole('button', { name: 'Restore to my bookings' })).toBeVisible();
    // Closing the list and navigating away never changes preferences.
    await toggle.click();
    await expect(page.getByText('Quick Relief Back & Neck', { exact: true })).toBeHidden();
    await page.locator('[data-view-target="home"]').click();
    await page.goBack();
    await expect(page.locator('[data-view="bookings"]')).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await toggle.click();
    await page.screenshot({ path: testInfo.outputPath(`booking-history-expanded-${viewport.name}.png`), fullPage: true });
    let release;
    state.hold = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Restore to my bookings' }).evaluate(button => { button.click(); button.click(); button.click(); });
    await expect(page.getByRole('button', { name: 'Restore to my bookings' })).toBeDisabled();
    await expect(toggle).toBeDisabled();
    await expect.poll(() => state.requests.length).toBe(1);
    // Navigation while the write is pending does not cancel or duplicate it.
    await page.locator('[data-view-target="home"]').click();
    release();
    await expect(status).toContainText('Restored to your bookings');
    state.hold = null;
    await page.locator('[data-view-target="bookings"]').click();
    await expect(page.locator('[data-booking-history-visible]')).toContainText('Quick Relief Back & Neck');
    await expect(toggle).toBeHidden();
    await expect(active.locator('[data-booking-history-action]')).toHaveCount(0);
    // Fresh page state must be fetched from the server rather than phone storage.
    await openBookings(page);
    await expect(page.getByRole('button', { name: 'Hide from my bookings' })).toBeVisible();
    const activeBefore = await active.innerText();
    const paymentLinksBefore = await active.locator('a[href^="/pay/"], a[href^="/my-shiloh/forms/"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    await page.getByRole('button', { name: 'Hide from my bookings' }).click();
    await expect(status).toContainText('Hidden from your bookings');
    await expect(page.locator('[data-booking-history-visible]')).toBeHidden();
    expect(await active.innerText()).toBe(activeBefore);
    expect(await active.locator('a[href^="/pay/"], a[href^="/my-shiloh/forms/"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))).toEqual(paymentLinksBefore);
    await openBookings(page);
    await expect(page.getByRole('button', { name: 'Restore to my bookings' })).toBeHidden();
    await toggle.click();
    for (const failure of [409, 401]) {
      state.failure = failure;
      await page.getByRole('button', { name: 'Restore to my bookings' }).click();
      await expect(status).toContainText(failure === 401 ? 'Please sign in again' : 'no longer available');
      await expect(page.getByRole('button', { name: 'Restore to my bookings' })).toBeEnabled();
      expect(state.hidden).toBe(true);
    }
    state.failure = null;
    await page.getByRole('button', { name: 'Restore to my bookings' }).click();
    await expect(status).toContainText('does not reopen the request');
    const axe = await new AxeBuilder({ page }).include('[data-view="bookings"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`booking-history-restored-${viewport.name}.png`), fullPage: true });
  });
}
