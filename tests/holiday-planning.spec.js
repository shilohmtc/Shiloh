const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderClinicHoursPage, clinicHoursClientScript, clinicHoursTabsClientScript, assistantExceptionClientScript } = require('../src/presentation/workspaceClinicHoursUx');

for (const width of [390, 1440]) test(`holiday planning and existing override editor at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&view=holidays', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
  await page.addScriptTag({ content: clinicHoursClientScript() + clinicHoursTabsClientScript() + assistantExceptionClientScript() });
  await expect(page.locator('.view-tab-count')).toHaveText('1');
  await expect(page.locator('#holiday-2026-12-16')).toContainText('Needs attention');
  await expect(page.locator('#holiday-2026-12-24')).toBeHidden();
  await expect(page.locator('#holiday-2026-12-25')).toBeHidden();
  await expect(page.locator('#holiday-2027-03-21')).toBeHidden();
  await expect(page.locator('#holiday-2026-12-24')).toContainText('Closed — annual default');
  await expect(page.locator('#holiday-2026-12-25')).toContainText('Clinic 09:00–12:00');
  await expect(page.getByRole('heading', { name: 'Plan ahead' })).toBeVisible();
  await expect(page.locator('#holiday-2027-03-22')).toBeHidden();
  const later = page.locator('[data-holiday-group="later"] > summary');
  await later.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#holiday-2027-03-22')).toBeVisible();
  await expect(page.locator('#holiday-2027-03-22')).toContainText('Not decided');
  await expect(page.locator('#holiday-2027-03-21')).toContainText('Sunday — permanently closed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('#special-dates').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await later.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`holiday-planning-${width}.png`), fullPage: true });
  await page.locator('[data-holiday-group="saved"] > summary').click();
  await expect(page.locator('#holiday-2026-12-25')).toBeVisible();
  await page.locator('[data-holiday-group="sundays"] > summary').click();
  await expect(page.locator('#holiday-2027-03-21')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`holiday-decisions-expanded-${width}.png`), fullPage: true });
  const saved = page.locator('#holiday-2026-12-25 [data-holiday-form="clinic"]');
  await expect(saved.locator('[data-holiday-type]')).toHaveValue('open');
  await expect(saved.locator('[data-holiday-start]')).toHaveValue('09:00');
  await expect(saved.locator('[data-holiday-end]')).toHaveValue('12:00');
  // Inspect editor only: never submit a booking or saved-hours mutation.
});

test('a link to a later holiday expands its group and selects the existing editor', async ({ page }) => {
  await page.goto('/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&date=2027-03-22', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() + assistantExceptionClientScript() });
  await expect(page.locator('[data-holiday-group="later"]')).toHaveAttribute('open', '');
  await expect(page.locator('#holiday-2027-03-22 [data-holiday-type]').first()).toBeFocused();
  await expect(page.locator('[data-hours-tab="holidays"]')).toHaveAttribute('aria-selected', 'true');
});

test('later dates can be read and expanded without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route('**/*', route => route.abort());
  await page.route('https://synthetic.shiloh.test/hours', route => route.fulfill({ contentType: 'text/html', body: renderClinicHoursPage({ today: '2026-12-15', days: [], holidays: [{ exceptionDate: '2027-03-22', holidayName: 'Synthetic later holiday', decisionNeeded: true }] }) }));
  await page.goto('https://synthetic.shiloh.test/hours');
  await expect(page.locator('#special-dates')).toContainText('Undecided public holidays remain unavailable');
  await expect(page.locator('#holiday-2027-03-22')).toBeHidden();
  await page.locator('[data-holiday-group="later"] > summary').click();
  await expect(page.locator('#holiday-2027-03-22')).toBeVisible();
  await context.close();
});


test('links to saved decisions and Sundays reveal their groups without changing a decision', async ({ page }) => {
  for (const [date, group] of [['2026-12-25', 'saved'], ['2027-03-21', 'sundays']]) {
    await page.goto(`/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&date=${date}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
    await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() + assistantExceptionClientScript() });
    await expect(page.locator(`[data-holiday-group="${group}"]`)).toHaveAttribute('open', '');
    await expect(page.locator('#holiday-'+date)).toBeVisible();
    if (date === '2027-03-21') await expect(page.locator('#holiday-'+date+' [data-holiday-form]')).toHaveCount(0);
  }
});


for (const width of [390, 820, 1440]) test(`proclaimed election holiday can be selected in the existing editor at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/iframe.html?id=workspace-holiday-planning--election-day&viewMode=story&date=2026-11-04', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() + assistantExceptionClientScript() });
  await expect(page.locator('#holiday-2026-11-04')).toContainText('Local Government Election Day');
  await expect(page.locator('#holiday-2026-11-04')).toContainText('Needs attention');
  await expect(page.locator('#holiday-2026-11-04 [data-holiday-type]').first()).toBeFocused();
  await expect(page.locator('.view-tab-count')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('#special-dates').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`election-holiday-${width}.png`), fullPage: true });
  if (width === 820) {
    const nav = await page.locator('.workspace-nav').boundingBox();
    const heading = await page.getByRole('heading', { name: 'Clinic & booking hours', exact: true }).boundingBox();
    expect(heading.y).toBeLessThan(180);
    expect(nav.x + nav.width).toBeLessThanOrEqual(heading.x);
    const accountControls = page.locator('.workspace-account .workspace-account-signout:visible');
    await expect(accountControls).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    for (const control of await accountControls.all()) {
      const bounds = await control.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(nav.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(nav.x + nav.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000);
    }
  }
  // Synthetic UI inspection only: do not save clinic decisions.
});


for (const width of [390, 1440]) test(`weekly hours omit Sunday and retain six-day save payload at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/calendar/pwa/icon-192.png*', route => route.fulfill({ path: require('node:path').join(__dirname, '../public/assets/brand/shiloh-mark-192.png') }));
  const saved = [];
  await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }));
  await page.route(/\/calendar\/clinic-hours(?:\/assistant)?$/, async route => {
    saved.push({ url: route.request().url(), body: route.request().postDataJSON(), token: route.request().headers()['x-shiloh-csrf-token'] });
    await route.fulfill({ json: { revision: 'synthetic-next' } });
  });
  await page.goto('/iframe.html?id=workspace-production-surfaces--clinic-and-assistant-hours&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() + assistantExceptionClientScript() });
  for (const kind of ['clinic', 'assistant']) {
    await page.locator('[data-hours-tab="'+kind+'"]').click();
    const form = page.locator('[data-hours-form="'+kind+'"]');
    await expect(form.locator('[data-open]')).toHaveCount(6);
    await expect(form.locator('[data-'+kind+'-day="0"]')).toHaveCount(0);
    await form.getByLabel('Monday status').selectOption('closed');
    await expect(form.getByLabel('Monday opening time')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`weekly-${kind}-${width}.png`), fullPage: true });
    await form.locator('[type="submit"]').click();
    await expect(form.locator('[data-hours-status]')).toContainText('saved');
  }
  expect(saved).toHaveLength(2);
  for (const request of saved) {
    expect(request.token).toBe('synthetic-csrf');
    expect(request.body.days.map(x => x.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(request.body.days[0]).toEqual({ dayOfWeek: 1, open: false, startsLocal: null, endsLocal: null });
  }
});

test('per-date saves preserve other edits, use the existing endpoints and retain values on refusal', async ({ page }) => {
  const requests = []; let refuse = true;
  await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }));
  await page.route(/\/calendar\/clinic-hours\/(?:assistant-)?exceptions$/, async route => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: refuse ? 400 : 200, json: refuse ? { error: 'Synthetic hours refusal' } : { ok: true } });
  });
  await page.goto('/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&view=holidays', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Clinic & booking hours', exact: true })).toBeVisible();
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() + assistantExceptionClientScript() });
  await expect(page.locator('[data-assistant-special-form]')).toBeHidden();
  await expect(page.locator('.other-date [data-assistant-special-form]')).toHaveCount(1);
  const row = page.locator('#holiday-2026-12-16'), clinic = row.locator('[data-holiday-form="clinic"]');
  await expect(clinic.locator('[data-holiday-save]')).toBeDisabled();
  await expect(clinic.locator('[data-holiday-start]')).toHaveValue('');
  await expect(clinic.locator('[data-holiday-end]')).toHaveValue('');
  await page.locator('[data-holiday-group="saved"] > summary').click();
  const other = page.locator('#holiday-2026-12-25 [data-holiday-start]').first();
  await other.fill('10:15');
  await clinic.locator('[data-holiday-type]').selectOption('open');
  await clinic.locator('[data-holiday-start]').fill('09:00');
  await clinic.locator('[data-holiday-end]').fill('13:00');
  await clinic.evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(clinic.locator('[data-holiday-status]')).toHaveClass(/error/);
  expect(requests).toHaveLength(1);
  await expect(clinic.locator('[data-holiday-start]')).toHaveValue('09:00');
  await expect(page.locator('.view-tab-count')).toHaveText('1');
  refuse = false;
  await clinic.locator('[data-holiday-save]').click();
  await expect(clinic.locator('[data-holiday-status]')).toHaveText('Saved.');
  await expect(page.locator('.view-tab-count')).toHaveCount(0);
  await expect(other).toHaveValue('10:15');
  await expect(page.locator('#holiday-2026-12-25 [data-holiday-status]').first()).toHaveText('Not saved');
  await row.locator('.holiday-online > summary').click();
  const online = row.locator('[data-holiday-form="assistant"]');
  await online.locator('[data-holiday-type]').selectOption('closed');
  await expect(online.locator('[data-holiday-start]')).toBeDisabled();
  await online.locator('[data-holiday-save]').click();
  await expect(online.locator('[data-holiday-status]')).toHaveText('Saved.');
  expect(requests).toHaveLength(3);
  expect(requests[1].body).toEqual({ exceptionDate: '2026-12-16', exceptionType: 'open', startsLocal: '09:00', endsLocal: '13:00' });
  expect(requests[2].url).toMatch(/assistant-exceptions$/);
  expect(requests[2].body).toEqual({ exceptionDate: '2026-12-16', exceptionType: 'closed', startsLocal: null, endsLocal: null });
});
