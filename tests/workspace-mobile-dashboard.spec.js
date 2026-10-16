const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const { dashboardModel } = require('../stories/fixtures/workspaceBrowserReview');
const { dashboardDepositsModel } = require('../stories/fixtures/workspaceDashboardDeposits');
const { renderDashboardPage, dashboardClientScript, depositQueueClientScript } = require('../src/presentation/workspaceDashboardUx');

async function assets(page) {
  await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: path.resolve('public/assets/pwa/shiloh-pwa-192.png') }));
  await page.route('**/calendar/workspace/navigation', route => route.fulfill({ json: {} }));
}

for (const width of [320, 390, 500, 700, 701, 1440]) {
  test(`phone dashboard reaches Today and attention without losing actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await assets(page);
    const writes = [];
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await page.goto('/iframe.html?id=workspace-browser-review--today-counts&viewMode=story', { waitUntil: 'networkidle' });
    const fixture = page.frames().find(frame => frame.url().includes('/dashboard-') || frame.url().endsWith('/dashboard.html'));
    expect(fixture).toBeTruthy();
    await page.goto(fixture.url(), { waitUntil: 'networkidle' });
    const today = page.locator('[data-dashboard-today]');
    const attention = page.locator('[data-dashboard-attention-panel]');
    const jump = page.locator('.topbar').getByRole('link', { name: /Needs attention/ });
    if (width <= 700) {
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard', exact: true })).toBeVisible();
      expect((await today.boundingBox()).y).toBeLessThan(130);
      expect((await today.boundingBox()).y).toBeLessThan((await attention.boundingBox()).y);
      await expect(jump).toBeVisible();
      await expect(jump).toContainText('3');
      expect((await jump.boundingBox()).height).toBeGreaterThanOrEqual(44);
      for (let repeat = 0; repeat < 2; repeat++) {
        await jump.click();
        await expect(attention).toBeFocused();
        expect((await attention.boundingBox()).y).toBeGreaterThanOrEqual(0);
        await attention.getByRole('link', { name: 'Back to Today' }).click();
        await expect(today).toBeFocused();
      }
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/#dashboard-today$/);
      expect((await today.boundingBox()).y).toBeGreaterThanOrEqual(0);
      expect((await today.boundingBox()).y).toBeLessThan(130);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(jump).toBeVisible();
      await expect(page.locator('.topbar .brand p')).not.toBeVisible();
    } else {
      await expect(jump).not.toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Synthetic Reviewer' })).toBeVisible();
    }
    await expect(today).toContainText('1 appointment');
    await expect(today).toContainText('2 pending requests');
    await expect(attention.locator('[data-dashboard-planning-request]')).toHaveCount(2);
    await expect(attention.getByRole('link', { name: 'Set holiday hours' })).toHaveAttribute('href', '/calendar/clinic-hours');
    await expect(today.getByRole('link', { name: 'Open calendar', exact: true })).toHaveAttribute('href', /date=2026-10-14/);
    for (const control of await today.locator(width <= 700 ? 'a,button' : 'button').all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const axe = await new AxeBuilder({ page }).include('.workspace-main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`) });
    expect(writes).toEqual([]);
  });
}

for (const state of ['busy', 'empty', 'loading', 'unavailable', 'practitioner', 'next-day']) {
  test(`compact dashboard preserves ${state} state and recovery at 390px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await assets(page);
    const model = state === 'busy' ? dashboardDepositsModel('busy') : dashboardModel();
    if (['empty', 'loading', 'unavailable'].includes(state)) {
      Object.assign(model, { appointments: [], teamGroups: [], planningRequests: [], holidayDecisions: [], recentActivity: [] });
      if (state !== 'empty') model.depositQueue = { [state]: true };
    }
    if (state === 'practitioner') model.mode = 'practitioner';
    if (state === 'next-day') model.requestedDateKey = '2026-10-13';
    const html = renderDashboardPage(model).replace(/<script\b[^>]*src="[^"]+"><\/script>/g, '')
      .replace('</body>', `<script>${dashboardClientScript()}${depositQueueClientScript()}</script></body>`);
    await page.route('**/__mobile-dashboard', route => route.fulfill({ contentType: 'text/html', body: html }));
    let writes = 0;
    await page.route('**/calendar/staff-auth/csrf', route => { writes++; return route.fulfill({ json: { csrfToken: 'synthetic-only' } }); });
    await page.goto('/__mobile-dashboard', { waitUntil: 'networkidle' });
    const today = page.locator('[data-dashboard-today]');
    expect((await today.boundingBox()).y).toBeLessThan(130);
    if (state === 'practitioner') await expect(today.getByRole('heading', { name: 'My day', exact: true })).toBeVisible();
    if (state === 'next-day') await expect(today.getByText('Next operational day', { exact: true })).toBeVisible();
    if (state === 'empty') {
      await expect(today).toContainText('No appointments are scheduled');
      await expect(page.locator('.topbar a')).toHaveCount(0);
    }
    if (state === 'busy') {
      const deposits = page.locator('[data-dashboard-deposits]');
      await expect(deposits.locator('[data-deposit-account]')).toHaveCount(2);
      await expect(today.locator('[data-dashboard-appointment]')).toHaveCount(12);
      const t = await today.boundingBox(), d = await deposits.boundingBox();
      expect(d.y - t.y - t.height).toBeCloseTo(12, 0);
      const finalize = today.locator('[data-dashboard-finalize="completed"]').first();
      for (let repeat = 0; repeat < 2; repeat++) {
        await finalize.click();
        await page.getByRole('button', { name: 'Not yet', exact: true }).click();
        await expect(finalize).toBeFocused();
      }
      await finalize.click();
      await page.keyboard.press('Escape');
      await expect(finalize).toBeFocused();
    }
    if (['loading', 'unavailable'].includes(state)) {
      const content = page.locator('[data-deposits-content]');
      await expect(content).toContainText(state === 'loading' ? 'Checking current deposits' : 'temporarily unavailable');
      let release;
      await page.route('**/calendar/workspace/deposits', async route => { await new Promise(resolve => { release = resolve; }); return route.fulfill({ status: 503, body: 'Synthetic unavailable' }); });
      await page.getByRole('button', { name: 'Refresh deposits' }).click();
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('button', { name: 'Refresh deposits' })).toBeDisabled();
      await expect.poll(() => Boolean(release)).toBe(true);
      release();
      await expect(content).toContainText('temporarily unavailable');
      await expect(page.getByRole('button', { name: 'Refresh deposits' })).toBeEnabled();
    }
    expect(writes).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${state}.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
