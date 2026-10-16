const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { appUpdatesHtml } = require('../stories/fixtures/appUpdates');
const fs = require('node:fs');
const path = require('node:path');
async function open(page, app, options = {}) {
  await page.route('**/calendar/pwa/icon-192.png*', r => r.fulfill({ path: path.resolve('public/assets/pwa/shiloh-pwa-192.png') }));
  await page.route('**/calendar/workspace/nav.js', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/calendar/workspace/navigation', r => r.fulfill({ json: {} }));
  await page.route('**/calendar/staff-auth/session', r => r.fulfill({ json: { viewer: { calendarScope: 'business_all_staff' } } }));
  await page.route('**/calendar/pwa/push/config', r => r.fulfill({ json: { allowed: false } }));
  await page.route('**/my-shiloh/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/app-update-fixture', r => r.fulfill({ body: appUpdatesHtml(app, options), contentType: 'text/html' }));
  await page.goto('/app-update-fixture', { waitUntil: 'networkidle' });
}
for (const app of ['workspace', 'client']) for (const width of [320, 390, 1440]) {
  test(`${app} persistent updates, drafts, offline, failure and consent at ${width}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await open(page, app);
    const banner = page.locator(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]');
    const button = banner.locator(app === 'workspace' ? '[data-workspace-update-action]' : '[data-app-update-action]');
    await page.clock.install();
    await expect(banner).toBeVisible();
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await page.evaluate(() => { const input = document.createElement('input'); input.id = 'synthetic-draft'; input.setAttribute('aria-label', 'Synthetic unfinished draft'); document.body.append(input); });
    await page.locator('#synthetic-draft').fill('Keep my unfinished work');
    await page.evaluate(() => { dispatchEvent(new Event('pageshow')); dispatchEvent(new Event('online')); });
    await expect(banner).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await expect(page.locator('#synthetic-draft')).toHaveValue('Keep my unfinished work');
    expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
    await button.click();
    const dialog = page.locator('[data-shiloh-confirm]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep working' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden(); await expect(button).toBeFocused();
    await expect(page.locator('#synthetic-draft')).toHaveValue('Keep my unfinished work');
    await button.click(); await dialog.getByRole('button', { name: 'Keep working' }).click();
    expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
    await context.setOffline(true); await button.click(); await expect(banner).toContainText('You are offline'); await expect(button).toBeEnabled(); await context.setOffline(false);
    await page.evaluate(() => { window.syntheticUpdateFailure = true; });
    await button.click(); await dialog.getByRole('button', { name: 'Update now' }).click();
    await expect(banner).toContainText('could not start'); await expect(button).toBeEnabled();
    await page.evaluate(() => { window.syntheticUpdateFailure = false; });
    if (width === 320) await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await new AxeBuilder({ page }).include(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`${app}-${width}-update.png`) });
    await button.click(); await dialog.getByRole('button', { name: 'Update now' }).click();
    await expect(button).toHaveText('Updating…'); await expect(button).toBeDisabled();
    expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([{ type: app === 'workspace' ? 'SHILOH_ACTIVATE_UPDATE' : 'SKIP_WAITING' }]);
    await page.clock.fastForward(12001);
    await expect(button).toHaveText('Update now'); await expect(banner).toContainText('did not finish');
    await expect(page.locator('#synthetic-draft')).toHaveValue('Keep my unfinished work');
    if (app === 'workspace' && width <= 700) await page.locator('[data-workspace-drawer-toggle]').click();
    if (app === 'client') await page.locator('[data-view-target="profile"]').last().click();
    await page.locator('[data-app-version]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-app-version]')).toBeVisible();
    await expect(page.locator('[data-app-version]')).toContainText('Version 2.1.0-local');
    await page.screenshot({ path: info.outputPath(`${app}-${width}-version.png`) });
    fs.writeFileSync(info.outputPath(`${app}-${width}.html`), await page.content());
  });
}
for (const app of ['workspace', 'client']) test(`${app} first install is quiet and a later waiting update appears`, async ({ page }) => {
  await open(page, app, { waiting: false });
  const banner = page.locator(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]');
  await expect(banner).toBeHidden();
  await page.evaluate(() => syntheticRevealUpdate()); await expect(banner).toBeVisible();
  expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
});

for (const app of ['workspace', 'client']) test(`${app} real worker waits between deployments and activation preserves open documents`, async ({ context }) => {
  const http = require('node:http');
  const { workspacePwaServiceWorkerScript } = require('../src/presentation/workspacePwa');
  let build = 'aaaaaaa';
  const prefix = app === 'workspace' ? '/calendar/' : '/my-shiloh/';
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === `${prefix}sw.js`) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Service-Worker-Allowed', prefix);
      const source = app === 'workspace' ? workspacePwaServiceWorkerScript().replace(/const APP_RELEASE="[^"]+"/, `const APP_RELEASE="2.1.0-${build}"`) : `self.SHILOH_APP_RELEASE="2.1.0-${build}";\n${fs.readFileSync('public/my-shiloh/sw.js', 'utf8')}`;
      res.end(source);
    } else if (req.url === `${prefix}test`) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Synthetic worker lifecycle</title><label>Unfinished work<input value="Synthetic draft"></label>');
    } else { res.end('synthetic static asset'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const first = await context.newPage(), second = await context.newPage();
  try {
    for (const page of [first, second]) {
      await page.goto(origin + prefix + 'test');
      await page.evaluate(async ({ prefix }) => {
        window.activationCount = 0;
        navigator.serviceWorker.addEventListener('controllerchange', () => { window.activationCount++; });
        await navigator.serviceWorker.register(prefix + 'sw.js', { scope: prefix, updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
      }, { prefix });
      await page.waitForFunction(() => navigator.serviceWorker.controller);
    }
    build = 'bbbbbbb';
    await first.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
    await first.waitForFunction(async () => Boolean((await navigator.serviceWorker.ready).waiting));
    for (const page of [first, second]) await expect(page.getByRole('textbox')).toHaveValue('Synthetic draft');
    const before = await second.evaluate(() => activationCount);
    await first.evaluate(async ({ type }) => { const registration = await navigator.serviceWorker.ready; registration.waiting.postMessage({ type }); }, { type: app === 'workspace' ? 'SHILOH_ACTIVATE_UPDATE' : 'SKIP_WAITING' });
    await second.waitForFunction(count => activationCount > count, before);
    for (const page of [first, second]) await expect(page.getByRole('textbox')).toHaveValue('Synthetic draft');
    expect(await first.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(false);
  } finally { await first.close(); await second.close(); await new Promise(resolve => server.close(resolve)); }
});
for (const app of ['workspace', 'client']) test(`${app} an update accepted in another window waits for this window's consent to reload`, async ({ page }) => {
  await open(page, app);
  const banner = page.locator(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]');
  await expect(banner).toBeVisible();
  await page.evaluate(() => { document.title = 'Unfinished synthetic work'; syntheticRegistration.waiting = null; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
  await expect(page).toHaveTitle('Unfinished synthetic work');
  await banner.getByRole('button', { name: 'Update now' }).click();
  const dialog = page.locator('[data-shiloh-confirm]');
  await dialog.getByRole('button', { name: 'Keep working' }).click();
  await expect(page).toHaveTitle('Unfinished synthetic work');
  await banner.getByRole('button', { name: 'Update now' }).click();
  await Promise.all([page.waitForEvent('domcontentloaded'), dialog.getByRole('button', { name: 'Update now' }).click()]);
  await expect(page).not.toHaveTitle('Unfinished synthetic work');
});
