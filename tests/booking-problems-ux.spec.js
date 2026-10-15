const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const path=require('node:path');
const {bookingProblemsModel,bookingProblemsContent}=require('../stories/fixtures/bookingProblems');
const {renderDashboardPage,dashboardClientScript}=require('../src/presentation/workspaceDashboardUx');
const {bookingProblemsClientScript}=require('../src/presentation/bookingProblemsUx');
const {UUID}=require('../src/services/bookingSubmissionIncidents');
for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1365,height:950}]) {
  test(`Booking problems Storybook shows manual support in the existing attention area on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-booking-problems--recent-problems&viewMode=story',{waitUntil:'networkidle'});
    const root=page.locator('[data-booking-problems]');await expect(root).toBeVisible();
    await expect(page.locator('[data-dashboard-attention-panel]')).toHaveCount(1);
    await expect(page.locator('[data-dashboard-attention-panel] [data-booking-problems]')).toHaveCount(1);
    await expect(root).toContainText('13:42 SAST');await expect(root).toContainText('5 failed attempts');
    await expect(root).toContainText('Same submission succeeded on retry');await expect(root).toContainText('Resolved by staff');
    await expect(root.getByRole('link',{name:'Open client'})).toHaveCount(3);
    await expect(root.getByRole('button',{name:'Mark resolved'})).toHaveCount(1);
    for(const control of await root.locator('a,button,select').all())expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('[data-booking-problems]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await root.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`booking-problems-story-${viewport.name}.png`),fullPage:true,animations:'disabled'});
    await page.goto('/iframe.html?id=workspace-booking-problems--support-unavailable&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.locator('[data-booking-problems]')).toContainText('temporarily unavailable');
    await expect(page.locator('[data-booking-problem-resolve]')).toHaveCount(0);
  });
  test(`Manual resolution confirms and refreshes; filters, stale revisions and permission errors stay explicit on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const model=bookingProblemsModel();let writes=0,fail=false,filterReads=0;
    function html(){return renderDashboardPage(model).replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,'').replace('</body>',`<script>${dashboardClientScript()}${bookingProblemsClientScript()}</script></body>`);}
    await page.route('**/booking-problems-review',route=>route.fulfill({contentType:'text/html',body:html()}));
    await page.route('**/calendar/workspace/navigation',route=>route.fulfill({json:{}}));
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
    await page.route('**/calendar/workspace/booking-problems?*',route=>{
      filterReads++;const filter=new URL(route.request().url()).searchParams.get('status');
      return route.fulfill({contentType:'text/html',body:bookingProblemsContent({...model.bookingProblems,filter,items:model.bookingProblems.items.filter(x=>filter==='all'||x.status===filter)})});
    });
    await page.route('**/calendar/workspace/booking-problems/*/resolve',route=>{
      writes++;expect(route.request().postDataJSON()).toEqual({revision:'5'});expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      if(fail)return route.fulfill({status:409,json:{error:'Changed'}});
      model.bookingProblems.items[0]={...model.bookingProblems.items[0],status:'resolved',canResolve:false,resolvedAt:'2026-10-15T12:15:00Z'};
      model.bookingProblems.pendingCount=0;return route.fulfill({json:{resolved:true}});
    });
    await page.goto('/booking-problems-review',{waitUntil:'networkidle'});
    const root=page.locator('[data-booking-problems]'),button=root.getByRole('button',{name:'Mark resolved'});
    await button.click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('does not change any booking or send a message');
    await dialog.getByRole('button',{name:'Keep open'}).click();await expect(button).toBeFocused();expect(writes).toBe(0);
    await button.click();await page.keyboard.press('Escape');expect(writes).toBe(0);
    fail=true;await button.click();await dialog.getByRole('button',{name:'Mark resolved',exact:true}).click();
    await expect(root.locator('[data-booking-problems-status]')).toContainText('problem changed');await expect(button).toBeEnabled();expect(writes).toBe(1);
    fail=false;await button.click();await dialog.getByRole('button',{name:'Mark resolved',exact:true}).click();
    await expect(root).toContainText('0 need follow-up');await expect(root.getByRole('button',{name:'Mark resolved'})).toHaveCount(0);expect(writes).toBe(2);
    await root.getByLabel('Booking problem status').selectOption('retry_succeeded');await expect(root.locator('[data-booking-problem]')).toHaveCount(1);await expect(root).toContainText('Synthetic retry client');
    expect(filterReads).toBe(1);await expect(root.getByLabel('Booking problem status')).toBeFocused();
    await page.route('**/calendar/workspace/booking-problems?*',route=>route.fulfill({status:403,json:{error:'Access changed'}}));
    await root.getByLabel('Booking problem status').selectOption('all');await expect(root.locator('[data-booking-problems-status]')).toContainText('client access has changed');
    await page.screenshot({path:testInfo.outputPath(`booking-problems-access-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  });
  for(const saved of [true,false]) test(`Client sees truthful saved-link=${saved} reference and same-attempt retry on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const requests=[];const reference='69edca79-077a-49d1-8fe4-8ba2d1bdc091';
    await page.route('**/my-shiloh/api/booking/practitioners?*',route=>route.fulfill({json:{practitioners:[{id:'11',name:'Synthetic Practitioner'}]}}));
    await page.route('**/my-shiloh/api/booking/availability?*',route=>route.fulfill({json:{slots:[{startsAt:'2026-11-02T08:00:00Z',date:'2026-11-02',time:'10:00',endTime:'11:15'}]}}));
    await page.route('**/my-shiloh/api/booking/unfinished-draft',route=>route.fulfill({json:{draft:null}}));
    await page.route('**/my-shiloh/api/booking/confirm',route=>{
      requests.push({body:route.request().postDataJSON(),token:route.request().headers()['x-shiloh-booking-attempt']});
      return route.fulfill(requests.length===1?{status:500,json:{error:'Internal server error',supportReference:reference,incidentLinkSaved:saved}}:{status:201,json:{message:'Synthetic booking request received.'}});
    });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-native-booking&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.locator('[data-my-shiloh-booking]')).toBeVisible();await page.addScriptTag({path:path.resolve('public/my-shiloh/assets/booking.js')});
    await page.locator('[data-book-service][data-service-id="101"]').click();await page.getByRole('button',{name:/Synthetic Practitioner/}).click();
    await page.locator('[data-booking-date]').fill('2026-11-02');await page.locator('[data-find-slots]').click();await page.getByRole('button',{name:/10:00–11:15/}).click();
    await page.locator('[data-special-occasion][value="no"]').check();await page.locator('[data-policy-accepted]').check();
    const submit=page.getByRole('button',{name:'Send booking request',exact:true});await submit.click();
    const status=page.locator('[data-confirm-status]');await expect(status).toContainText(reference);await expect(status).toContainText(saved?'saved a support link in Shiloh':'could not save a client support link');
    await expect(page.locator('[data-policy-accepted]')).toBeChecked();await expect(submit).toBeEnabled();expect(requests).toHaveLength(1);
    expect((await new AxeBuilder({page}).include('[data-step="4"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`booking-support-${saved?'saved':'outage'}-${viewport.name}.png`),fullPage:false,animations:'disabled'});
    await submit.click();await expect(page.locator('[data-step="5"]')).toBeVisible();expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(requests[0].token).toMatch(UUID);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
