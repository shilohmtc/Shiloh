const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const ux = require('../src/presentation/staffDetailSigninUx');
const passkeyUx = require('../src/presentation/staffPasskeyUx');
for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`staff details, retry, optional passkey and successful entry on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=staff-detail-sign-in--sign-in&viewMode=story', {
      waitUntil: 'networkidle',
    });
    await page.addScriptTag({ content: ux.signinScript() });
    const form = page.locator('[data-staff-detail-form]');
    await expect(page.getByRole('button', { name: 'Use a saved passkey' })).toBeVisible();
    await form.getByLabel('Name', { exact: true }).fill('Synthetic');
    await form.getByLabel('Surname', { exact: true }).fill('Example');
    await form.getByLabel('Date of birth', { exact: true }).fill('01012000');
    await form.getByLabel('Mobile number').fill('0820000001');
    await page.screenshot({
      path: testInfo.outputPath(`staff-entry-${viewport.name}.png`),
      fullPage: true,
    });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let count = 0;
    await page.route('**/calendar/staff-auth/details/sign-in', async (route) => {
      count++;
      expect(route.request().postDataJSON()).toEqual({
        firstName: 'Synthetic',
        surname: 'Example',
        dateOfBirth: '2000-01-01',
        mobile: '0820000001',
      });
      await pending;
      await route.fulfill({ status: 401, json: { error: 'Invalid' } });
    });
    await form.getByRole('button', { name: 'Open Workspace' }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect.poll(() => count).toBe(1);
    await expect(form.getByRole('button', { name: 'Open Workspace' })).toBeDisabled();
    release();
    await expect(form.locator('[data-staff-detail-status]')).toContainText(
      'We could not sign you in',
    );
    await expect(form.getByRole('button', { name: 'Open Workspace' })).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath(`staff-retry-${viewport.name}.png`),
      fullPage: true,
    });
    await page.unroute('**/calendar/staff-auth/details/sign-in');
    await page.route('**/calendar/staff-auth/details/sign-in', (route) =>
      route.fulfill({
        json: { authenticated: true, viewer: { calendarScope: 'business_all_staff' } },
      }),
    );
    await page.route('**/calendar/workspace', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Workspace</h1>' }),
    );
    await form.getByRole('button', { name: 'Open Workspace' }).click();
    await expect(page).toHaveURL(/\/calendar\/workspace$/);
  });
  test(`staff account setup is accessible with recorded mobile on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=staff-detail-sign-in--account-setup&viewMode=story', {
      waitUntil: 'networkidle',
    });
    await expect(page.getByLabel('Mobile number')).toHaveAttribute('readonly', '');
    await expect(page.getByLabel('Mobile number')).toHaveValue('0820000001');
    await expect(page.locator('.lead')).toContainText('Only Reception, Christel and JP');
    await expect(page.locator('.lead')).toContainText('no passkey confirmation is needed');
    await page.addScriptTag({ content: ux.setupScript() });
    await page.route('**/calendar/staff-auth/csrf', (route) =>
      route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }),
    );
    await page.route('**/calendar/staff-auth/details/setup', (route) => {
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      expect(route.request().postDataJSON()).toEqual({
        targetId: '900001',
        expectedRevision: 'a'.repeat(64),
        input: {
          firstName: 'Synthetic',
          surname: 'Example',
          dateOfBirth: '2000-01-01',
          mobile: '0820000001',
        },
      });
      return route.fulfill({ json: { saved: true } });
    });
    await page.getByLabel('Name', { exact: true }).fill('Synthetic');
    await page.getByLabel('Surname', { exact: true }).fill('Example');
    await page.getByRole('button', { name: 'Choose date', exact: true }).click();
    await page.getByLabel('Choose date of birth', { exact: true }).fill('2000-01-01');
    await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue('01/01/2000');
    await page.getByRole('button', { name: 'Save sign-in details' }).click();
    await expect(page.locator('[data-staff-detail-status]')).toHaveText('Sign-in details saved.');
    await expect(page.getByRole('button', { name: 'Save sign-in details' })).toBeDisabled();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`staff-account-setup-${viewport.name}.png`),
      fullPage: true,
    });
  });
  test(`staff DOB rejects invalid dates and keeps typing and choosing in sync on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=staff-detail-sign-in--sign-in&viewMode=story', {
      waitUntil: 'networkidle',
    });
    await page.addScriptTag({ content: ux.signinScript() });
    const dob = page.getByLabel('Date of birth', { exact: true });
    const calendar = page.getByLabel('Choose date of birth', { exact: true });
    await dob.fill('29/02/2000');
    await expect(calendar).toHaveValue('2000-02-29');
    for (const invalid of ['29/02/2001', '31/04/2000', '01/01/1899', '01/01/2999', '']) {
      await dob.fill(invalid);
      await expect(calendar).toHaveValue('');
      expect(await dob.evaluate((input) => input.checkValidity())).toBe(false);
    }
    await page.getByRole('button', { name: 'Choose date', exact: true }).click();
    await expect(calendar).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await calendar.fill('1980-07-23');
    await expect(dob).toHaveValue('23/07/1980');
    await expect(calendar).toBeHidden();
    await dob.fill('5/7/1988');
    await dob.blur();
    await expect(dob).toHaveValue('05/07/1988');
    await expect(calendar).toHaveValue('1988-07-05');
    expect(await dob.evaluate((input) => input.checkValidity())).toBe(true);
  });
  test(`staff access directs enrollment to details without SMS or device setup on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(
      '/iframe.html?id=workspace-staff-sms-device-setup--details-sign-in&viewMode=story',
      { waitUntil: 'networkidle' },
    );
    await expect(
      page.getByRole('link', { name: 'Staff sign-in details', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-staff-sms-setup]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /SMS|Set up|Rename|Remove/ })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`staff-details-access-${viewport.name}.png`),
      fullPage: true,
    });
  });
}

async function optionalKeys(page, mode = 'success') {
  let rows = [
    { id: 900001, label: 'Synthetic phone', current: true, createdAt: '2026-10-13T06:00:00Z' },
  ];
  const calls = [];
  await page.route('**/calendar/staff-auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }),
  );
  await page.route('**/calendar/staff-auth/passkeys', (route) =>
    route.fulfill({ json: { credentials: rows } }),
  );
  await page.route('**/calendar/staff-auth/passkeys/900001/revoke', (route) => {
    expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
    calls.push('remove');
    rows = rows.map((row) => ({ ...row, revokedAt: '2026-10-13T06:01:00Z' }));
    return route.fulfill({ json: { removed: true, signInRequired: mode === 'signed-out' } });
  });
  await page.route('**/calendar/staff-auth/passkeys/registration/options', (route) => {
    calls.push('options');
    expect(route.request().postDataJSON()).toEqual({ mode: 'add' });
    expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
    return route.fulfill({
      json: {
        options: {
          challenge: 'AQID',
          user: { id: 'BAUG', name: 'Synthetic' },
          rp: { id: '127.0.0.1', name: 'Shiloh' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: [],
        },
      },
    });
  });
  await page.route('**/calendar/staff-auth/passkeys/registration/finish', (route) => {
    calls.push('finish');
    expect(route.request().postDataJSON().response.response.transports).toEqual(['internal']);
    if (mode === 'finish-error') return route.fulfill({ status: 401, json: {} });
    rows.push({
      id: 900002,
      label: 'Synthetic new phone',
      current: true,
      createdAt: '2026-10-13T06:02:00Z',
    });
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route('**/calendar/staff-auth/passkeys/reauthentication/**', () => {
    throw Error('Existing passkey confirmation must not be requested');
  });
  await page.goto('/iframe.html?id=staff-optional-passkeys--saved-passkey&viewMode=story', {
    waitUntil: 'networkidle',
  });
  await page.evaluate((cancel) => {
    window.PublicKeyCredential = function () {};
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        async create({ publicKey }) {
          if (
            !(publicKey.challenge instanceof ArrayBuffer) ||
            publicKey.authenticatorSelection.userVerification !== 'required'
          )
            throw Error('Invalid options');
          if (cancel) throw new DOMException('Cancelled', 'NotAllowedError');
          const bytes = new Uint8Array([1, 2, 3]).buffer;
          return {
            id: 'AQID',
            rawId: bytes,
            type: 'public-key',
            response: {
              clientDataJSON: bytes,
              attestationObject: bytes,
              getTransports() {
                return ['internal'];
              },
            },
          };
        },
      },
    });
  }, mode === 'cancel');
  await page.addScriptTag({ content: passkeyUx.manageScript({ optionalPasskeys: true }) });
  await expect(page.getByRole('button', { name: 'Remove passkey', exact: true })).toBeVisible();
  return calls;
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`own optional passkey removal and saving another on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const calls = await optionalKeys(page);
    await expect(page.getByRole('heading', { name: 'My passkeys' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Rename|Replace|another device/ })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    const dialog = page.locator('[data-device-dialog]');
    await expect(dialog).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`optional-key-confirm-${viewport.name}.png`),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await expect(page.locator('[data-passkey-list]')).toContainText('No saved passkeys');
    await expect(page.getByRole('button', { name: 'Save passkey', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Save passkey', exact: true }).click();
    await expect(page.locator('[data-passkey-status]')).toHaveText('Passkey saved.');
    await expect(page.locator('[data-passkey-list]')).toContainText('Synthetic new phone');
    expect(calls).toEqual(['remove', 'options', 'finish']);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`optional-key-saved-${viewport.name}.png`),
      fullPage: true,
    });
  });
  for (const mode of ['cancel', 'finish-error']) {
    test(`optional passkey ${mode} remains retryable on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const calls = await optionalKeys(page, mode);
      await page.getByRole('button', { name: 'Save passkey', exact: true }).click();
      await expect(page.locator('[data-passkey-status]')).toContainText(
        mode === 'cancel' ? 'cancelled' : 'could not be added',
      );
      await expect(page.getByRole('button', { name: 'Save passkey', exact: true })).toBeEnabled();
      await expect(page.locator('[data-passkey-list] .credential')).toHaveCount(1);
      expect(calls).toEqual(mode === 'cancel' ? ['options'] : ['options', 'finish']);
    });
  }
  test(`removing from a passkey session offers staff-details entry on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await optionalKeys(page, 'signed-out');
    await page.getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await page
      .locator('[data-device-dialog]')
      .getByRole('button', { name: 'Remove passkey', exact: true })
      .click();
    await expect(page.locator('[data-passkey-status]')).toContainText(
      'Sign in with your staff details',
    );
    await expect(page.getByRole('link', { name: 'Sign in with staff details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save passkey', exact: true })).toBeDisabled();
  });
}
