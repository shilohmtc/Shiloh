const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const { workspaceInstallPage, workspacePwaClientScript, workspacePwaManifest } = require('../src/presentation/workspacePwa');
const { APP_ORIGIN } = require('../src/config/publicOrigins');
const installUrl = `${APP_ORIGIN}/calendar/pwa/install`;

for (const device of [
  { name: 'desktop', width: 1440 },
  { name: 'android', width: 390, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' },
  { name: 'iphone', width: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  { name: 'iphone-chrome', width: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/131.0.0.0 Mobile/15E148 Safari/604.1' },
  { name: 'iphone-other', width: 320, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/130.0 Mobile/15E148 Safari/604.1' },
]) {
  test(`website Staff Workspace menu reaches existing install page on ${device.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: device.width, height: 900 }, ...(device.userAgent ? { userAgent: device.userAgent } : {}) });
    const page = await context.newPage();
    // This synthetic destination exercises existing markup/client code without registering an app or authenticating.
    await context.addInitScript(() => { delete Navigator.prototype.serviceWorker; });
    const requests = [];
    await context.route(`${APP_ORIGIN}/**`, async route => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      requests.push({ method: req.method(), pathname });
      if (pathname === '/calendar/pwa/install') return route.fulfill({ contentType: 'text/html', body: workspaceInstallPage() });
      if (pathname === '/calendar/pwa/client.js') return route.fulfill({ contentType: 'application/javascript', body: workspacePwaClientScript() });
      if (pathname === '/calendar/pwa/manifest.webmanifest') return route.fulfill({ contentType: 'application/manifest+json', body: JSON.stringify(workspacePwaManifest()) });
      if (pathname.startsWith('/calendar/pwa/icon-')) {
        const icons = { 'icon-192.png': 'shiloh-pwa-192.png', 'icon-512.png': 'shiloh-pwa-512.png', 'icon-maskable-512.png': 'shiloh-pwa-maskable-512.png' };
        return route.fulfill({ path: path.join(process.cwd(), 'public/assets/pwa', icons[path.basename(pathname)]) });
      }
      if (req.method() === 'GET' && pathname === '/calendar/pwa/version') return route.fulfill({ json: { version: require('../src/presentation/appRelease').appRelease() } });
      throw new Error(`Unexpected destination request: ${req.method()} ${pathname}`);
    });
    await page.goto(`${testInfo.project.use.baseURL}/iframe.html?id=public-website-production-pages--home&viewMode=story`, { waitUntil: 'networkidle' });
    const nav = page.locator(device.width < 761 ? '.mobile-nav-links' : '.site-nav');
    if (device.width < 761) {
      const summary = page.locator('.mobile-nav summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(nav).toBeVisible();
      await summary.click();
      await expect(nav).not.toBeVisible();
      await summary.click();
    }
    const staff = nav.getByRole('link', { name: 'Staff Workspace', exact: true });
    await expect(staff).toBeVisible();
    await expect(staff).toHaveAttribute('href', installUrl);
    await expect(nav.getByRole('link', { name: /^My Shiloh/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Book', exact: true })).toBeVisible();
    if (device.width < 761) expect((await staff.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('.site-header').analyze();
    expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`website-menu-${device.name}.png`) });
    await staff.click();
    await expect(page).toHaveURL(installUrl);
    await expect(page.getByRole('heading', { name: device.name.startsWith('iphone') ? 'Add Shiloh Workspace to your iPhone.' : 'Install Shiloh Workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Already installed? Sign in' })).toHaveAttribute('href', '/calendar/staff');
    await expect(page.locator(device.name.startsWith('iphone') ? '[data-workspace-ios-steps]' : '[data-workspace-android-steps]')).toBeVisible();
    if (device.name.startsWith('iphone')) {
      const steps = page.locator('[data-workspace-ios-steps]');
      await expect(page.locator('[data-workspace-install-doorway]')).toBeHidden();
      await expect(steps.locator('[data-workspace-ios-menu-icon]')).toHaveCount(1);
      await expect(steps).toContainText('This picture is a guide, not a button.');
      await expect(steps).toContainText('Choose Add to Home Screen');
      await expect(steps).toContainText('Then open Shiloh Workspace');
      const choice = steps.getByRole('combobox', { name: 'iPhone browser' });
      await expect(choice).toHaveValue(device.name === 'iphone-chrome' ? 'chrome' : device.name === 'iphone-other' ? '' : 'safari');
      if (device.name === 'iphone-other') {
        await expect(steps.locator('[data-workspace-ios-browser-steps]')).toBeHidden();
        await expect(steps).toContainText('open this page in your chosen browser first');
      }
      await choice.selectOption('chrome');
      await expect(steps.locator('[data-workspace-ios-final-title]')).toHaveText('Check, then tap Add');
      await expect(steps).toContainText('In Chrome, look beside the address bar for Share.');
      await choice.selectOption('safari');
      await expect(steps.locator('[data-workspace-ios-final-title]')).toHaveText('Check, then tap Add');
      await expect(page.getByRole('button', { name: /^Install/ })).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`existing-install-${device.name}.png`) });
    expect(requests.every(r => r.method === 'GET')).toBe(true);
    expect(requests.some(r => r.pathname.includes('staff-auth'))).toBe(false);
    await page.goBack({ waitUntil: 'networkidle' });
    await expect(page.locator('.site-brand')).toBeVisible();
    await context.close();
  });
}

test('website menu stays within compact desktop and small phone widths', async ({ page }, testInfo) => {
  for (const width of [320, 768, 820, 900, 901, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/iframe.html?id=public-website-production-pages--home&viewMode=story', { waitUntil: 'networkidle' });
    const collapsed = await page.locator('.mobile-nav').isVisible();
    if (collapsed) await page.locator('.mobile-nav summary').click();
    const nav = page.locator(collapsed ? '.mobile-nav-links' : '.site-nav');
    await expect(nav.getByRole('link', { name: 'Staff Workspace', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Book', exact: true })).toBeVisible();
    const book = await nav.getByRole('link', { name: 'Book', exact: true }).boundingBox();
    expect(book.x + book.width, `${width}px Book must remain inside the viewport`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px document must not overflow`).toBeLessThanOrEqual(width);
    if (width === 768 || width === 901) await page.screenshot({ path: testInfo.outputPath(`website-menu-${width}.png`) });
  }
});
