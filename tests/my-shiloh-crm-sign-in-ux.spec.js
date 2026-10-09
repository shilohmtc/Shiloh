const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
async function stable(page, testInfo, name, anchor) {
  await expect(anchor).toBeVisible();
  await anchor.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      anchor.evaluate((element) => {
        for (let node = element; node; node = node.parentElement)
          if (Number(getComputedStyle(node).opacity) < 0.99) return false;
        return true;
      }),
    )
    .toBe(true);
  if (!name.includes('generic-error')) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: !name.includes('generic-error'),
    animations: 'disabled',
  });
}
async function start(page, story = 'sign-in') {
  await page.goto(`/iframe.html?id=client-crm-detail-sign-in--${story}&viewMode=story`, {
    waitUntil: 'networkidle',
  });
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }),
  );
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
}
for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`CRM forms, mandatory registration, generic retry and interrupted submission on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const submissions = [];
    let release;
    let pending;
    await page.route('**/my-shiloh/auth/crm/*', async (route) => {
      submissions.push({
        path: new URL(route.request().url()).pathname,
        payload: route.request().postDataJSON(),
      });
      if (pending) await pending;
      await route.fulfill({
        status: 401,
        json: {
          error:
            'We could not continue with these details. Check them and try again, or contact Reception.',
        },
      });
    });
    await start(page);
    const home = page.locator('[data-view="home"]');
    const form = home.locator('[data-client-crm-form]');
    await expect(home.getByRole('button', { name: 'Use a saved passkey' })).toBeVisible();
    await expect(home.locator('[data-client-sms-start]')).toHaveCount(0);
    const dateBounds = await form.getByLabel('Date of birth').evaluate(input => ({right: input.getBoundingClientRect().right, width: input.getBoundingClientRect().width, formWidth: input.closest('form').getBoundingClientRect().width}));
    expect(dateBounds.right).toBeLessThanOrEqual(viewport.width);
    expect(dateBounds.width).toBeGreaterThan(dateBounds.formWidth * 0.8);
    await stable(
      page,
      testInfo,
      `crm-entry-${viewport.name}.png`,
      form.getByRole('button', { name: 'Open My Shiloh', exact: true }),
    );
    await form.getByLabel('First name', { exact: true }).fill('Synthetic');
    await form.getByLabel('Surname', { exact: true }).fill('Example');
    await form.getByLabel('Date of birth', { exact: true }).fill('2000-01-01');
    await form.getByLabel('Mobile number', { exact: true }).fill('0820000001');
    pending = new Promise((resolve) => {
      release = resolve;
    });
    await form.getByRole('button', { name: 'Open My Shiloh', exact: true }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect.poll(() => submissions.length).toBe(1);
    await expect(form.getByRole('button', { name: 'New to Shiloh? Register' })).toBeDisabled();
    release();
    pending = null;
    await expect(form.locator('[data-crm-status]')).toContainText('We could not continue');
    expect(submissions[0].payload).toEqual({
      firstName: 'Synthetic',
      surname: 'Example',
      dateOfBirth: '2000-01-01',
      mobile: '0820000001',
    });
    await stable(
      page,
      testInfo,
      `crm-generic-error-${viewport.name}.png`,
      form.locator('[data-crm-status]'),
    );
    await form.getByRole('button', { name: 'New to Shiloh? Register' }).click();
    await expect(form.getByLabel('Gender', { exact: true })).toBeVisible();
    await form.getByRole('button', { name: 'Register and open My Shiloh' }).click();
    expect(submissions).toHaveLength(1);
    await form.getByLabel('Gender', { exact: true }).selectOption('prefer_not_to_say');
    await stable(
      page,
      testInfo,
      `crm-registration-${viewport.name}.png`,
      form.getByRole('button', { name: 'Register and open My Shiloh' }),
    );
    await form.getByRole('button', { name: 'Register and open My Shiloh' }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1].payload.gender).toBe('prefer_not_to_say');
    await form.getByRole('button', { name: 'Already a client? Sign in' }).click();
    await expect(form.getByLabel('Gender', { exact: true })).toBeHidden();
    const axe = await new AxeBuilder({ page })
      .include('[data-view="home"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    // Reload an interrupted form starts cleanly, with no persisted private input or claimed authentication.
    await start(page);
    await expect(page.locator('[data-view="home"] input[name="firstName"]')).toHaveValue('');
  });
  test(`Shiloh profile allows remembered account changes without detail re-entry and keeps ordinary logout on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/my-shiloh/api/profile', (route) =>
      route.fulfill({
        json: {
          profile: {
            name: 'Synthetic Example',
            dateOfBirth: '2000-01-01',
            gender: 'prefer_not_to_say',
            registrationComplete: true,
            mobile: '0•• ••• 0001',
            revision: 'a'.repeat(64),
          },
        },
      }),
    );
    await page.route('**/my-shiloh/auth/passkeys/devices', (route) =>
      route.fulfill({ json: { devices: [] } }),
    );
    await page.route('**/my-shiloh/auth/session', (route) =>
      route.fulfill({ json: { authenticated: true, client: { firstName: 'Synthetic' } } }),
    );
    await page.route('**/my-shiloh/auth/csrf', (route) =>
      route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }),
    );
    await page.route('**/my-shiloh/auth/sessions/revoke-others', (route) =>
      route.fulfill({
        status: 200,
        json: {revoked:true},
      }),
    );
    const reentries = [];
    await page.route('**/my-shiloh/auth/crm/reauthenticate', route => {
      reentries.push({body: route.request().postDataJSON(), csrf: route.request().headers()['x-shiloh-csrf-token']});
      return route.fulfill({json: {reauthenticated: true}});
    });
    await start(page, 'lower-assurance-profile');
    await page.getByRole('link', { name: 'Profile', exact: true }).click();
    const profile = page.locator('[data-view="profile"]');
    await expect(profile).toContainText('Signed in with your Shiloh details');
    await expect(profile.locator('[data-client-sms-start], [data-passkey-recovery-create]')).toHaveCount(0);
    await expect(profile.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(profile.locator('[data-client-profile-form] input[name="name"]')).toBeEnabled();
    await expect(profile).toContainText('A passkey is optional');
    await expect(profile.getByText('Confirm details for account changes',{exact:true})).toHaveCount(0);
    await expect(profile).not.toContainText('Confirm your Shiloh details');
    await expect(profile.getByLabel('New mobile number')).toBeEnabled();
    await expect(profile.locator('[data-mode="reauthenticate"]')).toHaveCount(0);
    await page.evaluate(()=>{window.ShilohConfirm=async()=>true;});
    await profile.getByRole('button',{name:'Sign out other sessions',exact:true}).click();
    await expect(profile.locator('[data-sign-out-others-status]')).toContainText('Other sessions are signed out');
    expect(reentries).toEqual([]);
    await stable(page,testInfo,`crm-protected-settings-${viewport.name}.png`,profile.getByRole('heading',{name:'Make next time easier.'}));
    const axe = await new AxeBuilder({ page })
      .include('[data-view="profile"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  });
}
