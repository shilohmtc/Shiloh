// Production presentation; all sessions and responses below are synthetic.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { authInvitationPage, authInvitationScript } = require('../src/presentation/authInvitations');
const BASE = '/calendar/staff-auth/whatsapp';

async function readable(page, selector) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
}
for (const width of [320, 390, 1440]) {
  test(`Workspace account finish and Staff alignment at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/calendar/pwa/icon-192.png*', r => r.fulfill({ path: require('node:path').resolve('public/assets/pwa/shiloh-pwa-192.png') }));
    await page.goto('/iframe.html?id=workspace-staff-sms-device-setup--details-sign-in&viewMode=story', { waitUntil: 'networkidle' });
    const back = page.locator('.topbar > a');
    await expect(back).toHaveAttribute('href', '/calendar/team');
    const link = await back.boundingBox(), heading = await page.locator('.topbar h1').boundingBox(), panel = await page.locator('.workspace-main main > .panel').first().boundingBox();
    expect(link.height).toBeGreaterThanOrEqual(44);
    if (width <= 700) {
      expect(Math.abs(link.x - panel.x)).toBeLessThan(1);
      expect(link.width).toBeLessThan(140);
      expect(link.y).toBeGreaterThan(heading.y + heading.height);
    }
    await back.focus(); await expect(back).toBeFocused();
    await readable(page, '.workspace-main');
    await page.screenshot({ path: info.outputPath(`staff-return-${width}.png`), fullPage: true });
    if (width <= 700) await page.locator('[data-workspace-drawer-toggle]').evaluate(b => b.click());
    // Storybook does not execute the production navigation script.
    await page.locator('.workspace-nav').evaluate(n => n.classList.add('open'));
    const refresh = page.getByRole('button', { name: 'Refresh Workspace', exact: true });
    await refresh.scrollIntoViewIfNeeded();
    await expect(refresh).toBeVisible();
    await expect(refresh).toContainText('Refresh Workspace');
    await expect(refresh.locator('[data-app-version]')).toHaveText('Version 2.1.0');
    await expect(page.locator('[data-app-version]')).toBeVisible();
    await expect(page.locator('[data-app-version]')).toHaveText('Version 2.1.0');
    await readable(page, '.workspace-nav');
    await page.screenshot({ path: info.outputPath(`account-menu-${width}.png`) });
    for (const state of ['opening-workspace', 'optional-invitations']) {
      await page.goto(`/iframe.html?id=workspace-whatsapp-authentication-draft--${state}&viewMode=story`, { waitUntil: 'networkidle' });
      await expect(page.locator('#continue'))[state === 'opening-workspace' ? 'toBeHidden' : 'toBeVisible']();
      await readable(page, 'main');
      await page.screenshot({ path: info.outputPath(`${state}-${width}.png`), fullPage: true });
    }
  });
}

async function welcome(page, result, { fail = false, delayed = false } = {}) {
  await page.route('**/calendar/staff-auth/csrf', r => r.fulfill({ json: { csrfToken: 'synthetic' } }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**${BASE}/invitations/visit`, async r => {
    if (delayed) await gate;
    await r.fulfill({ status: fail ? 503 : 200, json: result });
  });
  await page.route(`**${BASE}/invitations.js`, r => r.fulfill({ contentType: 'application/javascript', body: authInvitationScript({ audience: 'staff', base: BASE }) }));
  await page.route(`**${BASE}/welcome`, r => r.fulfill({ contentType: 'text/html', body: authInvitationPage({ audience: 'staff', base: BASE }) }));
  await page.route('**/calendar/workspace', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><title>Workspace</title><main><h1>Workspace</h1></main></html>' }));
  await page.goto(BASE + '/welcome');
  return release;
}

test('repeat sign-in continues automatically without a flashing dismissal', async ({ page }) => {
  const release = await welcome(page, { show: false }, { delayed: true });
  await expect(page.locator('#continue')).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Opening Workspace…');
  release();
  await expect(page).toHaveURL(/\/calendar\/workspace$/);
});
test('real invitations remain optional and continuation needs no credential or notification prompt', async ({ page }) => {
  await welcome(page, { show: true, passkey: true });
  await expect(page.locator('#passkey-invite')).toBeVisible();
  await expect(page.locator('#notification-invite')).toBeVisible();
  await expect(page.locator('#continue')).toHaveText('Continue to Workspace');
  await page.locator('#continue').click();
  await expect(page).toHaveURL(/\/calendar\/workspace$/);
});
test('failed preference check exposes continuation', async ({ page }) => {
  await welcome(page, {}, { fail: true });
  await expect(page.locator('#continue')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('in the app');
  await page.locator('#continue').click();
  await expect(page).toHaveURL(/\/calendar\/workspace$/);
});
test('stalled preference check exposes continuation after eight seconds', async ({ page }) => {
  await page.clock.install();
  const release = await welcome(page, { show: false }, { delayed: true });
  await expect(page.locator('#continue')).toBeHidden();
  await page.clock.fastForward(8001);
  await expect(page.locator('#continue')).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/calendar\/workspace$/);
});
test('without JavaScript the owner can still open Workspace', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await welcome(page, {});
  await expect(page.getByRole('link', { name: 'Open Workspace', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open Workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/workspace$/);
  await context.close();
});
