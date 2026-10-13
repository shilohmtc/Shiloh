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
  test(`staff DOB rejects invalid dates and keeps typing and choosing in sync on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=staff-detail-sign-in--sign-in&viewMode=story', { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: ux.signinScript() });
    const dob = page.getByLabel('Date of birth', { exact: true });
    const calendar = page.getByLabel('Choose date of birth', { exact: true });
    await dob.fill('29/02/2000');
    await expect(calendar).toHaveValue('2000-02-29');
    for (const invalid of ['29/02/2001', '31/04/2000', '01/01/1899', '01/01/2999', '']) {
      await dob.fill(invalid);
      await expect(calendar).toHaveValue('');
      expect(await dob.evaluate(input => input.checkValidity())).toBe(false);
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
    expect(await dob.evaluate(input => input.checkValidity())).toBe(true);
  });
  test(`staff access directs enrollment to details without SMS or device setup on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-staff-sms-device-setup--details-sign-in&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: 'Staff sign-in details', exact: true })).toBeVisible();
    await expect(page.locator('[data-staff-sms-setup]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /SMS|Set up|Rename|Remove/ })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`staff-details-access-${viewport.name}.png`), fullPage: true });
  });
}
