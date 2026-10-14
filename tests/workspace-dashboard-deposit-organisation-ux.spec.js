const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { dashboardDepositsHtml, dashboardDepositsModel } = require('../stories/fixtures/workspaceDashboardDeposits');
const path = require('node:path');
for (const kind of ['sparse','busy']) for (const width of [1180,1440,390,500]) test(`${kind} Today owns outcomes and deposits stay immediately below at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:757});
  await page.route('**/calendar/workspace/navigation',route=>route.fulfill({json:{}}));
  await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
  await page.route('**/organisation-review',route=>route.fulfill({contentType:'text/html',body:dashboardDepositsHtml(kind)}));
  let writes=0;await page.route('**/calendar/staff-auth/csrf',route=>{writes++;return route.fulfill({json:{csrfToken:'synthetic'}});});
  await page.goto('/organisation-review',{waitUntil:'networkidle'});
  const today=page.locator('[data-dashboard-today]'),deposits=page.locator('[data-dashboard-deposits]'),attention=page.locator('[data-dashboard-attention-panel]');
  const t=await today.boundingBox(),d=await deposits.boundingBox();
  expect(d.y-t.y-t.height).toBeCloseTo(12,0);expect(d.x).toBeCloseTo(t.x,0);expect(d.width).toBeCloseTo(t.width,0);
  await expect(attention.locator('[data-dashboard-attention-appointment]')).toHaveCount(0);
  await expect(deposits.locator('[data-deposit-account]')).toHaveCount(2);
  await expect(deposits.locator('[data-deposit-account]').first()).toHaveAttribute('data-deposit-account','7101');
  await expect(deposits.locator('[data-deposit-account="7102"]')).toHaveCount(1);
  await expect(deposits).toContainText('Synthetic shared guest 1');await expect(deposits).toContainText('Synthetic shared guest 2');await expect(deposits).toContainText('Part of the deposit is recorded');
  expect(await deposits.evaluate(n=>({overflow:getComputedStyle(n).overflowY,client:n.clientHeight,scroll:n.scrollHeight}))).toEqual(expect.objectContaining({overflow:'visible'}));
  for(const item of dashboardDepositsModel(kind).appointments) {
    await expect(today.locator(`[data-dashboard-appointment="${item.id}"]`)).toHaveCount(1);
    await expect(attention.locator(`[data-dashboard-attention-appointment="${item.id}"]`)).toHaveCount(0);
  }
  const finalize=today.locator('[data-dashboard-finalize="completed"]').first();
  for(let repeat=0;repeat<2;repeat++){await finalize.click();await page.getByRole('button',{name:'Not yet',exact:true}).click();await expect(finalize).toBeFocused();}
  await finalize.click();await page.keyboard.press('Escape');await expect(finalize).toBeFocused();expect(writes).toBe(0);
  for(const control of await page.locator('.appointment-actions button,.request-actions a,[data-deposits-refresh],summary[data-workspace-action]').all())expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const scan=await new AxeBuilder({page}).include('.workspace-frame').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(scan.violations).toEqual([]);
  await page.reload({waitUntil:'networkidle'});await expect(deposits.locator('[data-deposit-account]')).toHaveCount(2);
});
