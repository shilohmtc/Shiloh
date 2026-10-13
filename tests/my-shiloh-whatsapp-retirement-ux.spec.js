const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`My Shiloh chat works without the retired WhatsApp bridge on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const retiredRequests = [];
    const messages = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('whatsapp-continuation')) retiredRequests.push(request.url());
    });
    await page.route('**/my-shiloh/api/shiloh/message', route => {
      messages.push(route.request().postDataJSON());
      return route.fulfill({ json: { reply: 'I can help with your current Shiloh visit.' } });
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-assistant-composer&viewMode=story#shiloh', { waitUntil: 'networkidle' });
    await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    await expect(page.locator('[data-view="shiloh"]')).toBeVisible();
    await expect(page.locator('[data-whatsapp-continuation]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue from WhatsApp' })).toHaveCount(0);
    await page.locator('[data-shiloh-chat-input]').fill('Help me prepare for my visit');
    await page.locator('[data-shiloh-chat-send]').click();
    await expect(page.locator('[data-shiloh-messages]')).toContainText('I can help with your current Shiloh visit.');
    await page.locator('[data-view-target="home"]').click();
    await page.locator('[data-view-target="shiloh"]').click();
    expect(messages).toEqual([{ message: 'Help me prepare for my visit' }]);
    expect(retiredRequests).toEqual([]);
    expect(errors).toEqual([]);
    const axe = await new AxeBuilder({ page }).include('[data-view="shiloh"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assistant-${viewport.name}.png`), fullPage: true });
  });
}
