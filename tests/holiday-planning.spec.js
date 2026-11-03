const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderClinicHoursPage, clinicHoursClientScript, clinicHoursTabsClientScript } = require('../src/presentation/workspaceClinicHoursUx');

for (const width of [390, 1440]) test(`holiday planning and existing override editor at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&view=holidays', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: clinicHoursClientScript() + clinicHoursTabsClientScript() });
  await expect(page.locator('.view-tab-count')).toHaveText('1');
  await expect(page.locator('#holiday-2026-12-16')).toContainText('Needs attention');
  await expect(page.locator('#holiday-2026-12-24')).toBeHidden();
  await expect(page.locator('#holiday-2026-12-25')).toBeHidden();
  await expect(page.locator('#holiday-2027-03-21')).toBeHidden();
  await expect(page.locator('#holiday-2026-12-24')).toContainText('Closed — annual default');
  await expect(page.locator('#holiday-2026-12-25')).toContainText('Clinic 09:00–12:00');
  await expect(page.getByRole('heading', { name: 'Plan ahead' })).toBeVisible();
  await expect(page.locator('#holiday-2027-03-22')).toBeHidden();
  const later = page.locator('[data-holiday-group="later"] summary');
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
  await page.locator('[data-holiday-group="saved"] summary').click();
  await expect(page.locator('#holiday-2026-12-25')).toBeVisible();
  await page.locator('[data-holiday-group="sundays"] summary').click();
  await expect(page.locator('#holiday-2027-03-21')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`holiday-decisions-expanded-${width}.png`), fullPage: true });
  await page.locator('#holiday-2026-12-25 [data-edit-date]').click();
  await expect(page.locator('[data-special-date]')).toHaveValue('2026-12-25');
  await expect(page.locator('[data-special-type]')).toHaveValue('open');
  await expect(page.locator('[data-special-start]')).toHaveValue('09:00');
  await expect(page.locator('[data-special-end]')).toHaveValue('12:00');
  // Inspect editor only: never submit a booking or saved-hours mutation.
});

test('a link to a later holiday expands its group and selects the existing editor', async ({ page }) => {
  await page.goto('/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&date=2027-03-22', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() });
  await expect(page.locator('[data-holiday-group="later"]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-special-date]')).toHaveValue('2027-03-22');
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
  await page.locator('[data-holiday-group="later"] summary').click();
  await expect(page.locator('#holiday-2027-03-22')).toBeVisible();
  await context.close();
});


test('links to saved decisions and Sundays reveal their groups without changing a decision', async ({ page }) => {
  for (const [date, group] of [['2026-12-25', 'saved'], ['2027-03-21', 'sundays']]) {
    await page.goto(`/iframe.html?id=workspace-holiday-planning--upcoming&viewMode=story&date=${date}`, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() });
    await expect(page.locator(`[data-holiday-group="${group}"]`)).toHaveAttribute('open', '');
    await expect(page.locator('[data-special-date]')).toHaveValue(date);
  }
});


for (const width of [390, 1440]) test(`proclaimed election holiday can be selected in the existing editor at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/iframe.html?id=workspace-holiday-planning--election-day&viewMode=story&date=2026-11-04', { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: clinicHoursTabsClientScript() + clinicHoursClientScript() });
  await expect(page.locator('#holiday-2026-11-04')).toContainText('Local Government Election Day');
  await expect(page.locator('#holiday-2026-11-04')).toContainText('Needs attention');
  await expect(page.locator('[data-special-date]')).toHaveValue('2026-11-04');
  await expect(page.locator('.view-tab-count')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('#special-dates').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`election-holiday-${width}.png`), fullPage: true });
  // Synthetic UI inspection only: do not save clinic decisions.
});
