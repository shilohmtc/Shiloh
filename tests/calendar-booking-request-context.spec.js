const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const client = (id, displayName) => ({ id, displayName, status: 'active', profileStatus: 'registered', contactHint: 'ending in 4567' });
async function open(page) {
  await page.goto('/iframe.html?id=workspace-production-surfaces--create-booking-from-request&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-client-mode-existing]')).toBeVisible();
}
for (const width of [390, 1440]) {
  test(`request booking keeps client, editable date/time and a clear return at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = [];
    await page.route('**/calendar/book/**', route => { writes.push(route.request().url()); return route.fulfill({ json: {} }); });
    await open(page);
    await expect(page.locator('[data-selected-client]')).toContainText('Synthetic Request Client');
    await expect(page.locator('#client-search')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Choose client' }).getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Back to request' })).toHaveAttribute('href', '/calendar/workspace#planning-request-81');
    await page.locator('#booking-date').fill('2030-11-04');
    await page.locator('#booking-time').fill('14:30');
    await expect(page.locator('#booking-date')).toHaveValue('2030-11-04');
    await expect(page.locator('#booking-time')).toHaveValue('14:30');
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-story-surface]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`request-booking-${width}.png`), fullPage: true });
  });
}
test('typing searches once after a pause, clears old selection and ignores late results and mode changes', async ({ page }) => {
  const queries = [], pending = [];
  await page.route('**/calendar/book/client-search', route => {
    queries.push(route.request().postDataJSON().query);
    pending.push(route);
  });
  await open(page);
  const search = page.locator('#client-search');
  await search.fill('A');
  await expect(page.locator('[data-selected-client]')).toBeHidden();
  await page.waitForTimeout(350);
  expect(queries).toEqual([]);
  await search.fill('An');
  await search.fill('Anna');
  await expect.poll(() => queries.length).toBe(1);
  expect(queries).toEqual(['Anna']);
  await search.fill('Bella');
  await expect.poll(() => queries.length).toBe(2);
  await pending[1].fulfill({ json: { clients: [client('124', 'Bella Synthetic')] } });
  await expect(page.locator('.client-result')).toContainText('Bella Synthetic');
  await pending[0].fulfill({ json: { clients: [client('125', 'Anna Synthetic')] } });
  await expect(page.locator('.client-result')).toHaveCount(1);
  await expect(page.locator('.client-result')).toContainText('Bella Synthetic');
  await page.locator('.client-result').click();
  await expect(page.locator('[data-selected-client]')).toContainText('Bella Synthetic');
  await search.fill('Chloe');
  await expect.poll(() => queries.length).toBe(3);
  await page.getByRole('button', { name: 'Add new client', exact: true }).click();
  await pending[2].fulfill({ json: { clients: [client('126', 'Chloe Synthetic')] } });
  await expect(page.locator('[data-selected-client]')).toBeHidden();
  await expect(page.locator('.client-result')).toHaveCount(0);
  await expect(page.locator('#new-client-name')).toBeVisible();
});

test('request booking reviews the carried client and refuses to leave when discarding fails', async ({ page }) => {
  let prepared, discardFails = true;
  await page.route('**/calendar/staff-auth/csrf', r => r.fulfill({ json: { csrfToken: 'synthetic' } }));
  await page.route('**/calendar/book/prepare', r => {
    prepared = r.request().postDataJSON();
    return r.fulfill({ json: { status: 'pending_confirmation', review: {
      client: client('123', 'Synthetic Request Client'), service: { id: 81, name: 'Quick Relief: Back & Neck (45 min)' },
      practitioner: { displayName: 'Synthetic Practitioner' }, startsAt: '2030-11-04T12:30:00Z', durationMinutes: 45, price: 'R650.00',
    } } });
  });
  await page.route('**/calendar/book/discard', r => r.fulfill({ status: discardFails ? 409 : 200, json: discardFails ? { error: 'Review changed; try again.' } : { status: 'discarded' } }));
  await page.route('**/calendar/workspace', r => r.fulfill({ body: '<h1>Request review</h1>' }));
  await open(page);
  await page.locator('#booking-date').fill('2030-11-04');
  await page.locator('#booking-time').fill('14:30');
  await page.getByRole('button', { name: /Any available/ }).click();
  await page.locator('#service-select').selectOption('81');
  await page.locator('#staff-select').selectOption('11');
  await page.getByRole('button', { name: 'Review booking', exact: true }).click();
  await expect(page.locator('[data-review-panel]')).toBeVisible();
  expect(prepared).toMatchObject({ clientId: '123', date: '2030-11-04', time: '14:30', staffId: 11, serviceId: 81 });
  await page.getByRole('link', { name: 'Back to request' }).click();
  await expect(page.locator('[data-booking-status]')).toContainText('Review changed');
  await expect(page.locator('[data-review-panel]')).toBeVisible();
  discardFails = false;
  await page.getByRole('link', { name: 'Back to request' }).click();
  await expect(page).toHaveURL(/\/calendar\/workspace#planning-request-81$/);
});
