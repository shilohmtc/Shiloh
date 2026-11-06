const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderCalendarPaymentPage, calendarPaymentsClientScript } = require('../src/presentation/calendarPaymentsUx');
const { waiverFixture } = require('../stories/fixtures/bookingDepositWaiverPresentation');
for (const width of [390, 1440]) test(`unfinished payments keep deposits, shared balances and uncertain receipts distinct at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/iframe.html?id=workspace-unfinished-payments--populated&viewMode=story', { waitUntil:'networkidle' });
  await expect(page.getByRole('heading', { name:'Unfinished payments', exact:true })).toBeVisible();
  await expect(page.locator('[data-payment-review-item]')).toHaveCount(3);
  if (width === 390) {
    const menu = await page.locator('.workspace-menu-toggle').boundingBox();
    const back = await page.getByRole('link', { name:'Back to Dashboard' }).boundingBox();
    expect(back.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  }
  await expect(page.locator('[data-payment-state="outstanding"]')).toHaveCount(2);
  const uncertain = page.locator('[data-payment-state="review"]');
  await expect(uncertain).toContainText('Payment receipt needs verification');
  await expect(uncertain.locator('.balance')).toHaveCount(0);
  await expect(page.locator('#upcoming-deposits')).toContainText('Future booking deposits are not overdue');
  await expect(page.locator('#upcoming-deposits').getByRole('link', { name:'View booking' })).toHaveAttribute('href', /date=2026-12-15&appointment=705/);
  await expect(page.getByRole('link', { name:'Review next bookings' })).toHaveAttribute('href', '/calendar/workspace/payments?after=725');
  expect((await new AxeBuilder({ page }).include('.workspace-main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:info.outputPath(`unfinished-payments-${width}.png`),fullPage:true });
});
for (const state of ['unavailable','restricted','empty-page']) test(`payment review ${state} avoids a false all-paid result`, async ({ page }, info) => {
  await page.goto(`/iframe.html?id=workspace-unfinished-payments--${state}&viewMode=story`, { waitUntil:'networkidle' });
  await expect(page.locator('.workspace-main')).not.toContainText(/all paid|all settled/i);
  if(state === 'unavailable') { await expect(page.getByRole('link', { name:'Try again' })).toBeVisible(); await expect(page.locator('#upcoming-deposits')).toBeVisible(); }
  if(state === 'empty-page') await expect(page.getByRole('link', { name:'Review next bookings' })).toBeVisible();
  await page.screenshot({ path:info.outputPath(`unfinished-payments-${state}.png`),fullPage:true });
});
test('waiver return waits for success and preserves the same decision after an uncertain response', async ({ page }) => {
  const returnReview = '/calendar/workspace/payments?after=25#upcoming-deposits';
  const submissions = [];
  await page.route('**/synthetic-payment.js', r => r.fulfill({ contentType:'application/javascript',body:calendarPaymentsClientScript() }));
  await page.route('**/synthetic-payment', r => r.fulfill({ contentType:'text/html',body:renderCalendarPaymentPage({ model:waiverFixture(),csrfToken:'synthetic',returnReview,clientScriptPath:'/synthetic-payment.js' }) }));
  await page.route('**/deposit/waive', r => { submissions.push(r.request().postDataJSON()); return r.fulfill({ status:submissions.length === 1 ? 503 : 200,json:submissions.length === 1 ? { error:'Synthetic interrupted response' } : { status:'waived' } }); });
  await page.route(/\/calendar\/workspace\/payments\?after=25$/, r => r.fulfill({ contentType:'text/html',body:'<h1>Review queue</h1>' }));
  await page.goto('/synthetic-payment', { waitUntil:'networkidle' });
  await expect(page.getByRole('link', { name:'Back to payments' })).toHaveAttribute('href',returnReview);
  const form=page.locator('[data-deposit-waiver-form]'),submit=form.getByRole('button', { name:'Waive deposit',exact:true });
  await expect(submit).toBeDisabled();
  await form.getByLabel('Reason', { exact:true }).fill('Synthetic agreed exception');
  await form.getByRole('checkbox').check();
  await submit.click();
  await page.getByRole('dialog').getByRole('button', { name:'Waive deposit',exact:true }).click();
  await expect(page.locator('[data-payment-status]')).toContainText('Retry this unchanged decision');
  await expect(page).toHaveURL(/\/synthetic-payment$/);
  await submit.click();
  await expect(page).toHaveURL(/\/calendar\/workspace\/payments\?after=25#upcoming-deposits$/);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]).toMatchObject({ confirmed:true,reason:'Synthetic agreed exception',requirementId:'90' });
});
