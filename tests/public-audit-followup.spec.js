const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const width of [390, 1440]) {
  test(`public audit wording and catalogue recovery at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/iframe.html?id=public-website-production-pages--home&viewMode=story', { waitUntil: 'networkidle' });
    const install = page.locator('[data-my-shiloh-install-entry]');
    await expect(install).toContainText('continue with your Shiloh details, or use a saved passkey');
    await expect(install).not.toContainText('SMS');
    await install.screenshot({ path: testInfo.outputPath(`signin-${width}.png`) });
    await page.goto('/iframe.html?id=public-website-production-pages--catalogue-presentation-review&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('.hero')).toContainText('continue with your Shiloh details');
    await expect(page.locator('.hero')).not.toContainText('SMS');
    const card = page.locator('#service-1001');
    await expect(card.locator('.meta strong')).toHaveText('R650');
    await expect(card.locator('.service-description')).toHaveCount(0);
    await expect(card.getByRole('link')).toHaveAttribute('href', '/my-shiloh/book?service=1001');
    await expect(page.locator('#service-1002 h3')).toHaveText('Young Guest Back & Neck Massage (age 8–15)');
    await expect(page.locator('#service-1003 .meta strong')).toHaveText('Price on request');
    // No invented description or space reserved for absent clinical copy.
    const geometry = await card.evaluate(node => {
      const meta = node.querySelector('.meta').getBoundingClientRect();
      const link = node.querySelector('a').getBoundingClientRect();
      return { gap: link.top - meta.bottom, height: node.getBoundingClientRect().height };
    });
    expect(geometry.gap).toBeLessThanOrEqual(13);
    if (width === 1440) {
      const described = await page.locator('#service-1003').boundingBox();
      expect(geometry.height).toBeLessThan(described.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
    await page.locator('.category').screenshot({ path: testInfo.outputPath(`catalogue-${width}.png`) });
    // A refresh or browser Back must retain the same public service handoff.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#service-1001 a')).toHaveAttribute('href', '/my-shiloh/book?service=1001');
    await page.goto('/iframe.html?id=public-website-production-pages--catalogue-unavailable&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('main')).toBeVisible();
    await page.goBack({ waitUntil: 'networkidle' });
    await expect(page.locator('#service-1002 h3')).toHaveText('Young Guest Back & Neck Massage (age 8–15)');
  });
}

for (const width of [320, 390, 1440]) {
  test(`booking catalogue keeps categories together at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/iframe.html?id=public-website-production-pages--book&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('.inside-shiloh-break')).toHaveCount(1);
    await expect(page.locator('.category-head span')).toHaveCount(0);
    await expect(page.locator('.category h2')).toHaveCount(7);
    await expect(page.locator('.service-card')).toHaveCount(9);
    const sections = await page.locator('.catalogue > *').evaluateAll(nodes => nodes.map(node => node.className));
    expect(sections).toEqual([...Array(7).fill('category'), 'inside-shiloh-break']);
    const jump = page.getByRole('navigation', { name: 'Service categories' }).getByRole('link', { name: 'Advanced Aesthetics', exact: true });
    await jump.click();
    const category = page.locator('.category').filter({ has: page.getByRole('heading', { name: 'Advanced Aesthetics', exact: true }) });
    await expect.poll(async () => category.evaluate(node => Math.round(node.getBoundingClientRect().top))).toBeGreaterThanOrEqual(82);
    await expect(category.getByRole('heading', { name: 'Advanced Aesthetics', exact: true })).toBeInViewport();
    const header = await page.locator('.site-header').boundingBox();
    const heading = await category.locator('h2').boundingBox();
    expect(heading.y).toBeGreaterThanOrEqual(header.y + header.height);
    await expect(page.locator('#service-101 a')).toHaveAttribute('href', '/my-shiloh/book?service=101');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`catalogue-category-${width}.png`) });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`catalogue-full-${width}.png`), fullPage: true });
  });
}
