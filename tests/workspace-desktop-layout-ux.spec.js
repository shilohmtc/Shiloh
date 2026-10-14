const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const { desktopDashboardModel, desktopDashboardHtml } = require('../stories/fixtures/workspaceDesktopLayout');

for (const kind of ['sparse', 'busy']) for (const width of [1180, 1440, 390, 500]) {
  test(`${kind} Dashboard independently stacks work, retains controls and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 757 });
    await page.route('**/calendar/workspace/navigation', route => route.fulfill({ json: {} }));
    await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: path.resolve('public/assets/pwa/shiloh-pwa-192.png') }));
    await page.route('**/desktop-review', route => route.fulfill({ contentType: 'text/html', body: desktopDashboardHtml(kind) }));
    let writes = 0;
    await page.route('**/calendar/staff-auth/csrf', route => { writes++; return route.fulfill({ json: { csrfToken: 'synthetic' } }); });
    await page.goto('/desktop-review', { waitUntil: 'networkidle' });
    const model = desktopDashboardModel(kind);
    await expect(page.locator('[data-dashboard-today] .day-summary')).toContainText(`${model.appointments.length} appointments`);
    await expect(page.locator('[data-dashboard-attention-panel]>.panel-head .summary-pill')).toHaveText('2');
    const today = await page.locator('[data-dashboard-today]').boundingBox();
    const attention = await page.locator('[data-dashboard-attention-panel]').boundingBox();
    const carry = await page.locator('[data-dashboard-carryover-panel]').boundingBox();
    const activity = await page.locator('[data-dashboard-activity-panel]').boundingBox();
    if (width > 1050) {
      expect(attention.y).toBeCloseTo(today.y, 0);
      expect(today.width / attention.width).toBeCloseTo(width >= 1400 ? 2 : 1, 1);
      expect(attention.x).toBeGreaterThan(today.x + today.width);
      expect(activity.y - today.y - today.height).toBeCloseTo(12, 0);
      expect(carry.y - attention.y - attention.height).toBeCloseTo(12, 0);
      for (const key of ['vouchers', 'rewards']) {
        const link = page.locator(`[data-workspace-destination="${key}"]`);
        const icon = await link.evaluate(node => { const s = getComputedStyle(node, '::before'); return { display: s.display, width: s.width, mask: s.maskImage }; });
        expect(icon.display).toBe('block'); expect(icon.width).toBe('20px'); expect(icon.mask).toContain('svg');
        await expect(link).toHaveAccessibleName(key === 'vouchers' ? 'Gift vouchers' : 'Rewards');
      }
    } else {
      expect(attention.y).toBeLessThan(today.y); expect(today.y).toBeLessThan(carry.y); expect(carry.y).toBeLessThan(activity.y);
    }
    const groups = page.locator('[data-dashboard-team-group]'); await expect(groups).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      const group = groups.nth(index);
      const columns = width >= 1400 ? 3 : 1;
      expect((await group.boundingBox()).width).toBeCloseTo(((await page.locator('.team-groups').boundingBox()).width - (columns - 1) * 10) / columns, 0);
      for (const appointment of model.teamGroups[index].appointments) {
        const card = group.locator(`[data-dashboard-appointment="${appointment.id}"]`);
        await expect(card).toContainText(appointment.clientName);
        await expect(card).toContainText(appointment.serviceName);
        await expect(card.getByRole('link', { name: 'Open / manage' })).toHaveAttribute('href', /date=2026-10-14/);
        await expect(card.locator('[data-dashboard-finalize="completed"]')).toHaveCount(appointment.canFinalize ? 1 : 0);
      }
    }
    for (const control of await page.locator('.appointment-actions button,.appointment-actions a,.request-actions a').all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    const finalize = page.locator('[data-dashboard-today] [data-dashboard-finalize="completed"]').first();
    for (let repeat = 0; repeat < 2; repeat++) {
      await finalize.click(); await expect(page.locator('[data-dashboard-outcome-dialog]')).toBeVisible();
      await page.getByRole('button', { name: 'Not yet', exact: true }).click();
      await expect(finalize).toBeFocused();
    }
    await finalize.click(); await page.keyboard.press('Escape'); await expect(finalize).toBeFocused();
    expect(writes).toBe(0);
    const axe = await new AxeBuilder({ page }).include('.workspace-frame').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-dashboard-today] .day-summary')).toContainText(`${model.appointments.length} appointments`);
  });
}
