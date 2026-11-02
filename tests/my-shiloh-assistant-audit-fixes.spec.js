'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createMyShilohAssistantService } = require('../src/services/myShilohAssistant');
const { REVIEW_ONLY_REPLY, PREPARATION_FAILED_REPLY } = require('../src/services/myShilohAssistantReplyPolicy');

for (const width of [390, 1440]) {
  test(`last completed review and failed replacement stay honest at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    let actions = 0;
    const service = createMyShilohAssistantService({
      contextService: { getContext: async () => ({ client: { name: 'Synthetic' } }) },
      readTools: { definitions: [], execute: async () => ({ ok: true, visit: {
        found: true, complete: true, ambiguous: false, multiService: false, startsAt: '2030-10-02T12:00:00Z',
        services: ['Synthetic treatment'], practitioners: ['Synthetic therapist'],
      } }) },
      actionTools: { definitions: [], handles: () => true, execute: async () => ++actions === 1
        ? { modelResult: { ok: true }, clientAction: { type: 'booking_request', href: '/my-shiloh/book?service=101', title: 'Review your booking', detail: 'Earlier choice', note: 'Nothing booked', label: 'Continue booking' } }
        : { modelResult: { ok: false, error: 'slot_unavailable' }, clientAction: null } },
      ai: async (_key, message, options) => {
        if (message === 'make it later') {
          await options.toolExecutor('prepare_my_booking', {}); await options.toolExecutor('prepare_my_booking', {});
        }
        return 'Your booking is confirmed.';
      },
    });
    let writes = 0;
    await page.route('**/my-shiloh/api/**', route => { if (route.request().method() !== 'GET') writes++; return route.fulfill({ json: {} }); });
    await page.route('**/my-shiloh/api/shiloh/message', async route => route.fulfill({ json: await service.reply({ sessionId: 1, crmV2ClientId: 55, message: route.request().postDataJSON().message }) }));
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-assistant-composer&viewMode=story#shiloh', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-app-frame]')).toBeVisible();
    const surface = await page.locator('#storybook-root').innerHTML(); await page.setContent(surface);
    await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    const send = async text => { await page.locator('[data-shiloh-chat-input]').fill(text); await page.locator('[data-shiloh-chat-send]').click(); await expect(page.locator('[data-shiloh-chat-send]')).toBeEnabled(); };
    await send('book my last appointment again');
    await expect(page.locator('[data-shiloh-messages]')).toContainText('Synthetic treatment with Synthetic therapist');
    await expect(page.locator('[data-shiloh-messages]')).toContainText('14:00 (South African time)');
    await expect(page.locator('[data-shiloh-messages]')).toContainText('What new date and time');
    await expect(page.locator('[data-client-action-card]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`last-completed-${width}.png`), fullPage: true });
    await send('make it later');
    await expect(page.locator('[data-shiloh-messages]')).toContainText(PREPARATION_FAILED_REPLY);
    await expect(page.locator('[data-client-action-card]')).toHaveCount(0);
    await send('Is it booked?');
    await expect(page.locator('[data-shiloh-messages]')).toContainText(REVIEW_ONLY_REPLY);
    await expect(page.locator('[data-shiloh-messages]')).not.toContainText('Your booking is confirmed.');
    expect(writes).toBe(0);
    expect((await new AxeBuilder({ page }).include('[data-view="shiloh"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`guarded-followup-${width}.png`), fullPage: true });
  });
}
