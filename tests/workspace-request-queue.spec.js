const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderRequestQueue, requestQueueStyles } = require('../src/presentation/workspaceRequestQueue');

for (const width of [390, 1440]) {
  test(`Reception sorts and filters existing requests without hiding other attention at ${width}`, async ({ page }, info) => {
    const mutations = [];
    page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/iframe.html?id=workspace-production-surfaces--reception-request-triage&viewMode=story', { waitUntil: 'networkidle' });
    const panel = page.locator('[data-dashboard-attention-panel]');
    const queue = panel.locator('[data-request-queue]');
    const filter = queue.getByLabel('Show requests');
    await expect(filter).toBeVisible();
    await expect(filter.locator('option')).toHaveText(['All requests (5)', 'Needs staff response (4)', 'Awaiting client (1)']);
    await expect(queue.locator('[data-request-state]').first()).toContainText('Synthetic oldest request');
    await expect(queue.locator('[data-request-state]').last()).toContainText('Synthetic undated request');
    await expect(queue.locator('[data-dashboard-planning-request="821"] .request-age')).toContainText('Requested 2 days ago');
    await expect(queue.locator('#booking-request-813 .request-age')).toHaveCount(0);
    await expect(panel.locator('.panel-head .summary-pill')).toHaveText('6');
    await panel.screenshot({ path: info.outputPath(`requests-all-${width}.png`) });
    await queue.locator('#booking-request-811 [data-proposal-date]').fill('2026-11-09');
    await queue.locator('#booking-request-811 [data-proposal-time]').fill('11:00');
    await filter.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(filter).toHaveValue('staff');
    await expect(queue.locator('[data-request-state]:visible')).toHaveCount(4);
    await expect(queue.locator('[data-dashboard-planning-request="821"]')).toBeVisible();
    await expect(queue.locator('[data-dashboard-reschedule-request="831"]')).toBeVisible();
    await expect(queue.locator('#booking-request-812')).toBeHidden();
    await expect(queue.locator('[data-request-filter-status]')).toHaveText('Showing 4 of 5 requests.');
    await filter.selectOption('client');
    await expect(queue.locator('[data-request-state]:visible')).toHaveCount(1);
    await expect(queue.locator('#booking-request-812')).toBeVisible();
    await expect(panel.locator('[data-dashboard-holiday-decision]')).toBeVisible();
    await expect(panel.locator('.panel-head .summary-pill')).toHaveText('6');
    const axe = await new AxeBuilder({ page }).include('[data-dashboard-attention-panel]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: info.outputPath(`requests-client-${width}.png`) });
    await filter.selectOption('all');
    await expect(queue.locator('[data-request-state]:visible')).toHaveCount(5);
    await expect(queue.locator('#booking-request-811 [data-proposal-date]')).toHaveValue('2026-11-09');
    await expect(queue.locator('#booking-request-811 [data-proposal-time]')).toHaveValue('11:00');
    expect(mutations).toEqual([]);
  });

  test(`Reception can recover an empty request filter at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/iframe.html?id=workspace-production-surfaces--reception-request-triage-staff-only&viewMode=story', { waitUntil: 'networkidle' });
    const filter = page.getByLabel('Show requests');
    await filter.selectOption('client');
    await expect(page.locator('[data-request-state]:visible')).toHaveCount(0);
    await expect(page.locator('[data-request-filter-status]')).toHaveText('Showing 0 of 5 requests.');
    await expect(page.locator('[data-dashboard-holiday-decision]')).toBeVisible();
    await filter.selectOption('all');
    await expect(page.locator('[data-request-state]:visible')).toHaveCount(5);
  });
}

test('without JavaScript all projected requests remain visible', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const html = renderRequestQueue([
    { html: '<article>First request</article>', requestedAt: '2026-11-01T10:00:00Z' },
    { html: '<article>Second request</article>', awaitingClient: true },
  ], '2026-11-02T10:00:00Z');
  await page.setContent(`<html lang="en"><head><title>Synthetic queue</title><style>${requestQueueStyles}</style></head><body>${html}</body></html>`);
  await expect(page.locator('article:visible')).toHaveCount(2);
  await expect(page.getByLabel('Show requests')).toBeHidden();
  await context.close();
});
