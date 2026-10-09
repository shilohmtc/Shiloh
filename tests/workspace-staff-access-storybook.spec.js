const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const stories = [
  { id: 'workspace-staff-access--access-overview', heading: 'Staff access' },
  { id: 'workspace-staff-access--clinic-team', heading: 'Naomi' },
  { id: 'workspace-staff-access--own-workspace', heading: 'Synthetic practitioner' },
  { id: 'workspace-staff-access--protected-administrator', heading: 'Synthetic Client AI' },
  { id: 'workspace-staff-access--administrator-access', heading: 'Synthetic Client AI' },
  { id: 'workspace-staff-access--reception-access', heading: 'Shiloh Reception' },
  { id: 'workspace-staff-access--access-off', heading: 'Naomi' },
  { id: 'workspace-staff-access--empty-access', heading: 'Staff access' },
  { id: 'workspace-staff-access--staff-profiles', heading: 'Staff' },
];

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'phone', width: 390, height: 844 },
]) {
  for (const story of stories) {
    test(`Staff access ${story.id} is clear and accessible on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`, { waitUntil: 'networkidle' });
      const surface = page.locator('.staff-access-story');
      await expect(surface).toBeVisible();
      await expect(page.getByRole('heading', { name: story.heading, exact: true }).first()).toBeVisible();

      if (story.id.endsWith('own-workspace')) {
        await expect(page.locator('[data-access-toggle][role="switch"]')).toHaveCount(14);
        await expect(page.getByText('Protected boundaries', { exact: true })).toBeVisible();
        await page.getByText('Protected boundaries', { exact: true }).click();
        await expect(page.getByText('Cannot change Clinic Hours.', { exact: true })).toBeVisible();
      }
      if (story.id.endsWith('clinic-team')) {
        await expect(page.locator('[data-access-toggle][role="switch"]')).toHaveCount(10);
        await expect(page.getByText('Clinic team', { exact: true })).toBeVisible();
      }
      if (story.id.endsWith('access-overview')) {
        await expect(page.getByRole('link', { name: /Jean-Pierre/ })).toBeVisible();
        await expect(page.getByRole('link', { name: /Jean-Pierre/ })).toHaveAttribute('href', /\/calendar\/team\/staff-access\/42$/);
      }

      if (story.id.endsWith('administrator-access') || story.id.endsWith('reception-access')) {
        await expect(page.getByRole('switch', { name: 'Manage Reception booking requests', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
      }
      if (story.id.endsWith('protected-administrator')) {
        await expect(page.locator('[data-access-toggle][role="switch"]')).toHaveCount(0);
        await page.getByText('Current enabled access', { exact: true }).click();
        await expect(page.getByText('Issue permitted payment refunds', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
      }
      if (story.id.endsWith('staff-profiles')) {
        await expect(page.getByRole('button', { name: 'Create staff', exact: true })).toBeHidden();
        await page.locator('#add-staff-panel > summary').click();
        await expect(page.getByRole('button', { name: 'Create staff', exact: true })).toBeVisible();
      }
      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('.staff-access-story button,.staff-access-story a')]
          .filter(node => node.getClientRects().length > 0)
          .map(node => ({ label: node.textContent.trim(), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      if (viewport.name === 'phone') {
        expect(geometry.targets.filter(target => target.height < 43 || target.width < 43), 'Phone controls must retain 44px touch targets').toEqual([]);
      }

      const accessibility = await new AxeBuilder({ page })
        .include('.staff-access-story')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);

      await page.screenshot({ path: testInfo.outputPath(`staff-access-${story.id.split('--')[1]}-${viewport.name}.png`), fullPage: true });
    });
  }
}
