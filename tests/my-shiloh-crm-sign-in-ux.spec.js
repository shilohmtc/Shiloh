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
  await expect(page.locator('[data-app-frame]')).toBeVisible();
  // Keep the rendered production surface; isolate it from Storybook's asynchronous rerenders.
  const surface = await page.locator('#storybook-root').innerHTML();
  await page.setContent(surface);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }),
  );
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
}
for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`automatic CRM lookup, missing details, retained values and registration on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const submissions = [];
    let pending;
    let release;
    let reply = { next: 'existing', requiredFields: ['dateOfBirth', 'gender'], missingFields: ['dateOfBirth', 'gender'] };
    let replyStatus = 200;
    await page.route('**/my-shiloh/auth/crm/continue', async route => {
      submissions.push(route.request().postDataJSON());
      if (pending) await pending;
      await route.fulfill({ status: replyStatus, json: reply });
    });
    await start(page);
    const home = page.locator('[data-view="home"]');
    const form = home.locator('[data-client-crm-form]');
    await expect(home.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
    await expect(home.locator('[data-crm-title]')).toHaveText('Sign in to My Shiloh');
    await expect(form.locator('[data-crm-mode]')).toHaveCount(0);
    await expect(form.getByLabel('Date of birth')).toBeHidden();
    await expect(form.getByLabel('Gender', { exact: true })).toBeHidden();
    await stable(page, testInfo, `crm-entry-${viewport.name}.png`, form.getByRole('button', { name: 'Continue', exact: true }));
    await form.getByLabel('First name', { exact: true }).fill('Synthetic');
    await form.getByLabel('Surname', { exact: true }).fill('Example');
    await form.getByLabel('Mobile number', { exact: true }).fill('0820000001');
    await expect(home.locator('[data-crm-title]')).toHaveText('Sign in to My Shiloh');
    pending = new Promise(resolve => { release = resolve; });
    await form.getByRole('button', { name: 'Continue', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect.poll(() => submissions.length).toBe(1);
    await expect(form.getByLabel('Mobile number')).toBeDisabled();
    release(); pending = null;
    await expect(form.locator('[data-crm-status]')).toContainText('Your Shiloh profile needs your date of birth and gender');
    expect(submissions[0]).toEqual({ firstName: 'Synthetic', surname: 'Example', mobile: '0820000001', completeProfile: false });
    await expect(form.getByLabel('Date of birth')).toBeFocused();
    await expect(form.getByLabel('First name', { exact: true })).toHaveValue('Synthetic');
    await form.getByRole('button', { name: 'Confirm and open My Shiloh' }).click();
    expect(submissions).toHaveLength(1);
    await form.getByLabel('Date of birth').fill('2000-01-01');
    await form.getByLabel('Gender', { exact: true }).selectOption('prefer_not_to_say');
    const dateBounds = await form.getByLabel('Date of birth').evaluate(input => ({ right: input.getBoundingClientRect().right, width: input.getBoundingClientRect().width, formWidth: input.closest('form').getBoundingClientRect().width }));
    expect(dateBounds.right).toBeLessThanOrEqual(viewport.width);
    expect(dateBounds.width).toBeGreaterThan(dateBounds.formWidth * 0.8);
    await stable(page, testInfo, `crm-completion-${viewport.name}.png`, form.getByRole('button', { name: 'Confirm and open My Shiloh' }));
    replyStatus = 401; reply = { error: 'We could not confirm these details. Contact Reception to check your Shiloh record.' };
    await form.getByRole('button', { name: 'Confirm and open My Shiloh' }).click();
    await expect(form.locator('[data-crm-status]')).toContainText('Contact Reception');
    expect(submissions[1]).toEqual({ firstName: 'Synthetic', surname: 'Example', mobile: '0820000001', dateOfBirth: '2000-01-01', gender: 'prefer_not_to_say', completeProfile: true, profileIntent: 'existing' });
    await expect(form.getByLabel('Date of birth')).toHaveValue('2000-01-01');
    await expect(form.getByLabel('Gender', { exact: true })).toHaveValue('prefer_not_to_say');
    await stable(page, testInfo, `crm-generic-error-${viewport.name}.png`, form.locator('[data-crm-status]'));
    // Editing identity requires a fresh lookup and confirmation; typed DOB/gender remain on this page only.
    await form.getByLabel('First name', { exact: true }).fill('New');
    await expect(home.locator('[data-crm-title]')).toHaveText('Sign in to My Shiloh');
    await expect(form.getByLabel('Date of birth')).toBeHidden();
    replyStatus = 200; reply = { next: 'new', requiredFields: ['dateOfBirth', 'gender'], missingFields: ['dateOfBirth', 'gender'] };
    await form.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(form.locator('[data-crm-status]')).toContainText('Welcome to Shiloh');
    expect(submissions[2]).toEqual({ firstName: 'New', surname: 'Example', mobile: '0820000001', completeProfile: false });
    await expect(form.getByLabel('Date of birth')).toHaveValue('2000-01-01');
    await expect(form.getByLabel('Gender', { exact: true })).toHaveValue('prefer_not_to_say');
    await stable(page, testInfo, `crm-registration-${viewport.name}.png`, form.getByRole('button', { name: 'Create profile and open My Shiloh' }));
    replyStatus = 503; reply = { error: 'Sign-in is temporarily unavailable. Please try again later.' };
    await form.getByRole('button', { name: 'Create profile and open My Shiloh' }).click();
    await expect(form.locator('[data-crm-status]')).toContainText('temporarily unavailable');
    await stable(page, testInfo, `crm-registration-generic-error-${viewport.name}.png`, form.locator('[data-crm-status]'));
    const axe = await new AxeBuilder({ page }).include('[data-view="home"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Successful completion follows the existing authenticated landing path.
    await page.route(url => /^\/my-shiloh\/?$/.test(url.pathname), route => route.fulfill({ contentType: 'text/html', body: '<h1>Signed in synthetic client</h1>' }));
    replyStatus = 200; reply = { authenticated: true };
    await form.getByRole('button', { name: 'Create profile and open My Shiloh' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in synthetic client' })).toBeVisible();
    await start(page);
    await expect(page.locator('[data-view="home"] input[name="firstName"]')).toHaveValue('');
  });

  test(`complete CRM records request DOB only on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('**/my-shiloh/auth/crm/continue', route => route.fulfill({ json: {
      next: 'existing', requiredFields: ['dateOfBirth'], missingFields: [],
    } }));
    await start(page);
    const form = page.locator('[data-view="home"] [data-client-crm-form]');
    await form.getByLabel('First name', { exact: true }).fill('Synthetic');
    await form.getByLabel('Surname').fill('Example');
    await form.getByLabel('Mobile number').fill('0820000001');
    await form.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(form.locator('[data-crm-status]')).toContainText('confirm your date of birth');
    await expect(form.getByLabel('Date of birth')).toBeVisible();
    await expect(form.getByLabel('Gender', { exact: true })).toBeHidden();
    await stable(page, testInfo, `crm-dob-check-${viewport.name}.png`, form.getByLabel('Date of birth'));
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
