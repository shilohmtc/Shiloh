// Fabricated auth review fixtures; no real client/provider/credential access.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function captureStable(page, testInfo, name, anchor) {
  await expect(anchor).toBeVisible();
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => anchor.evaluate(element => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < 0.99 || style.visibility !== 'visible') return false;
    }
    return true;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true, animations: 'disabled' });
}

test('passkey guest and profile paths remain usable on phone and desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--passkey-guest&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-view="home"] [data-passkey-sign-in]')).toBeVisible();
    await expect(page.locator('[data-view="home"] [data-client-auth-start]')).toHaveCount(0);
    const guestAxe = await new AxeBuilder({ page }).include('[data-view="home"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(guestAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`client-passkey-guest-${viewport.name}.png`),
      fullPage: true, animations: 'disabled' });

    await page.goto('/iframe.html?id=client-my-shiloh-pwa--passkey-profile&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-view="profile"] [data-passkey-enroll]')).toBeVisible();
    await expect(page.locator('[data-view="profile"] [data-passkey-devices] .passkey-device')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove iPhone passkey' })).toBeVisible();
    await expect(page.locator('[data-view="profile"]')).toContainText('Signed in with a passkey');
    const profileAxe = await new AxeBuilder({ page }).include('[data-view="profile"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(profileAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`client-passkey-profile-${viewport.name}.png`),
      fullPage: true, animations: 'disabled' });
  }
});

test('first sign-in setup leads with a passkey, then offers notifications on phone and desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const [step, story] of [
      ['passkey', 'first-sign-in-passkey-setup'],
      ['notifications', 'first-sign-in-notification-setup'],
    ]) {
      await page.goto(`/iframe.html?id=client-my-shiloh-pwa--${story}&viewMode=story`, { waitUntil: 'networkidle' });
      const setup = page.locator('[data-client-setup]');
      await expect(setup).toBeVisible();
      await expect(setup).toHaveAttribute('data-step', step);
      await expect(setup.locator('[data-client-setup-action]')).toBeVisible();
      if (step === 'notifications') {
        await expect(setup).toContainText('Stay ready for every visit.');
        await expect(setup).toContainText('appointment reminders');
      }
      if (step === 'notifications') await expect(setup.locator('[data-client-setup-later]')).toBeVisible();
      else await expect(setup.locator('[data-client-setup-later]')).toBeVisible();
      const axe = await new AxeBuilder({ page }).include('[data-client-setup]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`client-first-signin-${step}-${viewport.name}.png`),
        fullPage: true, animations: 'disabled' });
    }
  }
});

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`SMS automatic session, repeated and interrupted verification on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const starts = [], finishes = [];
    let release;
    let pending;
    await page.route('**/my-shiloh/auth/sms/start', async route => {
      starts.push(route.request().postDataJSON());
      if (pending) await pending;
      await route.fulfill({ json: { status: 'code_sent' } });
    });
    await page.route('**/my-shiloh/auth/sms/complete', async route => {
      finishes.push(route.request().postDataJSON());
      await route.fulfill({ status: 401, json: { error: 'Synthetic expired code. Request a new code.' } });
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--sms-and-passkey-guest&viewMode=story', { waitUntil: 'networkidle' });
    await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    const home = page.locator('[data-view="home"]');
    await expect(home.locator('[data-keep-signed-in]')).toHaveCount(0);
    await expect(home.getByRole('heading', { name: 'Your Shiloh, all in one place.' })).toBeVisible();
    await captureStable(page, testInfo, `signin-entry-${viewport.name}.png`, home.getByRole('button', { name: 'Sign in with an SMS code' }));
    await home.getByRole('button', { name: 'Sign in with an SMS code' }).click();
    await expect(home.locator('[data-client-sms-choice]')).toBeVisible();
    await home.locator('input[name="name"]').fill('Synthetic Client');
    await home.locator('input[name="mobile"]').fill('0820000001');
    pending = new Promise(resolve => { release = resolve; });
    await home.getByRole('button', { name: 'Send my SMS code' }).evaluate(button => { button.click(); button.click(); });
    await expect(home.getByRole('button', { name: 'Send my SMS code' })).toBeDisabled();
    await expect.poll(() => starts.length).toBe(1);
    release(); pending = null;
    await expect(home.locator('[data-client-sms-complete]')).toBeVisible();
    await home.locator('[data-client-sms-complete] input[name="code"]').fill('123456');
    await home.getByRole('button', { name: 'Open My Shiloh', exact: true }).click();
    await expect(home.locator('[data-auth-status]')).toContainText('Synthetic expired code');
    expect(finishes).toEqual([{ code: '123456' }]);
    await captureStable(page, testInfo, `sms-failure-${viewport.name}.png`, home.locator('[data-auth-status]'));
    await home.getByRole('button', { name: 'Open My Shiloh', exact: true }).click();
    await expect.poll(() => finishes.length).toBe(2);
    expect(finishes[1]).toEqual({ code: '123456' });
    await expect(home.getByRole('button', { name: 'Open My Shiloh', exact: true })).toBeEnabled();
    const axe = await new AxeBuilder({ page }).include('[data-view="home"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await captureStable(page, testInfo, `sms-remembered-${viewport.name}.png`, home.locator('[data-auth-status]'));
    await home.getByRole('button', { name: 'Sign in with an SMS code' }).click();
    await expect(home.locator('[data-client-sms-choice]')).toBeHidden();
    // Reloading neither starts authentication nor reintroduces a session choice.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('[data-view="home"] [data-keep-signed-in]')).toHaveCount(0);
    expect(starts).toHaveLength(1);
  });
}

for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`verified profile confirmation, stale save and optional setup on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const writes = [];
    const profile = { revision: 'a'.repeat(64), name: 'Synthetic Existing Client', dateOfBirth: '2000-01-01',
      gender: null, mobile: '+27 •• ••• 4567', registrationComplete: false };
    await page.route('**/my-shiloh/api/profile', route => route.fulfill({ json: { profile } }));
    await page.route('**/my-shiloh/auth/passkeys/devices', route => route.fulfill({ json: { devices: [] } }));
    await page.route('**/my-shiloh/auth/csrf', route => route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }));
    await page.route('**/my-shiloh/api/profile/update', route => {
      writes.push(route.request().postDataJSON());
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      return route.fulfill({ status: 409, json: { error: 'Your profile changed. Reload before saving.' } });
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--first-sign-in-passkey-setup&viewMode=story', { waitUntil: 'networkidle' });
    await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    const form = page.locator('[data-client-profile-form]');
    await expect(page.locator('[data-view="profile"]')).toBeVisible();
    await expect(form.locator('input[name="name"]')).toHaveValue(profile.name);
    await expect(form.locator('input[name="dateOfBirth"]')).toHaveValue(profile.dateOfBirth);
    await expect(form.locator('select[name="gender"]')).toHaveValue('');
    expect(writes).toEqual([]);
    await form.locator('select[name="gender"]').selectOption('prefer_not_to_say');
    await form.getByRole('button', { name: /Save/ }).click();
    await expect(page.locator('[data-client-profile-status]')).toContainText('Your profile changed');
    expect(writes).toEqual([{ expectedRevision: profile.revision, name: profile.name,
      dateOfBirth: profile.dateOfBirth, gender: 'prefer_not_to_say' }]);
    await expect(form.locator('input[name="dateOfBirth"]')).toHaveValue(profile.dateOfBirth);
    await captureStable(page, testInfo, `profile-confirmation-conflict-${viewport.name}.png`, page.locator('[data-client-profile-status]'));
    await page.locator('[data-view-target="home"]').click();
    const setup = page.locator('[data-client-setup]');
    await expect(setup.getByRole('button', { name: 'Not now' })).toBeVisible();
    await captureStable(page, testInfo, `optional-passkey-not-now-${viewport.name}.png`, setup.getByRole('button', { name: 'Not now' }));
    await setup.getByRole('button', { name: 'Not now' }).click();
    await expect(setup).toBeHidden();
    await page.locator('[data-view-target="profile"]').click();
    await expect(page.locator('[data-passkey-enroll]')).toBeVisible();
    let registrations = 0;
    await page.route('**/my-shiloh/auth/passkeys/registration/options', route => route.fulfill({ json: { options: {
      challenge: 'c3ludGhldGlj', user: { id: 'c3ludGhldGlj', name: 'Synthetic' },
    } } }));
    await page.route('**/my-shiloh/auth/passkeys/registration/finish', route => {
      registrations += 1; return route.fulfill({ json: { registered: true } });
    });
    await page.evaluate(() => { navigator.credentials.create = async () => { throw new DOMException('Cancelled', 'NotAllowedError'); }; });
    await page.locator('[data-passkey-enroll]').click();
    await expect(page.locator('[data-passkey-enroll-status]')).toContainText(/cancelled|not approved/i);
    await expect(page.locator('[data-passkey-enroll]')).toBeEnabled();
    expect(registrations).toBe(0);
    let revocations = 0;
    let requireFresh = true;
    await page.route('**/my-shiloh/auth/sessions/revoke-others', route => {
      revocations += 1;
      expect(route.request().postDataJSON()).toEqual({});
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      return route.fulfill({ status: requireFresh ? 428 : 200, json: requireFresh
        ? { error: 'Sign in again before signing out other sessions.' } : { revoked: true } });
    });
    await page.evaluate(() => { window.ShilohConfirm = async () => false; });
    await page.locator('[data-sign-out-others]').click();
    expect(revocations).toBe(0);
    await page.evaluate(() => { window.ShilohConfirm = async () => true; });
    await page.locator('[data-sign-out-others]').click();
    await expect(page.locator('[data-sign-out-others-status]')).toContainText('Sign in again');
    await captureStable(page, testInfo, `session-revocation-fresh-auth-required-${viewport.name}.png`, page.locator('[data-sign-out-others-status]'));
    requireFresh = false;
    await page.locator('[data-sign-out-others]').click();
    await expect(page.locator('[data-sign-out-others-status]')).toContainText('Other sessions are signed out');
    await expect(page.locator('[data-client-auth-logout]')).toBeVisible();
    await captureStable(page, testInfo, `session-revocation-result-${viewport.name}.png`, page.locator('[data-sign-out-others-status]'));
    expect(revocations).toBe(2);
    expect(writes).toHaveLength(1);
  });
}

test('shared SMS entry stays readable at narrow phone width and enlarged text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--register-entry&viewMode=story', { waitUntil: 'networkidle' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('button', { name: 'Sign in with an SMS code' }).first()).toBeVisible();
  await expect(page.locator('[data-keep-signed-in]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('[data-view="home"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await captureStable(page, testInfo, 'sms-remembered-narrow-enlarged.png', page.locator('[data-view="home"] [data-client-sms-open="register"]'));
});
