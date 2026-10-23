const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

for (const width of [390, 1440]) {
  test(`public audit wording and catalogue recovery at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/iframe.html?id=public-website-production-pages--home&viewMode=story', { waitUntil: 'networkidle' });
    const install = page.locator('[data-my-shiloh-install-entry]');
    await expect(install).toContainText('sign in with a WhatsApp code or a saved passkey');
    await expect(install).not.toContainText('SMS');
    await install.screenshot({ path: testInfo.outputPath(`signin-${width}.png`) });
    await page.goto('/iframe.html?id=public-website-production-pages--catalogue-presentation-review&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('.hero')).toContainText('sign in with a WhatsApp code or a saved passkey');
    await expect(page.locator('.hero')).not.toContainText('SMS');
    const card = page.locator('#service-1001');
    await expect(card.locator('.meta strong')).toHaveText('R650');
    await expect(card.locator('.service-description')).toHaveCount(0);
    await expect(card.getByRole('link')).toHaveAttribute('href', '/my-shiloh/book?service=1001');
    await expect(page.locator('#service-1002 h3')).toHaveText('Young Guest Back & Neck Massage (age 8–15)');
    await expect(page.locator('#service-1005 h3')).toHaveText('Young Guest Back & Neck Massage');
    const footCare = page.locator('.category').filter({ has: page.locator('#service-1004') });
    await expect(footCare.locator('h2')).toHaveText('Pedicures & Foot Care');
    await expect(page.locator('#service-1004 .meta strong')).toHaveText('R200');
    await expect(page.locator('#service-1004 a')).toHaveAttribute('href', '/my-shiloh/book?service=1004');
    await page.locator('#service-1004').screenshot({ path: testInfo.outputPath(`young-guest-pedi-${width}.png`) });
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
    await page.locator('.category').first().screenshot({ path: testInfo.outputPath(`catalogue-${width}.png`) });
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
    await expect(page.locator('.inside-shiloh-break')).toHaveCount(0);
    await expect(page.locator('.category-head span')).toHaveCount(0);
    await expect(page.locator('.category h2')).toHaveCount(7);
    await expect(page.locator('.service-card')).toHaveCount(9);
    const sections = await page.locator('.catalogue > *').evaluateAll(nodes => nodes.map(node => node.className));
    expect(sections).toEqual(Array(7).fill('category'));
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

for (const width of [320, 390, 1440]) {
  test(`Contact gives My Shiloh one focused action without repeating Reception at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/iframe.html?id=public-website-production-pages--contact&viewMode=story', { waitUntil: 'networkidle' });
    const portal = page.locator('[data-my-shiloh-contact-entry]');
    await expect(portal.getByRole('link')).toHaveCount(1);
    await expect(portal.getByRole('link', { name: 'Open My Shiloh', exact: true })).toHaveAttribute('href', 'https://app.shilohmtc.co.za/my-shiloh/');
    await expect(portal).not.toContainText(/Reception|066 239 9138/);
    const contact = page.locator('.contact-panel');
    await expect(contact.getByRole('link', { name: 'Call Reception', exact: true })).toHaveAttribute('href', 'tel:+27662399138');
    await expect(contact.getByRole('link', { name: 'WhatsApp Reception', exact: true })).toHaveAttribute('href', 'https://wa.me/27662399138');
    await expect(contact.getByRole('link', { name: 'info@shilohmtc.co.za', exact: true })).toHaveAttribute('href', 'mailto:info@shilohmtc.co.za');
    await portal.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await portal.locator('a').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    const axe = await new AxeBuilder({ page }).include('[data-my-shiloh-contact-entry]').analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await portal.screenshot({ path: testInfo.outputPath(`contact-portal-after-${width}.png`) });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(portal.getByRole('link')).toHaveCount(1);
    await expect(portal).not.toContainText('Reception');
  });
}


for (const width of [320, 390, 768, 900, 901, 1024, 1100, 1101, 1440]) {
  test(`public navigation and Contact remain balanced at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/iframe.html?id=public-website-production-pages--contact&viewMode=story', { waitUntil: 'networkidle' });
    const collapsed = width <= 1100;
    await expect(page.locator('.mobile-nav')).toBeVisible({ visible: collapsed });
    await expect(page.locator('.site-nav')).toBeVisible({ visible: !collapsed });
    if (collapsed) {
      await page.locator('.mobile-nav summary').focus();
      await page.keyboard.press('Enter');
    }
    const nav = page.locator(collapsed ? '.mobile-nav-links' : '.site-nav');
    for (const name of ['Book', 'Staff Workspace', /^My Shiloh/]) {
      const link = nav.getByRole('link', { name, exact: typeof name === 'string' });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    if (collapsed) await page.locator('.mobile-nav summary').click();
    await expect(page.locator('.welcome-offer')).toHaveCount(0);
    const cards = await page.locator('.contact-panel > .card').evaluateAll(nodes => nodes.map(n => {
      const { x, y, width, height } = n.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(cards).toHaveLength(3);
    if (width > 900) {
      expect(cards[1].y).toBe(cards[2].y);
      expect(Math.abs(cards[1].width - cards[2].width)).toBeLessThanOrEqual(1);
      expect(cards[1].height).toBe(cards[2].height);
      expect(cards[0].width).toBeGreaterThan(cards[1].width);
    } else {
      expect(cards[1].y).toBeGreaterThan(cards[0].y + cards[0].height);
      expect(cards[2].y).toBeGreaterThan(cards[1].y + cards[1].height);
    }
    // The complete footer name uses the header's lettering without clipping or an orphaned last word.
    await expect(page.locator('.site-footer-name')).toHaveText('Shiloh Massage & Aesthetic Clinic');
    const brand = await page.evaluate(() => {
      const header = getComputedStyle(document.querySelector('.site-brand-name'));
      const name = document.querySelector('.site-footer-name');
      const footer = document.querySelector('.site-footer').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(name);
      const text = [...range.getClientRects()];
      const style = getComputedStyle(name);
      return {
        sameLettering: ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'].every(key => style[key] === header[key]),
        lines: text.length,
        unclipped: text.every(rect => rect.left >= footer.left && rect.right <= footer.right && rect.top >= footer.top && rect.bottom <= footer.bottom),
      };
    });
    expect(brand.sameLettering).toBe(true);
    expect(brand.unclipped).toBe(true);
    expect(brand.lines).toBeLessThanOrEqual(width > 760 ? 1 : 2);
    await page.locator('.site-footer').screenshot({ path: testInfo.outputPath(`public-footer-name-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const axe = await new AxeBuilder({ page }).include('[data-public-site-story]').analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`public-contact-layout-${width}.png`), fullPage: true });
  });
}
