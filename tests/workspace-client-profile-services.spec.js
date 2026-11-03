const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
for (const width of [390, 1280]) {
  test(`individual client services at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: require('node:path').resolve('public/assets/brand/shiloh-mark-192.png') }));
    await page.goto('/iframe.html?id=workspace-production-surfaces--client-profile-services&viewMode=story');
    const hub = page.locator('[data-client-profile-services]');
    await expect(hub).toBeVisible();
    await expect(hub.locator('summary')).toHaveText(['Activity', 'Forms', 'Rewards', 'Vouchers']);
    await page.screenshot({ path: testInfo.outputPath(`client-services-overview-${width}.png`), fullPage: true });
    await hub.locator('summary').filter({ hasText: /^Activity$/ }).click();
    await expect(hub.getByText('Available in My Shiloh', { exact: true })).toBeVisible();
    for (const label of ['Forms', 'Rewards', 'Vouchers']) await hub.locator('summary').filter({ hasText: new RegExp(`^${label}$`) }).click();
    await expect(hub.getByRole('link', { name: 'View signed form' })).toHaveAttribute('href', '/calendar/clients/9012/consultation-forms/7001');
    await expect(hub.getByText('Recorded balance: R120.00')).toBeVisible();
    await expect(hub.getByText('SV-SYNTHETIC-RECEIVED')).toBeVisible();
    await expect(hub.getByText('SV-SYNTHETIC-PURCHASED')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(async () => {
      try { return (await new AxeBuilder({ page }).include('[data-client-profile-services]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations; }
      catch (error) { if (error.message.includes('Axe is already running')) return ['retry']; throw error; }
    }).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`client-services-${width}.png`), fullPage: true });
    await hub.locator('summary').filter({ hasText: /^Forms$/ }).focus();
    await page.keyboard.press('Enter');
    await expect(hub.getByRole('link', { name: 'View signed form' })).not.toBeVisible();
    await page.evaluate(() => { window.location.hash = 'policy-documents'; });
    await expect(hub.getByRole('heading', { name: 'Booking Policy & Terms' })).toBeVisible();
  });
}
