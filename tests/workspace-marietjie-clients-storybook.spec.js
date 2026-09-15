const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const stories = [
  {
    id: 'workspace-clients--marietjie-client-base',
    name: 'client base',
    assertSurface: async (page) => {
      await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
      await expect(page.getByText('Marietjie Client One', { exact: true })).toBeVisible();
      await expect(page.getByText('Shared Shiloh Client', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Add client', exact: true })).toBeVisible();
      await expect(page.getByText('This list contains only your clients.', { exact: false })).toBeVisible();
    },
  },
  {
    id: 'workspace-clients--marietjie-client-management',
    name: 'client management',
    assertSurface: async (page) => {
      await expect(page.getByRole('heading', { name: 'Marietjie Client One', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Edit profile', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save client', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove from my clients', exact: true })).toBeVisible();
      await expect(page.getByText('Marietjie Signature Massage', { exact: true })).toBeVisible();
    },
  },
];

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
]) {
  for (const story of stories) {
    test(`Marietjie Clients ${story.name} is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: 'networkidle' });

      const surface = page.locator('.workspace-clients-story');
      await expect(surface).toBeVisible();
      await story.assertSurface(page);

      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('.workspace-clients-story button,.workspace-clients-story input:not([type="checkbox"]),.workspace-clients-story select,.workspace-clients-story a')]
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
        .include('.workspace-clients-story')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`marietjie-clients-${story.name.replace(/\s+/g, '-')}-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
}
