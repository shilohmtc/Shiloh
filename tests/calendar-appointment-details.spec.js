'use strict';
const {test,expect}=require('@playwright/test'),AxeBuilder=require('@axe-core/playwright').default;
const {detailsHtml}=require('../stories/fixtures/appointmentDetailsReview');
const {DATE}=require('../scripts/calendar-phone-working-day-fixture');
const summary=id=>({appointmentId:id,payment:{available:true,label:'R 200.00 outstanding',scopeLabel:'Appointment balance'},forms:{available:true,label:'1 form outstanding'},notes:{available:true,present:true},contact:{available:true,name:'Synthetic Client One',displayPhone:'081 000 0101',callHref:'tel:+27810000101',whatsappHref:'https://wa.me/27810000101'},sharedBooking:false});
async function setup(page,options={}){
 let writes=0;await page.route('https://synthetic.shiloh.test/**',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET')writes++;if(url.pathname.includes('/appointments/'))return route.fulfill({json:summary(Number(url.pathname.split('/')[4]))});if(url.pathname==='/calendar/read-only')return route.fulfill({contentType:'text/html',body:detailsHtml(options)});return route.fulfill({status:404,body:''});});
 await page.goto('https://synthetic.shiloh.test/calendar/read-only?view='+(options.view||'week')+'&date='+DATE+'&staff=all&phoneStaff=all');return()=>writes;
}
for(const width of [390,1180])for(const mode of ['editable','pending','readOnly'])test(`expanded ${mode} details keep canonical therapist and manual contact controls at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});const writes=await setup(page,{pending:mode==='pending',readOnly:mode==='readOnly'});
 await page.locator('[data-event-id="appointment-1"]').first().press('Enter');const dialog=page.locator('[data-appointment-details-dialog]');await expect(dialog).toBeVisible();await expect(dialog.locator('[data-details-client]')).toHaveText('Synthetic Client One');await expect(dialog.locator('[data-details-practitioner]')).toHaveText('Synthetic North');await expect(dialog.locator('[data-details-date]')).toContainText('2026');await expect(dialog.locator('[data-details-balance]')).toContainText('200.00 outstanding');await expect(dialog.locator('[data-details-form-status]')).toHaveText('1 form outstanding');await expect(dialog.locator('[data-details-notes-status]')).toHaveText('Booking notes present');
 await expect(dialog.getByRole('link',{name:'Call Synthetic Client One',exact:true})).toHaveAttribute('href','tel:+27810000101');await expect(dialog.getByRole('link',{name:'WhatsApp Synthetic Client One',exact:true})).toHaveAttribute('href','https://wa.me/27810000101');await expect(dialog.getByRole('link',{name:'Payments',exact:true})).toHaveCount(1);await expect(dialog.getByRole('link',{name:'Forms',exact:true})).toHaveCount(1);
 await expect(dialog.getByRole(mode==='pending'?'link':'button',{name:'Manage booking',exact:true})).toHaveCount(mode==='readOnly'?0:1);
 for(const control of await dialog.locator('a:visible,button:visible').all())expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
 const audit=await new AxeBuilder({page}).include('[data-appointment-details-dialog]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(audit.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('details-'+mode+'-'+width+'.png')});
 await page.getByRole('button',{name:'Done',exact:true}).click();await expect(dialog).toBeHidden();expect(writes()).toBe(0);
});
for(const view of ['week','month','agenda'])test(`closing details preserves ${view} URL, staff and scroll`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,{view});if(view==='week')await page.getByRole('button',{name:'Roomier',exact:true}).click();
 const card=page.locator('[data-event-id="appointment-1"]').first();await card.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>({url:location.href,x:scrollX,y:scrollY,roomier:document.querySelector('.phone-day-scroll')?{x:document.querySelector('.phone-day-scroll').scrollLeft,y:document.querySelector('.phone-day-scroll').scrollTop}:null}));
 for(const close of ['Close appointment details','Done','Escape']){await card.click();await expect(page.locator('[data-appointment-details-dialog]')).toBeVisible();if(close==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:close,exact:true}).click();await expect(page.locator('[data-appointment-details-dialog]')).toBeHidden();await page.waitForTimeout(80);expect(page.url()).toBe(before.url);const after=await page.evaluate(()=>({x:scrollX,y:scrollY,roomier:document.querySelector('.phone-day-scroll')?{x:document.querySelector('.phone-day-scroll').scrollLeft,y:document.querySelector('.phone-day-scroll').scrollTop}:null}));expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);if(before.roomier)expect(after.roomier).toEqual(before.roomier);}
});
test('database outage shows unavailable status and never leaves the previous contact visible',async({page})=>{
 await setup(page);await page.locator('[data-event-id="appointment-1"]').first().click();await expect(page.locator('[data-details-contact-options]')).toBeVisible();await page.getByRole('button',{name:'Done',exact:true}).click();await page.route('**/appointments/*/details?*',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));await page.locator('[data-event-id="appointment-3"]').first().click();await expect(page.locator('[data-details-load-status]')).toContainText('unavailable');await expect(page.locator('[data-details-contact-options]')).toBeHidden();await expect(page.locator('[data-details-balance]')).toHaveText('Payment details unavailable');
});
test('all-day staff leave stays in its own therapist column and follows selection',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});const writes=await setup(page);const leave=page.locator('.phone-staff-all-day-leave[data-phone-all-day-staff-id="54"]');await expect(leave).toBeVisible();await expect(page.locator('.phone-day-notices [data-event-id="operational_leave-30"]')).toHaveCount(0);const column=page.locator('[data-phone-staff-column-id="54"]');const a=await leave.boundingBox(),b=await column.boundingBox();expect(Math.abs(a.x-b.x)).toBeLessThan(3);expect(Math.abs(a.width-b.width)).toBeLessThan(4);await expect(leave.getByRole('button',{name:/Manage/})).toBeVisible();await page.screenshot({path:info.outputPath('therapist-leave-phone.png')});await page.locator('.phone-staff-menu>summary').click();await page.locator('[data-phone-week-staff-id="54"]').click();await expect(leave).toBeHidden();expect(writes()).toBe(0);
});
test('Storybook exposes editable, pending and read-only appointment details',async({page})=>{for(const variant of ['editable','pending','read-only']){await page.goto('/iframe.html?id=calendar-appointment-details--'+variant+'&viewMode=story');await expect(page.frameLocator('iframe[title="Synthetic appointment details"]').locator('[data-event-id="appointment-1"]').first()).toBeVisible();}});
test('slow previous response cannot replace a newly opened client or revive contact controls',async({page})=>{
 await setup(page);let releaseFirst,releaseSecond,sawFirst,sawSecond;
 const firstGate=new Promise(resolve=>{releaseFirst=resolve;}),secondGate=new Promise(resolve=>{releaseSecond=resolve;});
 const firstRequest=new Promise(resolve=>{sawFirst=resolve;}),secondRequest=new Promise(resolve=>{sawSecond=resolve;});
 await page.route('**/appointments/*/details?*',async route=>{
  const id=Number(new URL(route.request().url()).pathname.split('/')[4]);
  if(id===1){sawFirst();await firstGate;await route.fulfill({json:summary(1)}).catch(()=>{});}
  else{sawSecond();await secondGate;await route.fulfill({json:{...summary(id),contact:{available:false},notes:{available:false},forms:{available:false},payment:{available:false}}}).catch(()=>{});}
 });
 try{
  await page.locator('[data-event-id="appointment-1"]').first().press('Enter');await firstRequest;
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('[data-event-id="appointment-3"]').first().press('Enter');await secondRequest;
  await expect(page.locator('[data-details-title]')).toHaveText('Appointment #3');
  // A queued native close event from the first opening must not cancel this request.
  await page.locator('[data-appointment-details-dialog]').dispatchEvent('close');
  releaseFirst();releaseSecond();
  await expect(page.locator('[data-details-load-status]')).toHaveText('');
  await expect(page.locator('[data-details-contact-options]')).toBeHidden();
  await expect(page.locator('[data-details-balance]')).toHaveText('Payment details unavailable');
  await expect(page.locator('[data-details-notes-status]')).toHaveText('Booking notes unavailable');
 }finally{releaseFirst();releaseSecond();}
});

test('invalid contact URLs remain hidden and a shared contact names the selected person',async({page})=>{
 await setup(page);await page.route('**/appointments/*/details?*',route=>route.fulfill({json:{...summary(1),sharedBooking:true,contact:{...summary(1).contact,whatsappHref:'https://wa.me/27810000101?text=private'}}}));await page.locator('[data-event-id="appointment-1"]').first().press('Enter');await expect(page.locator('[data-details-load-status]')).toHaveText('');await expect(page.locator('[data-details-contact-options]')).toBeHidden();await page.getByRole('button',{name:'Done',exact:true}).click();await page.route('**/appointments/*/details?*',route=>route.fulfill({json:{...summary(1),sharedBooking:true}}));await page.locator('[data-event-id="appointment-1"]').first().press('Enter');await expect(page.locator('[data-details-contact-status]')).toHaveText('Contact for this person only: Synthetic Client One');
});

test('clinic closure stays across the mobile grid while personal leave remains column scoped',async({page})=>{await page.setViewportSize({width:390,height:844});await setup(page,{closure:true});await expect(page.locator('.phone-day-notices .closure-strip')).toContainText('Synthetic clinic closure');const closure=await page.locator('.phone-day-notices .closure-strip').boundingBox(),column=await page.locator('[data-phone-staff-column-id="54"]').boundingBox();expect(closure.width).toBeGreaterThan(column.width*3);});

// Native close is queued: restoring twice must not steal focus before the next Enter.
test('queued close cannot refocus the previous booking before keyboard reopening',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.locator('[data-event-id="appointment-3"]').first().press('Enter');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 const next=page.locator('[data-event-id="appointment-1"]').first();await next.focus();
 await page.locator('[data-appointment-details-dialog]').dispatchEvent('close');
 await expect(next).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('[data-details-title]')).toHaveText('Appointment #1');
});
