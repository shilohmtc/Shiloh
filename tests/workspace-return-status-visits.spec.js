const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const express=require('express'),path=require('node:path');
const {detailsHtml}=require('../stories/fixtures/appointmentDetailsReview');
const {paymentFixture}=require('./fixtures/bookingPaymentPresentation');
const {createCalendarPaymentsRouter}=require('../src/routes/calendarPayments');
const {createWorkspaceFormsRouter}=require('../src/routes/workspaceForms');
const {pool}=require('../src/db/pool');
let server,base,writes=0,held=null,release=null;
const env={SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'};
test.beforeAll(async()=>{
 const app=express();
 app.use((req,res,next)=>{if(req.method!=='GET')writes++;next();});
 app.use('/storybook',express.static('storybook-static'));
 app.get('/calendar/pwa/icon-192.png',(_q,r)=>r.sendFile(path.resolve('public/assets/pwa/shiloh-pwa-192.png')));
 app.get('/calendar/read-only',(_q,r)=>r.send(detailsHtml({staffIds:[51,52],activeStaffId:51}).replaceAll('2026-10-07','2026-10-09')));
 app.get('/calendar/read-only/appointments/:id/details',async(q,r)=>{if(held)await held;r.json({appointmentId:Number(q.params.id),payment:{available:true,label:'R200 outstanding'},forms:{available:true,label:'1 required form'},notes:{available:true,present:false},contact:{available:false}});});
 const sessions={validateSessionToken:async()=>({ok:true,adminId:41,sessionId:8}),rotateCsrfToken:async()=>({ok:true,csrfToken:'synthetic'})};
 const original=pool.query;pool.query=async()=>({rows:[],rowCount:0});
 server={restore:()=>{pool.query=original;}};
 app.use('/calendar/payments',createCalendarPaymentsRouter({env,sessionService:sessions,service:{get:async({appointmentId})=>{const m=paymentFixture();m.subject.appointmentId=Number(appointmentId);m.subject.crmV2ClientId=null;return m;}}}));
 app.use('/calendar/forms',createWorkspaceFormsRouter({env,sessionService:sessions,service:{listForms:async()=>({authority:{displayName:'Synthetic Reception'},templates:[],activity:{}}),listTreatmentQueue:async()=>({appointments:[]})},submissionService:{listSubmissions:async()=>({items:[]})}}));
 const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));server.http=http;base='http://127.0.0.1:'+http.address().port;
});
test.afterAll(async()=>{release?.();server.restore();await new Promise(r=>server.http.close(r));});
for(const width of [390,1440])test(`Payments and Forms round trips preserve Friday, view, filters and scroll at ${width}`,async({page},info)=>{
 test.setTimeout(60000);
 await page.setViewportSize({width,height:844});
 const url=base+'/calendar/read-only?view=week&date=2026-10-09&staff=51&staff=52&activeStaff=51&phoneStaff=51&phoneLayout=roomier';
 await page.goto(url);
 await expect(page.locator('[data-event-id="appointment-1"]').first()).toBeVisible();
 if(width<700)await expect(page.locator('.phone-day-scroll')).toBeVisible();
 await page.locator('[data-event-id="appointment-1"]').first().scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>{const n=document.querySelector('.phone-day-scroll');if(n){n.scrollLeft=60;n.scrollTop=100;}return {x:scrollX,y:scrollY,left:n?.scrollLeft,top:n?.scrollTop};});
 for(const action of ['Payments','Forms','Payments','Forms']){
  await page.locator('[data-event-id="appointment-1"]').first().press('Enter');
  await expect(page.locator('[data-appointment-details-dialog]')).toBeVisible();
  await page.getByRole('link',{name:action,exact:true}).click();
  await expect(page.getByRole('link',{name:action==='Payments'?'Back to appointment':'Back to Calendar',exact:true})).toHaveAttribute('href',/date=2026-10-09/);
  await page.screenshot({path:info.outputPath(`friday-${action}-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:action==='Payments'?'Back to appointment':'Back to Calendar',exact:true}).click();
  await expect(page.locator('[data-details-title]')).toHaveText('Appointment #1');
  for(const close of ['Done','Close appointment details','Escape']){
   if(close==='Escape')await page.keyboard.press('Escape');else await page.getByRole('button',{name:close,exact:true}).click();
   await expect(page.locator('[data-appointment-details-dialog]')).toBeHidden();
   const actual=new URL(page.url());expect(actual.searchParams.get('date')).toBe('2026-10-09');expect(actual.searchParams.get('view')).toBe('week');expect(actual.searchParams.getAll('staff')).toEqual(['51','52']);expect(actual.searchParams.get('phoneStaff')).toBe('51');expect(actual.searchParams.get('activeStaff')).toBe('51');
   await expect.poll(()=>page.evaluate(()=>{const n=document.querySelector('.phone-day-scroll');return{x:scrollX,y:scrollY,left:n?.scrollLeft,top:n?.scrollTop};})).toEqual(before);
   if(close!=='Escape')await page.locator('[data-event-id="appointment-1"]').first().press('Enter');
  }
 }
 held=new Promise(r=>{release=r;});
 await page.locator('[data-event-id="appointment-1"]').first().press('Enter');await expect(page.locator('[data-details-load-status]')).toHaveText('Checking current details…');
 await page.getByRole('link',{name:'Forms',exact:true}).click();await page.getByRole('link',{name:'Back to Calendar',exact:true}).click();
 await expect(page.locator('[data-details-load-status]')).toHaveText('Checking current details…');await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('[data-event-id="appointment-3"]').first().press('Enter');release();held=null;
 await expect(page.locator('[data-details-title]')).toHaveText('Appointment #3');await expect(page.locator('[data-details-balance]')).toHaveText('R200 outstanding');
 const axe=await new AxeBuilder({page}).include('[data-appointment-details-dialog]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
 await page.screenshot({path:info.outputPath(`reopened-${width}.png`)});expect(writes).toBe(0);
});
for(const width of [390,1440])test(`Storybook next appointment, last visit and approval labels at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 for(const story of ['next-appointment-and-last-visit','awaiting-confirmation-history']){
  await page.goto(base+'/storybook/iframe.html?id=workspace-clients--'+story+'&viewMode=story',{waitUntil:'networkidle'});
  if(story.startsWith('next')){await expect(page.locator('.client-last').first()).toBeVisible();await expect(page.locator('.client-last').last()).toBeVisible();await expect(page.locator('.client-last').first()).toContainText('Next appointment:');await expect(page.locator('.client-last').first()).toContainText('Last visit:');await expect(page.locator('.client-last').last()).toContainText('No completed visit yet');}
  else {await expect(page.locator('.history-panel:has(#appointment-history) .status-pill').first()).toHaveCSS('text-transform','none');await expect(page.locator('.history-panel:has(#appointment-history) .history-list')).toContainText('Awaiting confirmation');await expect(page.locator('.history-panel:has(#appointment-history) .history-list')).toContainText('Awaiting client response');await expect(page.locator('.history-panel:has(#appointment-history) .history-list')).toContainText('completed');}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${story}-${width}.png`),fullPage:true});
 }
});
