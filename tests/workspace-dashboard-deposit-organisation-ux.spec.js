const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { dashboardDepositsHtml, dashboardDepositsModel } = require('../stories/fixtures/workspaceDashboardDeposits');
const path = require('node:path');
for (const kind of ['sparse','busy']) for (const width of [1180,1440,390,500]) test(`${kind} Today owns outcomes and unfinished visits precede deposits at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:757});
  await page.route('**/calendar/workspace/navigation',route=>route.fulfill({json:{}}));
  await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
  await page.route('**/organisation-review',route=>route.fulfill({contentType:'text/html',body:dashboardDepositsHtml(kind)}));
  let writes=0;await page.route('**/calendar/staff-auth/csrf',route=>{writes++;return route.fulfill({json:{csrfToken:'synthetic'}});});
  await page.goto('/organisation-review',{waitUntil:'networkidle'});
  const today=page.locator('[data-dashboard-today]'),deposits=page.locator('[data-dashboard-deposits]'),attention=page.locator('[data-dashboard-attention-panel]');
  const t=await today.boundingBox(),d=await deposits.boundingBox();
  const unfinished=await page.locator('[data-dashboard-carryover-panel]').boundingBox();const preceding=width<=850?await attention.boundingBox():t;expect(unfinished.y-preceding.y-preceding.height).toBeCloseTo(12,0);expect(d.y-unfinished.y-unfinished.height).toBeCloseTo(12,0);expect(d.x).toBeCloseTo(t.x,0);expect(d.width).toBeCloseTo(t.width,0);
  await expect(attention.locator('[data-dashboard-attention-appointment]')).toHaveCount(0);
  await expect(deposits.locator('[data-deposits-count]')).toHaveText('2');
  await expect(deposits.locator('[data-deposit-account]').first()).toBeHidden();
  await expect(today.locator('.day-summary')).not.toContainText('pending request');
  await expect(today.locator('.day-summary')).not.toContainText('holiday');
  await deposits.locator('summary').click();
  await expect(deposits.locator('[data-deposit-account]').first()).toBeVisible();
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
  for(let repeat=0;repeat<2;repeat++){await finalize.click();await page.getByRole('button',{name:'Close payment window',exact:true}).click();await expect(finalize).toBeFocused();}
  await finalize.click();await page.keyboard.press('Escape');await expect(finalize).toBeFocused();expect(writes).toBe(0);
  for(const control of await page.locator('.appointment-actions button,.request-actions a,[data-deposits-refresh],summary[data-workspace-action]').all())expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const scan=await new AxeBuilder({page}).include('.workspace-frame').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(scan.violations).toEqual([]);
  await page.reload({waitUntil:'networkidle'});await expect(deposits.locator('[data-deposit-account]')).toHaveCount(2);
});

for(const width of [390,1440])test(`Future deposit booking keeps its date after refresh at ${width}`,async({page},info)=>{
 const {renderDashboardPage,depositQueueContent}=require('../src/presentation/workspaceDashboardUx');
 const model=dashboardDepositsModel('sparse');
 const queue={items:[{accountId:88,appointmentId:843,state:'partial',outstanding:'150',hasLink:true,members:[{appointmentId:843,startsAt:'2026-12-14T22:30:00Z',clientName:'Synthetic future guest',serviceName:'Synthetic treatment',staffNames:['Synthetic practitioner']}]}]};
 model.depositQueue=queue;
 await page.setViewportSize({width,height:950});
 await page.route('**/calendar/workspace/deposits',r=>r.fulfill({contentType:'text/html',body:depositQueueContent(queue)}));
 await page.route('**/calendar/pwa/icon-192.png*',route=>route.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
 await page.route('**/future-deposit-review',r=>r.fulfill({contentType:'text/html',body:renderDashboardPage(model)}));
 await page.goto('/future-deposit-review');
 const deposits=page.locator('[data-dashboard-deposits]');await deposits.locator('summary').click();
 for(let i=0;i<2;i++){
  await expect(deposits.getByRole('link',{name:'View booking',exact:true})).toHaveAttribute('href','/calendar/read-only?view=week&date=2026-12-15&appointment=843&staff=all');
  await expect(deposits.getByRole('link',{name:'Review payment',exact:true})).toHaveAttribute('href','/calendar/payments/appointments/843');
  if(!i)await deposits.getByRole('button',{name:'Refresh deposits'}).click();
 }
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect.poll(()=>page.locator('img').evaluateAll(images=>images.length>0&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
 await page.screenshot({path:info.outputPath(`future-deposit-${width}.png`),fullPage:true});
});
