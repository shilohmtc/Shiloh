const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Reports Storybook surface is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-reports--clinic-overview&viewMode=story', { waitUntil: 'networkidle' });

    const surface = page.locator('.workspace-report-story');
    await expect(surface).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team booking time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Treatments booked' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New and returning clients' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View report' })).toBeVisible();

    const text = await surface.innerText();
    expect(text).not.toMatch(/canonical|business-wide operational|practitioner authority|service snapshot|aggregate identity|utilisation|fail closed/i);

    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      targets: [...document.querySelectorAll('.workspace-report-story button,.workspace-report-story input,.workspace-report-story select,.workspace-report-story a')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({
          label: node.textContent.trim() || node.getAttribute('aria-label') || node.id,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        })),
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    if (viewport.name === 'phone') {
      expect(geometry.targets.filter(target => target.height < 43 || target.width < 43), 'Phone controls must retain 44px touch targets').toEqual([]);
    }

    const accessibility = await new AxeBuilder({ page })
      .include('.workspace-report-story')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`reports-${viewport.name}.png`),
      fullPage: true,
    });
  });
}
