const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test('passkey guest and profile paths remain usable on phone and desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--passkey-guest&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-view="home"] [data-passkey-sign-in]')).toBeVisible();
    await expect(page.locator('[data-view="home"] [data-client-auth-start]')).toBeVisible();
    const guestAxe = await new AxeBuilder({ page }).include('[data-view="home"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(guestAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`client-passkey-guest-${viewport.name}.png`),
      fullPage: true, animations: 'disabled' });

    await page.goto('/iframe.html?id=client-my-shiloh-pwa--passkey-profile&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-view="profile"] [data-passkey-enroll]')).toBeVisible();
    await expect(page.locator('[data-view="profile"] [data-passkey-devices] .passkey-device')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove iPhone passkey' })).toBeVisible();
    await expect(page.locator('[data-view="profile"]')).toContainText('Signed in with a passkey');
    const profileAxe = await new AxeBuilder({ page }).include('[data-view="profile"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(profileAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`client-passkey-profile-${viewport.name}.png`),
      fullPage: true, animations: 'disabled' });
  }
});
