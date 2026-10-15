const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');
const { renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const { profileFixture } = require('../stories/fixtures/notificationClarity');

for (const width of [390, 500, 1180, 1440]) {
  test(`notification clarity and existing navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: path.resolve(__dirname, '../public/assets/pwa/shiloh-pwa-192.png') }));
    for (const [story, text] of [['all', 'Booking confirmation not confirmed'], ['recent', 'No current My Shiloh updates.'], ['attention', 'Booking confirmation not confirmed'], ['profile-unknown', 'Phone alerts: Unknown'],
      ['profile-used', 'My Shiloh: Used before'], ['profile-setup-needed', 'Phone alerts: Setup needed']]) {
      await page.goto(`/iframe.html?id=workspace-notification-clarity--${story}&viewMode=story`, { waitUntil: 'networkidle' });
      const surface = page.locator('[data-notification-clarity]');
      await expect(surface).toContainText(text);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).include('[data-notification-clarity]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      if (['attention', 'recent', 'all'].includes(story) && width > 800) {
        const grid = await page.locator('.layout').boundingBox();
        const panel = await page.locator('.layout > section').first().boundingBox();
        if (story === 'all') expect(panel.width).toBeLessThan(grid.width * 0.6);
        else expect(Math.abs(panel.width - grid.width)).toBeLessThan(2);
      }
      if (story === 'profile-used') await expect(surface).not.toContainText('Not yet confirmed means');
      if (story === 'attention') {
        const first = page.locator('[data-message-attention="701"]');
        await expect(first).toContainText('The booking remains available in Bookings.');
        await expect(page.locator('[data-change-delivery-attention="804"]')).toContainText('Cancellation not confirmed');
        await expect(surface.getByRole('button', { name: /send|retry/i })).toHaveCount(0);
        const booking = first.getByRole('link', { name: 'Open booking', exact: true });
        await booking.focus();
        await expect(booking).toBeFocused();
        await expect(booking).toHaveAttribute('href', /date=2026-10-20&appointment=701&staff=all&returnTo=/);
        await expect(first.getByRole('link', { name: 'Open client', exact: true })).toHaveAttribute('href', '/calendar/clients/901');
        await expect(first.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', 'tel:+27820000001');
        for (const link of await first.getByRole('link').all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      const output = path.resolve(__dirname, '../artifacts/notification-clarity');
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `${story}-${width}.png`), fullPage: true, animations: 'disabled' });
      fs.writeFileSync(path.join(output, `${story}-${width}.html`), await page.content());
      if (story === 'attention') {
        await page.route('**/calendar/clients/901', route => route.fulfill({ contentType: 'text/html', body: renderClientDetailPage(profileFixture()) }));
        for (let visit = 0; visit < 2; visit++) {
          await page.locator('[data-message-attention="701"]').getByRole('link', { name: 'Open client', exact: true }).click();
          await expect(page.locator('[data-client-app-status]')).toContainText('Phone alerts: Unknown');
          await page.goBack({ waitUntil: 'networkidle' });
          await expect(page.locator('[data-message-attention="701"]')).toHaveCount(1);
        }
      }
    }
  });
}
