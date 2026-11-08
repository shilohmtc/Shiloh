const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { voucherRecoveryFixture } = require('./helpers/voucherRecoveryFixture');

for (const width of [390, 1440]) {
  test(`voucher recovery preserves privacy and sessions without sending codes at ${width}`, async ({ page, context }, testInfo) => {
    const f = await voucherRecoveryFixture();
    const writes = [];
    page.on('request', r => { if (r.method() !== 'GET') writes.push(r.url()); });
    try {
      await page.setViewportSize({ width, height: 900 });
      await context.addCookies([{ name: 'shiloh_client_session', value: 'S'.repeat(43), url: f.origin }]);
      const inspect = async state => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`voucher-recovery-${state}-${width}.png`), fullPage: true });
      };
      let response = await page.goto(`${f.origin}/my-shiloh/gift-vouchers`);
      expect(response.status()).toBe(401);
      expect(response.headers()['cache-control']).toContain('no-store');
      await expect(page.getByRole('heading', { name: 'Verify your mobile to view vouchers' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('SV-SYNTHETIC');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Verify with WhatsApp' })).toBeFocused();
      await inspect('available');
      await page.getByRole('link', { name: 'Verify with WhatsApp' }).click();
      await expect(page.getByRole('button', { name: 'Continue with WhatsApp' })).toBeVisible();
      expect(f.state.beginCalls).toBe(0);

      f.state.codeEnabled = false;
      response = await page.goto(`${f.origin}/my-shiloh/gift-vouchers`);
      expect(response.status()).toBe(401);
      await expect(page.getByRole('link', { name: 'Verify with WhatsApp' })).toHaveCount(0);
      await expect(page.getByText('WhatsApp verification is not available right now.', { exact: false })).toBeVisible();
      await inspect('unavailable');

      f.state.codeEnabled = true;
      await f.db.query("UPDATE crm_v2_clients SET normalized_mobile='invalid',mobile_verified_at=NOW() WHERE id=101");
      response = await page.goto(`${f.origin}/my-shiloh/gift-vouchers`);
      expect(response.status()).toBe(409);
      await expect(page.getByRole('heading', { name: 'Check your mobile details' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Verify with WhatsApp' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Open Profile' })).toHaveAttribute('href', '/my-shiloh/#profile');
      await inspect('invalid-mobile');
      await page.getByRole('link', { name: 'Open Profile' }).click();
      await expect(page).toHaveURL(`${f.origin}/my-shiloh/#profile`);
      expect((await context.cookies()).find(c => c.name === 'shiloh_client_session').value).toBe('S'.repeat(43));
      expect(writes).toEqual([]);
      expect(f.state.beginCalls).toBe(0);
      expect(f.state.errors).toEqual([]);
    } finally { await f.close(); }
  });
}
