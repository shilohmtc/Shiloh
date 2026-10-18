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
  await page.route('**/app-update-fixture', r => {
    const html = appUpdatesHtml(app, options);
    return r.fulfill({ body: options.withoutHeading ? html.replace('class="topbar"', 'class="synthetic-page-heading"') : html, contentType: 'text/html' });
  });
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
    if (app === 'client') {
      await page.locator('[data-app-version]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-app-version]')).toBeVisible();
      await expect(page.locator('[data-app-version]')).toContainText('Version 2.1.0-local');
    } else {
      await expect(page.locator('[data-app-version]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Refresh Workspace', exact: true })).toBeVisible();
    }
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
test('desktop Workspace checks releases without registering a worker or exposing install UI', async ({ page }) => {
  let version = '2.1.0-local', checks = 0;
  await page.route('**/calendar/pwa/version', r => { checks++; return r.fulfill({ json: { version } }); });
  await page.route('**/desktop-update-fixture', r => r.fulfill({ contentType: 'text/html', body: appUpdatesHtml('workspace').replace("Object.defineProperty(navigator,'standalone',{configurable:true,value:true})", "Object.defineProperty(navigator,'standalone',{configurable:true,value:false})").replace('container.register=async()=>registration', "container.register=async()=>{throw Error('Desktop must not register a service worker');}") }));
  await page.clock.install();
  await page.goto('/desktop-update-fixture', { waitUntil: 'networkidle' });
  await expect.poll(() => checks).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-workspace-app-update]')).toBeHidden();
  version = '2.1.0-nextbuild'; await page.clock.fastForward(60001);
  await expect(page.locator('[data-workspace-app-update]')).toBeVisible();
  expect(checks).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-shiloh-browser-install],[data-shiloh-ios-install]')).toHaveCount(0);
  await page.locator('[data-workspace-update-action]').click();
  await expect(page.locator('[data-shiloh-confirm]')).toBeVisible();
  await page.getByRole('button', { name: 'Keep working' }).click();
  await expect(page.locator('[data-workspace-app-update]')).toBeVisible();
});
test('Workspace sign-in can show its own update confirmation without navigation code', async ({ page }) => {
  const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');
  const { updateHarness } = require('../stories/fixtures/appUpdates');
  await page.route('**/signin-update-fixture', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><title>Synthetic sign-in</title><body><h1>Sign in</h1><script>${updateHarness()}${workspacePwaClientScript()}</script></body></html>` }));
  await page.goto('/signin-update-fixture', { waitUntil: 'networkidle' });
  await page.locator('[data-workspace-update-action]').click();
  await expect(page.locator('[data-shiloh-confirm]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
});

for (const app of ['workspace', 'client']) for (const width of [320, 390, 700, 1440]) {
  test(`${app} pending update fits its page and keeps navigation clear at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, app);
    const banner = page.locator(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]');
    const action = banner.getByRole('button', { name: 'Update now', exact: true });
    await expect(banner).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const box = await banner.boundingBox(), button = await action.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
    expect(button.height).toBeGreaterThanOrEqual(48);
    expect(button.x).toBeGreaterThanOrEqual(box.x);
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
    expect(box.height).toBeLessThanOrEqual(app === 'workspace' ? 120 : 140);
    if (width >= 390) {
      const copy = await banner.locator(':scope > div').boundingBox();
      expect(button.x).toBeGreaterThanOrEqual(copy.x + copy.width + 8);
    }
    if (app === 'workspace') {
      const heading = await page.locator('.topbar').boundingBox();
      const grid = await page.locator('.dashboard-grid').boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      expect(Math.abs(box.x - grid.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - grid.width)).toBeLessThanOrEqual(1);
      expect(grid.y - (box.y + box.height)).toBeGreaterThanOrEqual(0);
      expect(grid.y - (box.y + box.height)).toBeLessThanOrEqual(24);
      if (width <= 700) {
        const menu = page.locator('[data-workspace-drawer-toggle]');
        const menuBox = await menu.boundingBox();
        expect((await page.locator('h1').boundingBox()).y).toBeLessThan(64);
        expect(box.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height + 8);
        await page.evaluate(() => scrollTo(0, 300));
        const sticky = await banner.boundingBox();
        expect(sticky.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height + 8);
        await menu.click();
        await expect(page.locator('[data-workspace-navigation-drawer]')).toHaveClass(/open/);
        await page.goBack();
        await expect(page.locator('[data-workspace-navigation-drawer]')).not.toHaveClass(/open/);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: info.outputPath(`${app}-${width}-pending-layout.png`), animations: 'disabled' });
  });
}

for (const app of ['workspace', 'client']) test(`${app} update confirmation keeps drafts, native cancel, focus and repeated clicks safe`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await open(page, app);
  await page.evaluate(() => {
    const draft = document.createElement('input'); draft.id = 'update-layout-draft'; draft.value = 'Synthetic unfinished work';
    draft.setAttribute('aria-label', 'Synthetic unfinished work'); document.body.append(draft);
  });
  const banner = page.locator(app === 'workspace' ? '[data-workspace-app-update]' : '[data-app-update]');
  const button = banner.locator(app === 'workspace' ? '[data-workspace-update-action]' : '[data-app-update-action]');
  await expect(button).toHaveText('Update now');
  await button.focus();
  await button.evaluate(e => { e.click(); e.click(); });
  const dialog = page.locator('[data-shiloh-confirm]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep working' })).toBeFocused();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(382); expect(bounds.y + bounds.height).toBeLessThanOrEqual(632);
  await expect(dialog).toContainText('Save any unfinished changes');
  for (const control of await dialog.getByRole('button').all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(48);
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Update now', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Keep working' })).toBeFocused();
  await page.screenshot({ path: info.outputPath(`${app}-confirmation-layout.png`) });
  // Native close requests use the same cancel path as a platform Back dismissal.
  await dialog.evaluate(e => e.requestClose());
  await expect(dialog).toBeHidden(); await expect(button).toBeFocused();
  await expect(page.locator('#update-layout-draft')).toHaveValue('Synthetic unfinished work');
  expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([]);
  await button.click(); await dialog.getByRole('button', { name: 'Keep working' }).click();
  await expect(dialog).toBeHidden(); await expect(button).toBeFocused();
  await button.click(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await button.click(); await dialog.getByRole('button', { name: 'Update now', exact: true }).evaluate(e => { e.click(); e.click(); });
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Updating…');
  expect(await page.evaluate(() => syntheticUpdateMessages)).toEqual([{ type: app === 'workspace' ? 'SHILOH_ACTIVATE_UPDATE' : 'SKIP_WAITING' }]);
  await expect(page.locator('#update-layout-draft')).toHaveValue('Synthetic unfinished work');
});

test('Workspace update fallback reserves the menu row without covering an unfamiliar page heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'workspace', { withoutHeading: true });
  await expect(page.locator('.topbar')).toHaveCount(0);
  const banner = page.locator('[data-workspace-app-update]');
  await expect(banner).toBeVisible();
  const box = await banner.boundingBox(), heading = await page.locator('h1').boundingBox();
  const menu = await page.locator('[data-workspace-drawer-toggle]').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(menu.y + menu.height + 8);
  expect(heading.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
