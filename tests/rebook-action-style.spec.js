'use strict';
const {test,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const express=require('express'),path=require('node:path'),{once}=require('node:events');
const {rebookHtml}=require('../stories/fixtures/rebookActionPresentation');
let server,base,writes;
test.beforeAll(async()=>{writes=0;const app=express();app.use((q,_r,next)=>{if(q.method!=='GET')writes++;next();});app.use('/storybook',express.static('storybook-static'));app.get('/calendar/pwa/icon-192.png',(_q,r)=>r.sendFile(path.resolve('public/assets/pwa/shiloh-pwa-192.png')));app.get('/rebook',(_q,r)=>r.send(rebookHtml()));app.get('/calendar/workspace/planning-requests/8203/couples',(_q,r)=>r.json({clientName:'Synthetic enquiry couples',preferredDate:'2030-11-02',revision:'2030-10-01T08:00:00Z',service:{id:901,name:'Couples Massage'},practitioners:[{id:41,name:'Synthetic practitioner one'},{id:42,name:'Synthetic practitioner two'}]}));app.get('/calendar/workspace/planning-requests/:id/appointments',(_q,r)=>r.json({appointments:[],revision:'2030-10-01T08:00:00Z'}));app.get('/calendar/workspace/navigation',(_q,r)=>r.json({}));app.get('/calendar/read-only',(_q,r)=>r.send('<html lang="en"><title>Synthetic Calendar</title><main><h1>Synthetic Calendar</h1></main></html>'));server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(()=>new Promise(resolve=>server.close(resolve)));
for(const width of [1180,1440,390,500])test(`every Rebook variant keeps primary style and native behaviour at ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:757});await page.goto(base+'/rebook',{waitUntil:'networkidle'});const controls=page.locator('a,summary').filter({hasText:/^(Arrange booking|Manage booking)$/});await expect(controls).toHaveCount(5);
 for(const control of await controls.all()){await expect(control).toHaveAttribute('data-workspace-action','primary');expect(await control.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(41, 76, 60)');expect(await control.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);await control.focus();expect(await control.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');}
 const couples=page.locator('[data-couples-enquiry]'),summary=couples.locator('[data-couples-enquiry-details]>summary'),details=couples.locator('[data-couples-enquiry-details]');
 for(const key of ['Enter','Space','Enter','Space']){await summary.focus();await page.keyboard.press(key);await expect(details).toHaveAttribute('open','');await expect(couples.locator('form')).toBeVisible();await expect(couples.locator('[data-couples-enquiry-action="confirm"]')).toBeDisabled();await summary.focus();await page.keyboard.press(key);await expect(details).not.toHaveAttribute('open','');await expect(summary).toBeFocused();}
 for(const card of await page.locator('[data-dashboard-planning-request]').all()){
  for(const contact of await card.locator('a').filter({hasText:/^(Call|Open client profile)/}).all()){await expect(contact).toHaveAttribute('data-workspace-action','secondary');expect((await contact.boundingBox()).height).toBeGreaterThanOrEqual(44);}
  const attended=card.locator('[data-attended-details]>summary');await expect(attended).toHaveAttribute('data-workspace-action','create');await attended.focus();await page.keyboard.press('Enter');await expect(card.locator('[data-attended-details]')).toHaveAttribute('open','');await expect(card.getByRole('button',{name:'Confirm visit already attended',exact:true})).toBeDisabled();await attended.focus();await page.keyboard.press('Enter');
  const cancelled=card.getByRole('button',{name:'Client cancelled',exact:true});await expect(cancelled).toHaveAttribute('data-workspace-action','danger');for(const dismiss of ['Keep enquiry','Escape']){await cancelled.click();await expect(page.getByRole('dialog')).toBeVisible();if(dismiss==='Escape')await page.keyboard.press('Escape');else await page.getByRole('dialog').getByRole('button',{name:dismiss,exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(cancelled).toBeEnabled();await expect(cancelled).toBeFocused();}
 }
 const scan=await new AxeBuilder({page}).include('.workspace-frame').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(scan.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('rebook-all-'+width+'.png'),fullPage:true});
 const existing=page.locator('[data-booking-request="8101"]').getByRole('link',{name:'Manage booking',exact:true});await expect(existing).toHaveAttribute('href',/appointment=8101/);await existing.click();await expect(page.getByRole('heading',{name:'Synthetic Calendar'})).toBeVisible();await page.goBack();await expect(controls).toHaveCount(5);await page.reload({waitUntil:'networkidle'});await expect(controls).toHaveCount(5);expect(writes).toBe(0);
});
test('Storybook shows all native enquiry and existing-booking Rebook styles',async({page})=>{await page.goto(base+'/storybook/iframe.html?id=workspace-rebook-actions--all-variants&viewMode=story',{waitUntil:'networkidle'});const frame=page.frameLocator('iframe');await expect(frame.locator('a,summary').filter({hasText:/^(Arrange booking|Manage booking)$/})).toHaveCount(5);});

for(const width of [390,1180])test(`closing a Workspace booking detail retains every permitted Calendar practitioner at ${width}`,async({page},testInfo)=>{
 const {fixtureModel,STAFF,DATE}=require('../scripts/calendar-phone-working-day-fixture');
 const {renderCalendarPage}=require('../src/presentation/calendarReadOnlyUx');
 const {renderDashboardPage}=require('../src/presentation/workspaceDashboardUx');
 const {decoratePhoneCalendarV2,calendarPhoneCompactV2ClientScript}=require('../src/presentation/calendarPhoneCompactV2');
 const {calendarPhoneAllStaffClientScript}=require('../src/presentation/calendarPhoneAllStaffUx');
 const {calendarDesktopApprovedClientScript}=require('../src/presentation/calendarDesktopApprovedUx');
 const {calendarDesktopFitCanvasClientScript}=require('../src/presentation/calendarDesktopFitCanvasUx');
 const {calendarAppointmentDetailsClientScript}=require('../src/presentation/calendarAppointmentDetailsUx');
 await page.setViewportSize({width,height:844});let allowedCount=3;
 await page.route('**/calendar/read-only**',async route=>{
  const url=new URL(route.request().url()),model=fixtureModel({staff:STAFF.slice(0,allowedCount)});model.view=url.searchParams.get('view');if(model.view==='day')model.period={...model.period,dateKeys:[DATE]};
  let html=decoratePhoneCalendarV2(renderCalendarPage(model,{approvedPhonePresentation:true,desktopEnhancementEnabled:true}),{model});
  html=html.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/gi,'').replace('</body>',`<script>${calendarDesktopApprovedClientScript()+calendarDesktopFitCanvasClientScript()+calendarPhoneCompactV2ClientScript()+calendarPhoneAllStaffClientScript()+calendarAppointmentDetailsClientScript()}</script></body>`);
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.route('**/rebook',route=>route.fulfill({contentType:'text/html',body:rebookHtml(model=>{model.bookingRequests=[{...model.bookingRequests[0],appointmentId:1,requestedStartsAt:DATE+'T08:00:00+02:00'}];return renderDashboardPage(model);})}));
 for(allowedCount of [3,1]){
  await page.goto(base+'/rebook');await page.getByRole('link',{name:'Manage booking',exact:true}).click();
  await expect(page.locator('[data-details-title]')).toHaveText('Appointment #1');
  await page.getByRole('button',{name:'Close appointment details',exact:true}).click();
  if(width<700)await expect(page.locator('[data-phone-staff-column-id]:visible')).toHaveCount(allowedCount);
  else await expect(page.locator('.desktop-practitioner-lane[data-staff-id]:visible')).toHaveCount(allowedCount);
  await expect(page).toHaveURL(/view=week/);expect(new URL(page.url()).searchParams.get('date')).toBe(DATE);
  for(const close of ['Done','Escape']){
   await page.reload();await expect(page.locator('[data-appointment-details-dialog]')).toBeVisible();
   if(close==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:'Done',exact:true}).click();
   await expect(page.locator('[data-appointment-details-dialog]')).toBeHidden();
   if(width<700)await expect(page.locator('[data-phone-staff-column-id]:visible')).toHaveCount(allowedCount);
   else await expect(page.locator('.desktop-practitioner-lane[data-staff-id]:visible')).toHaveCount(allowedCount);
  }
  await page.screenshot({path:testInfo.outputPath('calendar-return-'+width+'-'+allowedCount+'.png')});
 }
 expect(writes).toBe(0);
});
