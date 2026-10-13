const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const ux = require('../src/presentation/staffDetailSigninUx');
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
    await form.getByLabel('Date of birth').fill('2000-01-01');
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
    await expect(form.getByRole('button')).toBeDisabled();
    release();
    await expect(form.locator('[data-staff-detail-status]')).toContainText(
      'We could not sign you in',
    );
    await expect(form.getByRole('button')).toBeEnabled();
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
    await form.getByRole('button').click();
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
    await page.getByLabel('Date of birth').fill('2000-01-01');
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
}
