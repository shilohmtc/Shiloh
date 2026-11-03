const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderContact } = require('../src/services/publicWebsite');

for (const width of [390, 1440]) {
  test(`confirmed arrival details at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/iframe.html?id=public-website-production-pages--contact&viewMode=story', { waitUntil: 'networkidle' });
    const hours = page.locator('.clinic-opening-hours');
    await expect(hours).toContainText('Tuesday–Friday');
    await expect(hours).toContainText('08:00–17:00');
    await expect(hours).toContainText('Saturday');
    await expect(hours).toContainText('08:00–14:00');
    await expect(hours).toContainText('Monday & Sunday');
    await expect(hours).toContainText('Closed');
    await expect(page.locator('.contact-booking')).toContainText('Public holiday hours may vary.');
    await expect(page.locator('.contact-booking')).toContainText('subject to availability and booking rules');
    await expect(page.locator('.contact-visit')).toContainText('Open parking in front of the clinic.');
    await expect(page.locator('.contact-visit')).toContainText('no steps at the entrance or inside');
    await expect(page.getByRole('heading', { name: 'Great neighbours make life more beautiful.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get directions in Google Maps (opens in a new tab)' })).toHaveAttribute('href', /destination=37%20Jacobs%20Street/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: info.outputPath(`arrival-contact-${width}.png`), fullPage: true });
  });
}

for (const copyFails of [false, true]) test(`treatment handoff retains instructions when clipboard ${copyFails ? 'fails' : 'works'}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(fails => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Safari', configurable: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => {
      if (fails) throw Error('Clipboard unavailable');
      window.copiedTreatmentCode = value;
    } } });
  }, copyFails);
  await page.route('**/my-shiloh/api/**', route => route.fulfill({ json: {} }));
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--website-treatment-handoff&viewMode=story&service=103#book-online', { waitUntil: 'networkidle' });
  await page.locator('[data-install-gate]').waitFor({ state: 'attached' });
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  const handoff = page.locator('[data-website-treatment-handoff]');
  await expect(handoff).toContainText('Signature Pedicure');
  await expect(handoff).toContainText('Sign in if asked');
  await expect(handoff).toContainText('Have a treatment code?');
  await expect(handoff).toContainText('Continue treatment');
  await expect(handoff).toContainText('New to My Shiloh? Keep this code');
  await handoff.getByRole('button', { name: 'Copy treatment code' }).click();
  await expect(page.locator('[data-copy-treatment-status]')).toContainText(copyFails ? 'Copy or note code 103 manually' : 'Code copied.');
  if (!copyFails) expect(await page.evaluate(() => window.copiedTreatmentCode)).toBe('103');
  await expect(page.locator('.website-treatment-code')).toContainText('103');
  await expect(page.locator('[data-app-frame]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('[data-install-gate]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: info.outputPath(`handoff-copy-${copyFails ? 'manual' : 'success'}.png`), fullPage: true });
  await page.getByRole('button', { name: 'New here? Show install steps' }).click();
  await expect(page.locator('[data-install-sheet]')).toBeVisible();
});

test('public arrival details and treatment fallback remain readable without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route('**/*', route => route.abort());
  await page.route('https://synthetic.shiloh.test/no-script-contact', route => route.fulfill({ contentType: 'text/html', body: renderContact() }));
  await page.goto('https://synthetic.shiloh.test/no-script-contact');
  await expect(page.locator('.clinic-opening-hours')).toContainText('08:00–17:00');
  await expect(page.locator('.contact-visit')).toContainText('no steps');
  await page.route('https://synthetic.shiloh.test/no-script-app', route => route.fulfill({ contentType: 'text/html', body: renderMyShilohPage({ catalogue: [{ id: 103, name: 'Synthetic treatment', category: 'Massage', price: '250', duration: '30 min' }], selectedServiceId: '103' }) }));
  await page.goto('https://synthetic.shiloh.test/no-script-app');
  await expect(page.locator('noscript section')).toContainText('Treatment code: 103');
  await expect(page.locator('noscript section')).toContainText('Enable JavaScript');
  await expect(page.locator('noscript section')).toContainText('Have a treatment code?');
  await expect(page.locator('noscript a')).toBeVisible();
  await context.close();
});
