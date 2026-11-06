'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const path=require('node:path');
test.beforeEach(async({page})=>{await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));});
const {dashboardDepositsModel,dashboardDepositsHtml}=require('../stories/fixtures/workspaceDashboardDeposits');
const {renderDashboardPage,depositQueueContent}=require('../src/presentation/workspaceDashboardUx');

for(const width of [390,1440]) {
 test(`deposit refresh keeps content, disclosure and keyboard focus at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/step-one',r=>r.fulfill({contentType:'text/html',body:dashboardDepositsHtml('busy')}));
  let release,fail=false;
  const updated=dashboardDepositsModel('busy').depositQueue;updated.items[0].outstanding='125';
  await page.route('**/calendar/workspace/deposits',async r=>{await new Promise(resolve=>release=resolve);await r.fulfill({status:fail?503:200,contentType:'text/html',body:depositQueueContent(updated)});});
  await page.goto('/step-one');await page.locator('[data-deposits-review] summary').click();
  const link=page.locator('[data-deposit-account]').first().getByRole('link',{name:'Review payment'});
  await link.focus();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>Boolean(release)).toBe(true);await expect(link).toBeFocused();await expect(page.locator('[data-deposits-content]')).toContainText('150');
  release();await expect(page.locator('[data-deposits-content]')).not.toHaveAttribute('aria-busy');
  await expect(link).toBeFocused();await expect(page.locator('[data-deposits-content]')).toContainText('150');
  await page.locator('[data-deposits-review] summary').focus();await expect(page.locator('[data-deposits-content]')).toContainText('125');
  await expect(page.locator('[data-deposits-review]')).toHaveAttribute('open','');
  fail=true;release=null;await page.getByRole('button',{name:'Refresh deposits'}).click();await expect.poll(()=>Boolean(release)).toBe(true);release();
  await expect(page.locator('[data-deposits-status]')).toContainText('Could not refresh');await expect(page.locator('[data-deposits-content]')).toContainText('125');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('[data-dashboard-deposits]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`dashboard-refresh-${width}.png`),fullPage:true});
 });
 for(const outcome of ['no_show','completed'])test(`${outcome} updates unfinished visits without navigation at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});let saved=false,fail=true,writes=0,reads=0;
  const model=dashboardDepositsModel('busy'),visit=model.carryOver[0];model.carryOver=[{...visit,canMarkNoShow:true}];
  const initial=dashboardDepositsHtml('busy',()=>renderDashboardPage(model));
  await page.route('**/step-one',r=>r.fulfill({contentType:'text/html',body:initial}));
  await page.route('**/calendar/staff-auth/csrf',r=>r.fulfill({json:{csrfToken:'synthetic'}}));
  await page.route('**/calendar/payments/appointments/*/completion-state',r=>r.fulfill({json:{payment:{outstanding:'150'},subject:{pricingRevision:'synthetic'},authority:{canCollect:true}}}));
  await page.route('**/calendar/workspace/appointments/*/finalize',r=>{writes++;if(fail)return r.fulfill({status:409,json:{error:'Synthetic revision changed; nothing saved.'}});saved=true;return r.fulfill({json:{outcome,paymentOutcome:{choice:'outstanding'}}});});
  await page.route('**/calendar/workspace',r=>{reads++;expect(saved).toBe(true);return r.fulfill({contentType:'text/html',body:renderDashboardPage({...model,carryOver:[],recentActivity:[{...visit,status:outcome}]})});});
  await page.goto('/step-one');await page.evaluate(()=>window.syntheticDocumentMarker='preserved');
  const panel=page.locator('[data-dashboard-carryover-panel]'),action=panel.getByRole('button',{name:outcome==='completed'?'Completed':'No-show',exact:true});
  await action.click();
  if(outcome==='no_show')await page.getByRole('button',{name:'Mark no-show',exact:true}).click();
  else await page.getByRole('button',{name:'Payment outstanding',exact:true}).click();
  await expect(page.getByText(/Synthetic revision changed/)).toBeVisible();await expect(panel.locator('[data-dashboard-appointment]')).toHaveCount(1);expect(reads).toBe(0);
  fail=false;
  if(outcome==='completed'){await page.getByRole('button',{name:'Retry same choice'}).click();await page.getByRole('button',{name:'Done',exact:true}).click();}
  else {await action.click();await page.getByRole('button',{name:'Mark no-show',exact:true}).click();}
  await expect(panel.locator('[data-dashboard-appointment]')).toHaveCount(0);await expect(panel).toContainText('list is up to date');
  expect(await page.evaluate(()=>window.syntheticDocumentMarker)).toBe('preserved');expect(writes).toBe(2);expect(reads).toBe(1);await expect(page.locator('[data-dashboard-unfinished-link]')).toHaveText('Review unfinished visits');
  await expect(page.locator('[data-dashboard-activity-panel]')).toContainText(visit.clientName);
  await expect(page.locator('[data-dashboard-attention-panel]')).toBeVisible();
  expect((await new AxeBuilder({page}).include('.workspace-frame').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`dashboard-${outcome}-${width}.png`),fullPage:true});
 });
}

test('no-show is absent from active Today but retained in Recent activity; source model unchanged',async({page})=>{
 const model=dashboardDepositsModel('busy');const visit=model.appointments[0];visit.status='no_show';model.recentActivity=[visit];
 await page.route('**/step-one',r=>r.fulfill({contentType:'text/html',body:renderDashboardPage(model)}));await page.goto('/step-one');
 await expect(page.locator('[data-dashboard-today]').getByText(visit.clientName,{exact:true})).toHaveCount(0);
 await expect(page.locator('[data-dashboard-activity-panel]')).toContainText(visit.clientName);expect(model.appointments).toHaveLength(12);
});

for(const width of [390,1440])test(`Storybook dashboard step one at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-operational&viewMode=story',{waitUntil:'networkidle'});
 await expect(page.getByRole('link',{name:/Review unfinished visits/})).toBeVisible();
 const carry=page.locator('[data-dashboard-carryover-panel]');
 await expect(carry).toBeVisible();expect(await carry.evaluate(n=>n.parentElement.hasAttribute('data-dashboard-day-column'))).toBe(true);
 expect((await new AxeBuilder({page}).include('.workspace-frame').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`storybook-dashboard-${width}.png`),fullPage:true});
});

test('saved outcome with failed refresh keeps safe review and retries only the read',async({page})=>{
 const model=dashboardDepositsModel('busy');model.carryOver=[{...model.carryOver[0],canMarkNoShow:true}];let writes=0,fail=true;
 await page.route('**/step-one',r=>r.fulfill({contentType:'text/html',body:dashboardDepositsHtml('busy',()=>renderDashboardPage(model))}));
 await page.route('**/calendar/staff-auth/csrf',r=>r.fulfill({json:{csrfToken:'synthetic'}}));
 await page.route('**/calendar/workspace/appointments/*/finalize',r=>{writes++;return r.fulfill({json:{outcome:'no_show'}});});
 await page.route('**/calendar/workspace',r=>r.fulfill(fail?{status:503,body:'Unavailable'}:{contentType:'text/html',body:renderDashboardPage({...model,carryOver:[]})}));
 await page.goto('/step-one');const panel=page.locator('[data-dashboard-carryover-panel]');await panel.getByRole('button',{name:'No-show',exact:true}).click();await page.getByRole('button',{name:'Mark no-show',exact:true}).click();
 await expect(panel).toContainText('Visit outcome saved, but the list could not be refreshed');await expect(panel.getByRole('button',{name:'No-show',exact:true})).toBeDisabled();await expect(panel.getByRole('link',{name:'Open / manage',exact:true})).toBeVisible();
 fail=false;await panel.getByRole('button',{name:'Refresh visit list'}).click();await expect(panel.locator('[data-dashboard-appointment]')).toHaveCount(0);expect(writes).toBe(1);
});

test('exceptional outcome refresh preserves request drafts and reconciles its attention count',async({page})=>{
 const model=dashboardDepositsModel('busy'),visit={...model.carryOver[0],id:990001,canMarkNoShow:true};model.awaitingFinalization.push(visit);
 const after={...model,awaitingFinalization:model.awaitingFinalization.filter(item=>item.id!==visit.id)};
 await page.route('**/step-one',r=>r.fulfill({contentType:'text/html',body:dashboardDepositsHtml('busy',()=>renderDashboardPage(model))}));
 await page.route('**/calendar/staff-auth/csrf',r=>r.fulfill({json:{csrfToken:'synthetic'}}));
 await page.route('**/calendar/workspace/appointments/*/finalize',r=>r.fulfill({json:{outcome:'no_show'}}));
 await page.route('**/calendar/workspace',r=>r.fulfill({contentType:'text/html',body:renderDashboardPage(after)}));
 await page.goto('/step-one');const draft=page.locator('[data-planning-appointment]').first();await draft.evaluate(select=>{select.add(new Option('Synthetic draft appointment','990009'));select.value='990009';});
 const attention=page.locator('[data-dashboard-attention-panel]');await expect(attention.locator(':scope>.panel-head>.summary-pill')).toHaveText('3');
 await page.locator('[data-dashboard-attention-appointment="990001"]').getByRole('button',{name:'No-show',exact:true}).click();await page.getByRole('button',{name:'Mark no-show',exact:true}).click();
 await expect(page.locator('[data-dashboard-attention-appointment="990001"]')).toHaveCount(0);await expect(attention.locator(':scope>.panel-head>.summary-pill')).toHaveText('2');await expect(draft).toHaveValue('990009');
});
