'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderMyShilohBookingPage } = require('../src/presentation/myShilohBooking');
const { renderPlanningRequestPage } = require('../src/presentation/myShilohPlanningRequest');
const fs = require('node:fs');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const { createAssistantPreparation } = require('../src/services/myShilohAssistantPreparation');
const original='Monday, 2 November 2026', proposed='Tuesday, 3 November 2026';
const token='S'.repeat(43);
const action={type:'reschedule_appointment',token,title:'Request this new time?',service:'Synthetic treatment',practitioner:'Synthetic practitioner',currentDate:original,currentTime:'10:00',proposedDate:proposed,proposedTime:'11:00',note:'Your current appointment stays unchanged until Shiloh approves your request.',confirmLabel:'Request reschedule',declineLabel:'Keep current time'};
const story='/iframe.html?id=client-my-shiloh-pwa--authenticated-assistant-composer&viewMode=story#shiloh';
async function chat(page) {
  await page.goto(story,{waitUntil:'networkidle'});
  await page.evaluate(() => Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
  await page.addScriptTag({url:'/my-shiloh/assets/app.js'});
}
for (const width of [390,500,1180,1440]) {
  test(`assistant client-reviewed change and checklist at ${width}`,async ({page},testInfo) => {
    await page.setViewportSize({width,height:920}); let requests=0,confirms=0;
    let releaseMessage; const messageGate=new Promise(resolve=>{releaseMessage=resolve;});
    await page.route('**/my-shiloh/api/shiloh/message',async route => {
      requests++; await messageGate;
      return route.fulfill({json:{reply:'Review the proposed time. Nothing has changed yet.',action}});
    });
    await page.route('**/my-shiloh/auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic'}}));
    await page.route('**/my-shiloh/api/actions/confirm',async route=>{confirms++;await new Promise(resolve=>setTimeout(resolve,150));return route.fulfill({json:{status:'pending_approval',message:'Change requested / awaiting Shiloh approval. Your original appointment remains unchanged.'}});});
    const experience=buildClientExperience({client:{name:'Synthetic'},forms:[],rescheduleHistory:['pending','approved','declined'].map(status=>({status,originalStartsAt:'2026-11-02T08:00:00Z',proposedStartsAt:'2026-11-03T09:00:00Z'}))});
    await page.route('**/my-shiloh/api/experience',route=>route.fulfill({json:experience}));
    await chat(page);
    await expect(page.locator('[data-assistant-request-history]')).not.toHaveAttribute('open');
    await expect(page.locator('[data-assistant-request-current]')).toContainText('awaiting Shiloh approval');
    await page.screenshot({path:testInfo.outputPath(`compact-tracker-${width}.png`),fullPage:true});
    await page.locator('[data-assistant-request-history] summary').click();
    await expect(page.locator('[data-assistant-request-list]')).toContainText('Change approved');
    await expect(page.locator('[data-assistant-request-list]')).toContainText('Change declined');
    await expect(page.locator('[data-assistant-request-list]')).toContainText('awaiting Shiloh approval');
    await page.screenshot({path:testInfo.outputPath(`request-history-${width}.png`),fullPage:true});
    await page.locator('[data-assistant-request-history] summary').click();
    for (const label of ['Book my usual','Change my appointment','Prepare for my visit','Ask Reception']) await expect(page.getByRole('button',{name:label,exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Change my appointment'}).click();
    await expect(page.locator('[data-shiloh-chat-send]')).toBeDisabled();
    releaseMessage();
    await expect(page.locator('[data-client-action-card]')).toContainText(original);
    await expect(page.locator('[data-client-action-card]')).toContainText(proposed);
    await expect(page.locator('[data-client-action-card]')).toContainText('unchanged');
    await page.screenshot({path:testInfo.outputPath(`review-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Request reschedule',exact:true}).evaluate(node=>{node.click();node.click();});
    await expect(page.locator('[data-shiloh-messages]')).toContainText('awaiting Shiloh approval'); expect(confirms).toBe(1); expect(requests).toBe(1);
    await page.screenshot({path:testInfo.outputPath(`pending-${width}.png`),fullPage:true});
    const checklist=await createAssistantPreparation({contextService:{
      loadUpcomingAppointments:async()=>[{id:902,startsAt:'2026-11-02T08:00:00.000Z',services:['Synthetic treatment']}],
      loadForms:async()=>[{id:81,title:'Consultation',status:'sent',actionRequired:true,canComplete:true}],
      loadPayment:async()=>({amountDue:'720.00',outstanding:'720.00',depositState:'waived',depositRequired:'360.00',depositOutstanding:'0.00',activePaymentPath:'/pay/SYNTHETIC_TOKEN'}),
    }}).checklist({appointmentStartsAt:'2026-11-02T08:00:00.000Z'},55);
    await page.route('**/my-shiloh/api/shiloh/message',route=>route.fulfill({json:{reply:'Here is your checklist.',action:checklist.clientAction}}));
    await page.getByRole('button',{name:'Prepare for my visit'}).click();
    await expect(page.getByRole('link',{name:'Complete Consultation'})).toHaveAttribute('href','/my-shiloh/forms/complete?assignmentId=81');
    await expect(page.getByRole('link',{name:'Open secure payment'})).toHaveAttribute('href','/pay/SYNTHETIC_TOKEN');
    await expect(page.locator('[data-client-action-card]')).toContainText('Treatment remainder R720.00');
    expect((await new AxeBuilder({page}).include('[data-view="shiloh"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`checklist-${width}.png`),fullPage:true});
    fs.writeFileSync(testInfo.outputPath(`checklist-${width}.html`),await page.content());
  });
}

test('booking handoff consumes canonical date and practitioner, rechecks slot and leaves review to client',async ({page})=>{
  const html=renderMyShilohBookingPage({catalogue:[{id:101,name:'Synthetic treatment',category:'Massage',duration:'60 min',price:'R720'}],selectedServiceId:'101',csrfToken:'synthetic'});
  let submissions=0,reads=0;
  await page.route('**/my-shiloh/book?**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/my-shiloh/api/booking/practitioners?**',route=>route.fulfill({json:{service:{id:101,name:'Synthetic treatment',price:720},practitioners:[{id:11,name:'Synthetic practitioner'}]}}));
  await page.route('**/my-shiloh/api/booking/availability?**',route=>{reads++;expect(route.request().url()).toContain('date=2026-11-03');return route.fulfill({json:{slots:[{startsAt:'2026-11-03T08:00:00.000Z',time:'10:00',endTime:'11:00',date:'2026-11-03'}]}});});
  await page.route('**/my-shiloh/api/booking/request',route=>{submissions++;return route.abort();});
  await page.goto('/my-shiloh/book?service=101#'+new URLSearchParams({practitioner:'Synthetic practitioner',date:'2026-11-03',startsAt:'2026-11-03T08:00:00.000Z'}));
  await expect(page.locator('[data-booking-date]')).toHaveValue('2026-11-03');
  await expect(page.locator('[data-slot-status]')).toContainText('Your requested time is available');
  await expect(page.locator('[data-slots] button')).toHaveCount(1);expect(reads).toBe(1);expect(submissions).toBe(0);
  await expect(page.locator('[data-policy-accepted]')).not.toBeChecked();
  await page.route('**/my-shiloh/api/booking/availability?**',route=>route.fulfill({json:{slots:[{startsAt:'2026-11-03T09:00:00.000Z',time:'11:00',endTime:'12:00',date:'2026-11-03'}]}}));
  await page.goto('/my-shiloh/book?service=101&recheck=1#'+new URLSearchParams({practitioner:'Synthetic practitioner',date:'2026-11-03',startsAt:'2026-11-03T08:00:00.000Z'}));
  await expect(page.locator('[data-slot-status]')).toContainText('no longer available'); expect(submissions).toBe(0);
});

test('Reception draft stays reviewable, repeated submit is one request and unknown success stays retryable',async ({page})=>{
  const html=renderPlanningRequestPage({clientFirstName:'Synthetic',csrfToken:'synthetic'});
  await page.route('**/my-shiloh/request',route=>route.fulfill({contentType:'text/html',body:html}));
  let submissions=0; const keys=[];
  await page.route('**/my-shiloh/api/planning-requests',async route=>{submissions++;keys.push(route.request().postDataJSON().submissionKey);await new Promise(resolve=>setTimeout(resolve,100));expect(route.request().postDataJSON().clientNote).toBe('Prefer Tuesday morning with Synthetic practitioner');return route.fulfill({json:submissions===1 ? {} : {id:71,status:'requested'}});});
  await page.goto('/my-shiloh/request#'+new URLSearchParams({serviceDetail:'Synthetic treatment',preferredDate:'2026-11-03',preferredDaypart:'morning',clientNote:'Prefer Tuesday morning with Synthetic practitioner'}));
  await expect(page.locator('[name="serviceDetail"]')).toHaveValue('Synthetic treatment');
  await expect(page.locator('[name="preferredDate"]')).toHaveValue('2026-11-03');expect(submissions).toBe(0);
  await page.getByLabel('No',{exact:true}).check();
  await page.locator('[data-planning-form]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.locator('[data-planning-success]')).toBeHidden();
  await expect(page.locator('[data-planning-submit]')).toBeEnabled();
  await expect(page.locator('[data-planning-status]')).toHaveAttribute('data-tone','error');
  await page.locator('[data-planning-form]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.locator('[data-planning-success]')).toBeVisible(); expect(submissions).toBe(2);expect(keys[0]).toBe(keys[1]);
});

test('interruption removes obsolete card; failed confirmation never claims success at 200 percent text',async ({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/my-shiloh/api/shiloh/message',route=>route.fulfill({json:{reply:'Review this request.',action}}));
  await page.route('**/my-shiloh/auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic'}}));
  await page.route('**/my-shiloh/api/actions/confirm',route=>route.fulfill({status:409,json:{status:'slot_unavailable',error:'That time is no longer available. Your original appointment remains unchanged.'}}));
  await chat(page);await page.addStyleTag({content:'html{font-size:200%}'});
  await page.getByRole('button',{name:'Change my appointment'}).click();await expect(page.locator('[data-client-action-card]')).toBeVisible();
  await page.getByRole('button',{name:'Request reschedule',exact:true}).click();
  await expect(page.locator('[data-shiloh-messages]')).toContainText('no longer available');
  await expect(page.locator('[data-shiloh-messages]')).not.toContainText('Your appointment has been cancelled');
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('retry-390-zoom.png'),fullPage:true});
});
