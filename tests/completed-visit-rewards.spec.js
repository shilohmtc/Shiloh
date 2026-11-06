const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const token = 'a'.repeat(64);
for (const width of [390, 1440])
  test(`completed rewards preview amount and remaining balance before confirmation at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    let writes = 0,
      previews = 0;
    await page.route('**/completed-rewards/preview', (r) => {
      previews++;
      return r.fulfill({
        json: { amount: '100.00', outstanding: '725.00', remaining: '625.00', reviewToken: token },
      });
    });
    await page.route('**/completed-rewards', (r) => {
      writes++;
      return r.fulfill({ json: { status: 'applied', outstanding: '625.00' } });
    });
    await page.goto(
      '/iframe.html?id=workspace-completed-visit-rewards--balance-remaining&viewMode=story',
      { waitUntil: 'networkidle' },
    );
    const form = page.locator('[data-completed-rewards]'),
      button = form.getByRole('button', { name: 'Review reward use' });
    await expect(button).toBeDisabled();
    await form.getByLabel('Amount (R)', { exact: true }).fill('100');
    await form.getByRole('checkbox').check();
    await button.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Use R100.00');
    await expect(dialog).toContainText('R625.00 will remain');
    expect(writes).toBe(0);
    expect(previews).toBe(1);
    expect(
      (
        await new AxeBuilder({ page })
          .include('dialog[open]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const bounds = await dialog.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000);
    await page.screenshot({ path: info.outputPath(`completed-rewards-preview-${width}.png`) });
    await dialog.getByRole('button', { name: 'Keep rewards' }).click();
    expect(writes).toBe(0);
    await expect(button).toBeEnabled();
  });
test('uncertain reward response survives refresh, blocks other collection and retries the exact decision once', async ({
  page,
}) => {
  const bodies = [];
  let previews = 0;
  await page.route('**/completed-rewards/preview', (r) => {
    previews++;
    return r.fulfill({
      json: { amount: '100.00', outstanding: '725.00', remaining: '625.00', reviewToken: token },
    });
  });
  await page.route('**/completed-rewards', (r) => {
    bodies.push(r.request().postDataJSON());
    return r.fulfill({
      status: bodies.length === 1 ? 503 : 200,
      json:
        bodies.length === 1
          ? { error: 'Synthetic uncertain response' }
          : { status: 'idempotent_replay', outstanding: '625.00' },
    });
  });
  await page.goto(
    '/iframe.html?id=workspace-completed-visit-rewards--balance-remaining&viewMode=story',
    { waitUntil: 'networkidle' },
  );
  const form = page.locator('[data-completed-rewards]');
  await form.getByLabel('Amount (R)', { exact: true }).fill('100');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Review reward use' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apply rewards', exact: true })
    .click();
  await expect(page.locator('[data-payment-status]')).toContainText(
    'Retry this unchanged reward decision',
  );
  await expect(page.locator('[data-payment-method]')).toBeDisabled();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(form.getByLabel('Amount (R)', { exact: true })).toHaveValue('100');
  await expect(page.locator('[data-payment-method]')).toBeDisabled();
  await Promise.all([
    page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame()),
    form.getByRole('button', { name: 'Retry reward use' }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await expect.poll(() => bodies.length).toBe(2);
  expect(previews).toBe(1);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({
    clientConfirmed: true,
    crmV2ClientId: '101',
    reviewToken: token,
  });
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('shiloh-booking-noncash:779:completed-rewards')),
    )
    .toBe(null);
});
test('a settled page offers no new reward action but can resolve an earlier uncertain operation', async ({
  page,
}) => {
  const pending = {
    amount: '100',
    crmV2ClientId: '101',
    clientConfirmed: true,
    reviewToken: token,
    operationId: 'synthetic_existing_reward',
  };
  const submitted = [];
  await page.addInitScript((body) => {
    if (!sessionStorage.getItem('synthetic-seeded')) {
      sessionStorage.setItem(
        'shiloh-booking-noncash:779:completed-rewards',
        JSON.stringify({ body }),
      );
      sessionStorage.setItem('synthetic-seeded', 'yes');
    }
  }, pending);
  await page.route('**/completed-rewards', (r) => {
    submitted.push(r.request().postDataJSON());
    return r.fulfill({ json: { status: 'idempotent_replay', outstanding: '0.00' } });
  });
  await page.goto('/iframe.html?id=workspace-completed-visit-rewards--fully-paid&viewMode=story', {
    waitUntil: 'networkidle',
  });
  await expect(page.locator('[data-rewards-form]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry earlier request' }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toEqual(pending);
});
