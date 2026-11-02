const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const width of [390, 1440]) {
  for (const story of ['treatments', 'book']) {
    test(`treatment comparison preserves details and booking identity on ${story} at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/iframe.html?id=public-website-production-pages--${story}&viewMode=story`, { waitUntil: 'networkidle' });
      const card = page.locator(story === 'treatments' ? '[data-service-id="101"]' : '#service-101');
      await expect(card.getByRole('heading')).toHaveText('Deep Tissue Massage');
      await expect(card).toContainText('60 min');
      await expect(card).toContainText('R850');
      const detail = card.locator('details');
      await expect(detail).not.toHaveAttribute('open', '');
      await expect(card.locator('.service-description')).toBeHidden();
      await card.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(detail).toHaveAttribute('open', '');
      await expect(card.locator('.service-description')).toHaveText('Focused therapeutic massage.');
      await expect(card.getByRole('link')).toHaveAttribute('href', story === 'treatments' ? '/book?service=101#service-101' : '/my-shiloh/book?service=101');
      await page.keyboard.press('Enter');
      await expect(card.locator('.service-description')).toBeHidden();
      await card.getByRole('link').click({ trial: true });
      const qualified = page.locator(story === 'treatments' ? '[data-service-id="404"]' : '#service-404');
      await qualified.locator('summary').click();
      await expect(qualified.locator('.service-description')).toContainText('skin assessment and suitability');
      await qualified.screenshot({ path: info.outputPath(`expanded-${story}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`comparison-${story}-${width}.png`), fullPage: true });
    });
  }
}
