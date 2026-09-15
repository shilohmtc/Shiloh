const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const stories = [
  {
    id: 'workspace-services--marietjie-assigned-services',
    name: 'assigned services',
    assertSurface: async (page) => {
      await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
      await expect(page.getByText('Marietjie Signature Massage', { exact: true })).toBeVisible();
      await expect(page.getByText('Marietjie Deep Tissue', { exact: true })).toBeVisible();
      await expect(page.getByText('Signed in as')).toBeVisible();
      await expect(page.getByText('Marietjie', { exact: true }).last()).toBeVisible();
      await expect(page.getByText('+ Add service', { exact: true })).toHaveCount(0);
    },
  },
  {
    id: 'workspace-services--marietjie-service-management',
    name: 'service management',
    assertSurface: async (page) => {
      await expect(page.getByRole('heading', { name: 'Marietjie Signature Massage', exact: true })).toBeVisible();
      await expect(page.locator('[data-service-edit-form]')).toBeVisible();
      await expect(page.locator('[data-service-assign-form]')).toBeVisible();
    },
  },
];

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
]) {
  for (const story of stories) {
    test(`Marietjie Services ${story.name} is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: 'networkidle' });

      const surface = page.locator('.workspace-services-story');
      await expect(surface).toBeVisible();
      await story.assertSurface(page);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('.workspace-services-story button,.workspace-services-story input:not([type="checkbox"]),.workspace-services-story select,.workspace-services-story a,.workspace-services-story .check-field')]
          .filter(node => node.getClientRects().length > 0)
          .map(node => ({
            label: node.textContent.trim() || node.getAttribute('aria-label') || node.id,
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
          })),
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      if (viewport.name === 'phone') {
        expect(
          geometry.targets.filter(target => target.height < 43 || target.width < 43),
          'Phone controls must retain 44px touch targets'
        ).toEqual([]);
      }

      const accessibility = await new AxeBuilder({ page })
        .include('.workspace-services-story')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`marietjie-services-${story.name.replace(/\s+/g, '-')}-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
}
