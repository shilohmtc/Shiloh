// All identities, push subscriptions and native credential responses are synthetic.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function openClient(page, options = {}) {
  const config = { permission: 'default', subscription: false, keys: false, supported: true,
    standalone: true, clientId: '9012', ...options };
  const writes = [];
  await page.route('**/my-shiloh/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (/\.(?:js|css|png|woff2)$/.test(path)) return route.continue();
    if (route.request().method() !== 'GET') writes.push(path);
    let body = {};
    if (path.endsWith('/profile')) body = { profile: { revision: 'a'.repeat(64), name: 'Synthetic Client',
      dateOfBirth: '2000-01-01', gender: 'prefer_not_to_say', registrationComplete: true } };
    if (path.endsWith('/devices')) body = { devices: config.keys ? [{ id: 42, label: 'Synthetic key' }] : [] };
    if (path.endsWith('/push/config')) {
      if (config.networkFailure) return route.abort();
      body = { configured: true, publicKey: 'c3ludGhldGlj' };
    }
    if (path.endsWith('/csrf')) body = { csrfToken: 'synthetic-csrf' };
    if (path.endsWith('/subscribe')) {
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      body = { enabled: true };
    }
    return route.fulfill({ json: body });
  });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--crm-optional-invitations&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-client-setup]')).toHaveCount(1);
  const surface = await page.locator('#storybook-root').innerHTML();
  await page.setContent(surface);
  await page.evaluate(() => { window.location.hash = ''; });
  await page.evaluate(config => {
    document.querySelector('[data-app-frame]').dataset.notificationClientId = config.clientId;
    Object.defineProperty(navigator, 'standalone', { value: config.standalone, configurable: true });
    let permission = config.permission, subscribed = config.subscription;
    window.syntheticInvitations = { permissions: 0, subscriptions: 0, credentials: 0 };
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      get permission() { return permission; },
      requestPermission: async () => { window.syntheticInvitations.permissions++; return permission = config.tapPermission || 'granted'; },
    } });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: config.supported ? function () {} : undefined });
    if (!config.supported) delete window.PushManager;
    if (config.passkeysUnsupported) Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
    navigator.credentials.create = async () => { window.syntheticInvitations.credentials++; throw new DOMException('Synthetic cancellation', 'NotAllowedError'); };
    const subscription = { endpoint: 'https://push.example.test/synthetic', toJSON: () => ({ endpoint: 'https://push.example.test/synthetic', keys: { p256dh: 'synthetic', auth: 'synthetic' } }), unsubscribe: async () => { subscribed = false; return true; } };
    const registration = { waiting: null, addEventListener() {}, update: async () => {},
      pushManager: { getSubscription: async () => subscribed ? subscription : null,
        subscribe: async () => { window.syntheticInvitations.subscriptions++; subscribed = true; return subscription; } } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      ready: Promise.resolve(registration), controller: null, register: async () => registration, addEventListener() {},
    } });
  }, config);
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  await page.evaluate(() => window.dispatchEvent(new Event('load')));
  await expect(page.locator('[data-push-toggle]')).not.toHaveText('Checking notifications…');
  return writes;
}

async function capture(page, testInfo, name) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('[data-app-frame]').evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath(name + '.png'), fullPage: true, animations: 'disabled' });
  const axe = await new AxeBuilder({ page }).include('[data-view="home"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`CRM and registered client optional invitations, persistent choices and account isolation on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes = await openClient(page);
    const setup = page.locator('[data-client-setup]');
    await expect(setup).toHaveAttribute('data-step', 'notifications');
    await expect(setup).toContainText('Get updates and reminders about your appointments.');
    await expect(setup.getByRole('button', { name: 'Turn on notifications', exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => window.syntheticInvitations)).toEqual({ permissions: 0, subscriptions: 0, credentials: 0 });
    await capture(page, testInfo, `crm-notification-invitation-${viewport.name}`);
    await setup.getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('[data-notification-reminder]')).toBeVisible();
    await expect(setup).toHaveAttribute('data-step', 'passkey');
    await expect(setup.getByRole('button', { name: 'Save a passkey', exact: true })).toBeVisible();
    await capture(page, testInfo, `separate-passkey-and-small-reminder-${viewport.name}`);
    await setup.getByRole('button', { name: 'Not now' }).click();
    await expect(setup).toBeHidden();
    await openClient(page); // Returning to the same client/device retains both choices.
    await expect(setup).toBeHidden();
    await expect(page.locator('[data-notification-reminder]')).toBeVisible();
    await page.getByRole('button', { name: 'Notification settings', exact: true }).click();
    await expect(page.locator('[data-view="profile"]')).toBeVisible();
    await expect(page.locator('[data-passkey-enroll]')).toBeVisible();
    expect(await page.evaluate(() => window.syntheticInvitations.permissions)).toBe(0);
    await page.locator('[data-view-target="home"]').click();
    await page.getByRole('button', { name: 'Dismiss reminder' }).click();
    await openClient(page);
    await expect(setup).toBeHidden();
    await expect(page.locator('[data-notification-reminder]')).toBeHidden();
    await capture(page, testInfo, `returning-dismissed-${viewport.name}`);
    await openClient(page, { clientId: '9013' });
    await expect(setup).toHaveAttribute('data-step', 'notifications');
    await expect(setup).toBeVisible();
  });

  test(`notification opt-in starts only on tap and enabled features hide invitations on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes = await openClient(page, { keys: true });
    expect(writes).toEqual([]);
    await page.locator('[data-client-setup-action]').click();
    await expect(page.locator('[data-client-setup]')).toBeHidden();
    expect(await page.evaluate(() => window.syntheticInvitations)).toEqual({ permissions: 1, subscriptions: 1, credentials: 0 });
    expect(writes).toEqual(['/my-shiloh/auth/csrf', '/my-shiloh/api/push/subscribe']);
    await openClient(page, { keys: true, permission: 'granted', subscription: true });
    await expect(page.locator('[data-client-setup]')).toBeHidden();
    await expect(page.locator('[data-notification-reminder]')).toBeHidden();
    await capture(page, testInfo, `already-enabled-${viewport.name}`);
  });
}

for (const state of [
  { name: 'denied', permission: 'denied', copy: 'Notifications are blocked.' },
  { name: 'unsupported', supported: false, passkeysUnsupported: true, copy: 'This browser does not support notifications.' },
  { name: 'iphone-install', standalone: false, copy: 'Add to Home Screen' },
]) {
  test(`honest ${state.name} guidance never triggers native setup`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openClient(page, state);
    const setup = page.locator('[data-client-setup]');
    // Review the actual browser doorway separately from the Home guidance's synthetic branch.
    if (state.name === 'iphone-install') {
      await expect(page.locator('[data-app-frame]')).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath('iphone-install-doorway.png'), fullPage: true, animations: 'disabled' });
      await page.evaluate(() => { document.querySelector('[data-install-gate]').hidden = true; document.querySelector('[data-app-frame]').hidden = false; });
    }
    await expect(setup).toContainText(state.copy);
    await expect(setup.getByRole('button', { name: 'View notification settings' })).toBeVisible();
    await capture(page, testInfo, state.name);
    await setup.getByRole('button', { name: 'View notification settings' }).click();
    expect(await page.evaluate(() => window.syntheticInvitations)).toEqual({ permissions: 0, subscriptions: 0, credentials: 0 });
    if (state.passkeysUnsupported) {
      await expect(page.locator('[data-passkey-enroll]')).toBeHidden();
      await expect(page.locator('[data-passkey-support-guidance]')).toBeVisible();
    }
  });
}

for (const state of [
  { name: 'granted without subscription', permission: 'granted' },
  { name: 'default permission with stale subscription', subscription: true },
]) {
  test(`${state.name} still offers deliberate notification setup`, async ({ page }) => {
    const writes = await openClient(page, state);
    await expect(page.locator('[data-client-setup]')).toHaveAttribute('data-step', 'notifications');
    await expect(page.locator('[data-client-setup-action]')).toHaveText('Turn on notifications');
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => window.syntheticInvitations)).toEqual({ permissions: 0, subscriptions: 0, credentials: 0 });
  });
}

test('declined permission and passkey cancellation leave normal use available', async ({ page }) => {
  const writes = await openClient(page, { tapPermission: 'denied' });
  await page.locator('[data-client-setup-action]').click();
  await expect(page.locator('[data-client-setup-status]')).toContainText('Notifications are blocked.');
  expect(writes).toEqual([]);
  await page.locator('[data-client-setup-later]').click();
  await expect(page.locator('[data-client-setup]')).toHaveAttribute('data-step', 'passkey');
  await page.route('**/my-shiloh/auth/passkeys/registration/options', route => route.fulfill({ json: { options: {
    challenge: 'c3ludGhldGlj', user: { id: 'c3ludGhldGlj', name: 'Synthetic' },
  } } }));
  await page.locator('[data-client-setup-action]').click();
  await expect(page.locator('[data-client-setup-status]')).toContainText('cancelled');
  expect(await page.evaluate(() => window.syntheticInvitations.credentials)).toBe(1);
  await expect(page.locator('[data-view="home"] a[href="/my-shiloh/book"]').first()).toBeVisible();
});

test('unavailable notification check does not invite permission or block booking', async ({ page }) => {
  const writes = await openClient(page, { networkFailure: true, keys: true });
  await expect(page.locator('[data-push-status]')).toHaveText('Notifications could not be checked right now.');
  await expect(page.locator('[data-client-setup]')).toBeHidden();
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => window.syntheticInvitations)).toEqual({ permissions: 0, subscriptions: 0, credentials: 0 });
  await expect(page.locator('[data-view="home"] a[href="/my-shiloh/book"]').first()).toBeVisible();
});

test('device preferences unavailable in storage still allow temporary dismissal', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Disabled', 'SecurityError'); }; });
  await openClient(page);
  await page.locator('[data-client-setup-later]').click();
  await expect(page.locator('[data-notification-reminder]')).toBeVisible();
  await page.locator('[data-client-setup-later]').click();
  await expect(page.locator('[data-client-setup]')).toBeHidden();
  await page.locator('[data-notification-reminder-dismiss]').click();
  await expect(page.locator('[data-notification-reminder]')).toBeHidden();
});


test('an existing key hides the optional invitation but Profile can add a key in another password manager', async ({ page }) => {
  await openClient(page, {keys:true,permission:'granted',subscription:true});
  await expect(page.locator('[data-client-setup]')).toBeHidden();
  await page.getByRole('link', {name:'Profile',exact:true}).click();
  const save=page.locator('[data-passkey-enroll]');
  await expect(save).toBeVisible();await expect(save).toHaveText('Save another passkey');
  expect((await page.evaluate(()=>window.syntheticInvitations)).credentials).toBe(0);
  await page.route('**/my-shiloh/auth/passkeys/registration/options', route=>route.fulfill({json:{options:{
    challenge:'A'.repeat(43),user:{id:'B'.repeat(43)},excludeCredentials:[]
  }}}));
  await save.click();
  await expect(page.locator('[data-passkey-enroll-status]')).toContainText('cancelled');
  expect((await page.evaluate(()=>window.syntheticInvitations)).credentials).toBe(1);
  await expect(save).toBeEnabled();
});
