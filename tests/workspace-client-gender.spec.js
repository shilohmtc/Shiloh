const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspaceClientsManageClientScript } = require('../src/presentation/workspaceClientsManageUx');

for (const width of [390, 1440]) {
  for (const [story, recorded] of [['marietjie-client-management', 'female'], ['client-gender-legacy', 'non_binary'], ['client-gender-unrecorded', '']]) {
    test(`Workspace gender choices preserve ${recorded || 'unrecorded'} at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/iframe.html?id=workspace-clients--${story}&viewMode=story`, { waitUntil: 'networkidle' });
      const field = page.locator('#edit-client-gender');
      await expect(field).toHaveValue(recorded);
      expect(await field.locator('option:not([hidden])').allTextContents()).toEqual(['Female', 'Male']);
      await page.locator('[data-client-management]').screenshot({ path: info.outputPath(`recorded-gender-${story}-${width}.png`) });
      await page.addScriptTag({ content: workspaceClientsManageClientScript() });
      const requests = [];
      await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }));
      await page.route('**/calendar/clients/801/update', route => {
        requests.push(route.request().postDataJSON());
        return route.fulfill({ status: 409, json: { error: 'Synthetic revision refusal' } });
      });
      await page.locator('#edit-client-name').fill('Synthetic changed name');
      await page.getByRole('button', { name: 'Save client', exact: true }).click();
      await expect(page.locator('[data-client-operation-status]')).toContainText('Synthetic revision refusal');
      expect(requests).toHaveLength(1);
      expect(requests[0].gender).toBe(recorded || null);
      await expect(field).toHaveValue(recorded);
      await expect(page.locator('#edit-client-name')).toHaveValue('Synthetic changed name');
      await field.selectOption('male');
      await page.getByRole('button', { name: 'Save client', exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1].gender).toBe('male');
      await expect(field).toHaveValue('male');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const axe = await new AxeBuilder({ page }).include('[data-client-management]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations).toEqual([]);
      await page.locator('[data-client-management]').screenshot({ path: info.outputPath(`gender-${story}-${width}.png`) });
    });
  }
}
