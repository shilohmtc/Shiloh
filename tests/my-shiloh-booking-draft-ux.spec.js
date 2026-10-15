const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { confirmationClientScript } = require('../src/presentation/workspaceConfirmation');

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`unfinished draft review, explicit discard, changed-draft retry and retained selection on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let revision = 'a'.repeat(64), discarded = false, discardCalls = 0;
    const submissions = [];
    await page.route('**/my-shiloh/api/booking/practitioners?*', route => route.fulfill({ json: { practitioners: [{ id: '11', name: 'Synthetic Practitioner' }] } }));
    await page.route('**/my-shiloh/api/booking/availability?*', route => route.fulfill({ json: { slots: [{ startsAt: '2026-11-02T08:00:00Z', date: '2026-11-02', time: '10:00', endTime: '11:15' }] } }));
    await page.route('**/my-shiloh/api/booking/confirm', route => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill(discarded ? { status: 201, json: { message: 'Your booking request is in.' } } : { status: 409, json: { code: 'BOOKING_ALREADY_IN_PROGRESS', error: 'An unfinished booking draft is blocking this request. Review or discard the draft before sending a new request. Reload this page if the draft is not shown.' } });
    });
    await page.route('**/my-shiloh/api/booking/unfinished-draft', route => route.fulfill({ json: { draft: discarded ? null : { revision, canDiscard: true, treatment: 'Synthetic unfinished treatment', practitioner: '', date: '2026-10-16', time: '12:45' } } }));
    await page.route('**/my-shiloh/api/booking/unfinished-draft/discard', route => {
      discardCalls++;
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('storybook-csrf');
      expect(route.request().postDataJSON()).toEqual({ revision });
      if (discardCalls === 1) {
        revision = 'b'.repeat(64);
        return route.fulfill({ status: 409, json: { code: 'BOOKING_DRAFT_CHANGED', error: 'The unfinished draft changed. Review it again, and check Bookings before sending another request.' } });
      }
      discarded = true;
      return route.fulfill({ json: { discarded: true } });
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-native-booking&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-my-shiloh-booking]')).toBeVisible();
    await page.addScriptTag({ content: confirmationClientScript() });
    await page.addScriptTag({ url: '/my-shiloh/assets/booking.js' });
    await page.locator('[data-book-service][data-service-id="101"]').click();
    await page.getByRole('button', { name: /Synthetic Practitioner/ }).click();
    await page.locator('[data-booking-date]').fill('2026-11-02');
    await page.locator('[data-find-slots]').click();
    await page.getByRole('button', { name: /10:00–11:15/ }).click();
    await page.locator('[data-special-occasion][value="no"]').check();
    await page.locator('[data-policy-accepted]').check();
    const submit = page.getByRole('button', { name: 'Send booking request', exact: true });
    await submit.click();
    const card = page.locator('[data-booking-draft]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Synthetic unfinished treatment');
    await expect(submit).toBeDisabled();
    await expect(page.locator('[data-policy-accepted]')).toBeChecked();
    expect((await new AxeBuilder({ page }).include('[data-step="4"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`booking-draft-review-${viewport.name}.png`), fullPage: false, animations: 'disabled' });
    const discard = page.getByRole('button', { name: 'Discard unfinished draft', exact: true });
    await discard.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Your appointments stay unchanged.');
    expect((await new AxeBuilder({ page }).include('[data-shiloh-confirm]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`booking-draft-confirm-${viewport.name}.png`), fullPage: false, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Keep draft' }).click();
    expect(discardCalls).toBe(0);
    await expect(discard).toBeFocused();
    await discard.click(); await page.keyboard.press('Escape');
    expect(discardCalls).toBe(0);
    await discard.click(); await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(page.locator('[data-confirm-status]')).toContainText('draft changed');
    await expect(discard).toBeEnabled();
    expect(submissions).toHaveLength(1);
    await discard.click(); await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(card).toBeHidden(); await expect(submit).toBeFocused();
    await expect(page.locator('[data-policy-accepted]')).toBeChecked();
    expect(submissions).toHaveLength(1); // Discard never submits a new request automatically.
    await submit.click();
    await expect(page.locator('[data-step="5"]')).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(discardCalls).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
