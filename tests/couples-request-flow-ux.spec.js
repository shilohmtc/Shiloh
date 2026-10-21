const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const path=require('node:path');
const {couplesEnquiryClientScript}=require('../src/presentation/couplesEnquiryUx');
const {dashboardClientScript}=require('../src/presentation/workspaceDashboardUx');
for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1365,height:950}]) {
  async function evidence(page,testInfo,name){
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    expect((await new AxeBuilder({page}).include('[data-dashboard-attention-panel], [data-my-shiloh-couples]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`couples-flow-${name}-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
  test(`Reception reviews all family members and keeps sequential practitioner reuse on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const sent=[];
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'secure-csrf'}}));
    await page.route('**/calendar/workspace/booking-requests/801/propose',route=>{sent.push(route.request().postDataJSON());return route.fulfill({json:{status:'awaiting_client_confirmation'}});});
    await page.goto('/iframe.html?id=client-planning-requests--family-appointment-request&viewMode=story',{waitUntil:'networkidle'});
    const card=page.locator('[data-booking-request="801"]');await expect(card).toBeVisible();await page.addScriptTag({content:dashboardClientScript()});
    await expect(card).toContainText('Synthetic guest 2');await expect(card).toContainText('Total for everyone:');
    await expect(card.getByRole('button',{name:'Confirm everyone’s appointments'})).toBeEnabled();
    await expect(card.locator('[data-proposal-pair-staff]')).toHaveCount(3);
    await card.locator('[data-proposal-date]').fill('2030-11-03');await card.locator('[data-proposal-time]').fill('10:00');
    await evidence(page,testInfo,'family-approval');await card.getByRole('button',{name:'Propose alternative'}).click();
    await expect(card.locator('[data-booking-request-status]')).toContainText('Alternative is available');
    expect(sent).toEqual([{expectedRevision:'2030-10-01T08:00:00Z',startsAt:'2030-11-03T08:00:00.000Z',staffIds:[11,11,12]}]);
  });
  test(`older couples enquiry is completed in place, with explicit agreement and safe retry on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);let availability=0;const confirmed=[];
    await page.route('**/calendar/staff-auth/csrf',route=>{expect(route.request().method()).toBe('POST');return route.fulfill({json:{csrfToken:'secure-csrf'}});});
    await page.route('**/calendar/workspace/planning-requests/81/couples**',async route=>{
      const action=route.request().url().split('/').pop();
      if(action==='couples')return route.fulfill({json:{clientName:'Synthetic Organiser',preferredDate:'2030-11-02',revision:'2030-10-01T08:00:00Z',service:{id:901,name:'Couples Massage'},practitioners:[{id:11,name:'Practitioner A'},{id:12,name:'Practitioner B'}]}});
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('secure-csrf');const body=route.request().postDataJSON();
      if(action==='availability'){availability++;return route.fulfill({json:{slots:availability===1?[]:[{startsAt:'2030-11-02T08:00:00Z',time:'10:00'}]}});}
      if(action==='review'){expect(body.guest.consent).toBe(true);return route.fulfill({json:{quoteHash:'a'.repeat(64),total:'1080.00',deposit:'540.00',treatments:[{practitioner:'Practitioner A'},{practitioner:'Practitioner B'}]}});}
      confirmed.push(body);if(confirmed.length===1)return route.abort('failed');expect(body).toEqual(confirmed[0]);return route.fulfill({json:{status:'approved',message:'Both appointments are arranged.'}});
    });
    await page.goto('/iframe.html?id=client-planning-requests--couples-enquiry&viewMode=story',{waitUntil:'networkidle'});
    await page.addScriptTag({content:couplesEnquiryClientScript()});const card=page.locator('[data-couples-enquiry]');
    await expect(card).not.toContainText('Refresh appointments');await expect(card).not.toContainText('Cannot accommodate');
    await card.getByText('Arrange booking',{exact:true}).click();await expect(card.locator('form')).toBeVisible();
    await card.getByLabel('Guest’s first name and surname').fill('Synthetic Guest');await card.getByLabel('Guest’s mobile number').fill('0822345678');
    await card.locator('[name="guestConsent"]').check();await card.locator('[name="firstStaff"]').selectOption('11');await card.locator('[name="secondStaff"]').selectOption('12');
    await card.getByRole('button',{name:'Show shared times'}).click();await expect(card.locator('[data-couples-enquiry-status]')).toContainText('No shared times');
    await card.getByRole('button',{name:'Show shared times'}).click();await card.locator('[name="slot"]').selectOption('2030-11-02T08:00:00Z');
    await card.getByRole('button',{name:'Review both appointments'}).click();await expect(card.locator('[data-couples-enquiry-summary]')).toContainText('Total for two R1080.00');
    const confirm=card.getByRole('button',{name:'Confirm booking for both'});await expect(confirm).toBeDisabled();
    await card.locator('[name="clientAgreed"]').check();await expect(confirm).toBeEnabled();await evidence(page,testInfo,'enquiry-review');
    await confirm.click();await expect(card.locator('[data-couples-enquiry-status]')).toContainText('Retry the same request');
    await expect(confirm).toBeEnabled();await confirm.click();await expect(card.locator('[data-couples-enquiry-status]')).toContainText('Both appointments are arranged');
    expect(confirmed).toHaveLength(2);await expect(confirm).toBeDisabled();
  });
  test(`Reception sees both people and proposes one shared alternative on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);const sent=[];
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'secure-csrf'}}));
    await page.route('**/calendar/workspace/booking-requests/801/propose',route=>{sent.push(route.request().postDataJSON());return route.fulfill({json:{status:'awaiting_client_confirmation'}});});
    await page.goto('/iframe.html?id=client-planning-requests--couples-appointment-request&viewMode=story',{waitUntil:'networkidle'});
    await page.addScriptTag({content:dashboardClientScript()});const card=page.locator('[data-booking-request="801"]');
    await expect(card).toContainText('Synthetic Guest');await expect(card).toContainText('Practitioner A');await expect(card).toContainText('Practitioner B');
    await expect(card).toContainText('Total for both: R1');await expect(card.getByRole('button',{name:'Confirm booking for both'})).toBeEnabled();
    await card.locator('[data-proposal-date]').fill('2030-11-03');await card.locator('[data-proposal-time]').fill('10:00');
    await card.locator('[data-proposal-pair-staff]').nth(0).selectOption('12');await card.locator('[data-proposal-pair-staff]').nth(1).selectOption('11');
    await evidence(page,testInfo,'approval');await card.getByRole('button',{name:'Propose alternative'}).click();
    await expect(card.locator('[data-booking-request-status]')).toContainText('Alternative is available');
    expect(sent).toEqual([{expectedRevision:'2030-10-01T08:00:00Z',startsAt:'2030-11-03T08:00:00.000Z',staffIds:[12,11]}]);
  });
  test(`named Couples Massage enters the paired treatment flow with its total for two on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await page.route('**/my-shiloh/api/booking/couples/practitioners?*',route=>route.fulfill({json:{practitioners:[{id:11,name:'Practitioner A'},{id:12,name:'Practitioner B'}]}}));
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--named-couples-massage&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.locator('[data-my-shiloh-couples]')).toBeVisible();
    await page.addScriptTag({path:path.join(__dirname,'../public/my-shiloh/assets/couples-booking.js')});
    const root=page.locator('[data-my-shiloh-couples]');await root.getByLabel('Guest’s first name and surname').fill('Synthetic Guest');await root.getByLabel('Guest’s mobile number').fill('0822345678');await root.locator('[name="consent"]').check();
    await root.getByRole('button',{name:'Choose our treatments'}).click();
    await expect(root.locator('[data-couples-service="0"]')).toHaveValue('901');await expect(root.locator('[data-couples-service="1"]')).toHaveValue('901');
    await expect(root.locator('[data-couples-service="0"] option:checked')).toContainText('R1080.00 for two');
    for(const index of [0,1]){await expect(root.locator(`[data-couples-staff="${index}"]`)).toBeEnabled();await root.locator(`[data-couples-staff="${index}"]`).selectOption(index?'12':'11');}
    await evidence(page,testInfo,'named-treatment');
  });
}
