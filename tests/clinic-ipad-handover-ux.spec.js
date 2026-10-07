'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const express=require('express');
const path=require('path');
const {fixture}=require('./support/clinicIpadHandoverFixture');
const {createClinicIpadPublicRouter,createClinicIpadSetupRouter}=require('../src/routes/clinicIpadCheckin');
for(const viewport of [{name:'phone',width:390,height:844},{name:'tablet',width:820,height:1180},{name:'desktop',width:1280,height:900}]) {
  test(`staff-confirmed handover and missing DOB on ${viewport.name}`,async({browser},testInfo)=>{
    const f=await fixture();
    const app=express();app.use(express.json());app.use('/assets',express.static(path.join(__dirname,'../public/assets')));
    app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:'synthetic-proof'}));
    const sessionService={validateSessionToken:async value=>value==='synthetic-staff'?{ok:true,adminId:3,sessionId:33}:{ok:false},validateCsrfToken:async()=>true};
    app.use('/calendar/check-in',createClinicIpadSetupRouter({env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},sessionService,service:f.service}));
    app.use('/check-in',createClinicIpadPublicRouter({env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},service:f.service}));
    app.get('/forms/f/:token',async(req,res)=>{
      const visit=/shiloh_checkin_form=([^;]+)/.exec(req.headers.cookie||'')?.[1];
      const access=await f.service.formAccess(req.params.token,visit);
      res.status(access.allowed?200:410).send(access.allowed?'<html lang="en"><title>Synthetic form</title><main><h1>Your consultation form is open</h1></main></html>':'Session ended');
    });
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const staff=await browser.newContext({viewport}),ipad=await browser.newContext({viewport}),other=await browser.newContext({viewport});
    const staffPage=await staff.newPage(),clientPage=await ipad.newPage(),otherPage=await other.newPage();
    const errors=[];for(const page of [staffPage,clientPage])page.on('pageerror',error=>errors.push(error.message));
    async function evidence(page,name){
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`${viewport.name}-${name}.png`),fullPage:true});
    }
    try {
      await staff.addCookies([{name:'shiloh_staff_session',value:'synthetic-staff',url:base}]);
      await ipad.addCookies([{name:'shiloh_checkin_device',value:f.deviceToken,domain:'127.0.0.1',path:'/check-in'}]);
      await other.addCookies([{name:'shiloh_checkin_device',value:f.otherDeviceToken,domain:'127.0.0.1',path:'/check-in'}]);
      await clientPage.goto(base+'/check-in/');
      await staffPage.goto(base+'/calendar/check-in/devices?appointmentId=42');
      await expect(staffPage.getByRole('button',{name:'Create setup code'})).toHaveCount(0);
      await expect(staffPage.getByRole('button',{name:'Disable iPad'})).toHaveCount(0);
      await expect(staffPage.getByRole('heading',{name:'Prepare on iPad',exact:true})).toBeVisible();
      await expect(staffPage.getByText('Staff devices',{exact:true})).toHaveCount(0);
      await expect(staffPage.getByRole('heading',{name:'Prepare a client form',exact:true})).toHaveCount(0);
      await expect(staffPage.getByLabel('Appointment number')).toHaveValue('42');
      await expect(staffPage.locator('[data-form-options]')).toBeEmpty();
      await expect(staffPage.getByRole('link',{name:'Back to Forms'})).toHaveAttribute('href','/calendar/forms?appointmentId=42#appointment-42');
      await evidence(staffPage,'preparation-start');
      await staffPage.getByRole('button',{name:'Find forms'}).click();
      await expect(staffPage.getByRole('combobox')).toHaveCount(1);
      await expect(staffPage.getByRole('combobox').locator('option[value="1"]')).toHaveText('iPad 1');
      await staffPage.getByRole('combobox').selectOption('1');
      await staffPage.getByRole('button',{name:'Prepare on iPad',exact:true}).click();
      await expect(staffPage.getByRole('button',{name:/I confirm this person/})).toBeVisible();
      await evidence(staffPage,'staff-handover');
      await clientPage.goto(base+'/check-in/verify');
      await expect(clientPage.getByText('+27821234567')).toHaveCount(0);
      await staffPage.getByRole('button',{name:/I confirm this person/}).click();
      await expect(staffPage.locator('[data-status]')).toContainText('Handover confirmed');
      await expect(clientPage.getByRole('link',{name:'Complete my form'})).toBeVisible({timeout:10000});
      await clientPage.getByRole('link',{name:'Complete my form'}).click();
      await expect(clientPage.getByText('+27821234567',{exact:true})).toBeVisible();
      await expect(clientPage.locator('input[name="mobile"]')).toHaveCount(0);
      await evidence(clientPage,'missing-dob');
      await otherPage.goto(base+'/check-in/verify');await expect(otherPage.getByText('+27821234567')).toHaveCount(0);
      await clientPage.getByLabel('Date of birth').fill('2035-01-01');
      await clientPage.getByRole('button',{name:'These details are correct'}).click();
      await expect(clientPage.getByRole('alert')).toContainText('valid date of birth');
      await clientPage.getByLabel('Date of birth').fill('1985-05-14');
      await clientPage.getByRole('button',{name:'These details are correct'}).click();
      await expect(clientPage.getByRole('heading',{name:'Your consultation form is open'})).toBeVisible();
      expect((await f.db.query('SELECT date_of_birth::text FROM crm_v2_clients WHERE id=10')).rows[0].date_of_birth).toBe('1985-05-14');
      await clientPage.goto(base+'/check-in/verify');await expect(clientPage.getByText('+27821234567')).toHaveCount(0);
      await clientPage.goto(base+'/check-in/');
      const prepared=await f.service.queueForm(3,1,42,7);
      await f.service.confirmHandover(3,1,prepared.handoffId,true);
      await clientPage.goto(base+'/check-in/verify');
      await expect(clientPage.locator('input[name="dateOfBirth"]')).toHaveCount(0);
      await evidence(clientPage,'existing-dob');
      await clientPage.getByRole('button',{name:'Details incorrect / Cancel'}).click();
      await expect(clientPage.getByText('+27821234567')).toHaveCount(0);
      await clientPage.goBack();
      await expect(clientPage.getByText('+27821234567')).toHaveCount(0);
      expect(errors).toEqual([]);
    }finally{await Promise.all([staff.close(),ipad.close(),other.close()]);await new Promise(resolve=>server.close(resolve));await f.close();}
  });
}

test('preparation Back preserves the appointment while general device settings retain revocation',async({page})=>{
  const f=await fixture(),app=express();app.use(express.json());
  app.post('/calendar/staff-auth/csrf',(_req,res)=>res.json({csrfToken:'synthetic-proof'}));
  const sessionService={validateSessionToken:async value=>value==='synthetic-staff'?{ok:true,adminId:3,sessionId:33}:{ok:false},validateCsrfToken:async()=>true};
  app.use('/calendar/check-in',createClinicIpadSetupRouter({env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},sessionService,service:f.service}));
  app.get('/calendar/forms',(_req,res)=>res.send('<html lang="en"><title>Synthetic forms</title><main><h1>Appointment 42 forms</h1></main></html>'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    await page.context().addCookies([{name:'shiloh_staff_session',value:'synthetic-staff',url:base}]);
    await page.goto(base+'/calendar/check-in/devices?appointmentId=42');
    await expect(page.locator('[data-revoke]')).toHaveCount(0);
    await page.getByRole('link',{name:'Back to Forms'}).click();
    await expect(page).toHaveURL(base+'/calendar/forms?appointmentId=42#appointment-42');
    await expect(page.getByRole('heading',{name:'Appointment 42 forms'})).toBeVisible();
    await page.goto(base+'/calendar/check-in/devices');
    await expect(page.getByRole('button',{name:'Create setup code'})).toBeVisible();
    await expect(page.locator('[data-revoke="1"]')).toBeVisible();
    await Promise.all([page.waitForEvent('load'),page.locator('[data-revoke="1"]').click()]);
    await expect(page.locator('[data-revoke="1"],[data-device-choice="1"]')).toHaveCount(0);
    await expect(page.locator('[data-revoke="2"]')).toBeVisible();
    expect((await f.db.query('SELECT revoked_at IS NOT NULL AS disabled FROM clinic_checkin_devices WHERE id=1')).rows[0].disabled).toBe(true);
    expect((await f.db.query('SELECT revoked_at IS NULL AS active FROM clinic_checkin_devices WHERE id=2')).rows[0].active).toBe(true);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});

const {calendarAppointmentDetailsClientScript}=require('../src/presentation/calendarAppointmentDetailsUx');
const {calendarPaymentLinkClientScript}=require('../src/presentation/calendarPaymentsUx');
test('Calendar Forms follows keyboard, repeat and deep-linked appointments',async({page})=>{
  await page.route('http://synthetic.test/**',route=>route.fulfill({contentType:'text/html',body:'<html lang="en"><title>Calendar</title><main><div class="event-card" data-kind="appointment" data-canonical="true" data-event-id="appointment-42" data-appointment-management-target="true"><h4>Synthetic client</h4></div><div class="event-card" data-kind="appointment" data-canonical="true" data-event-id="appointment-43"><h4>Other synthetic client</h4></div></main></html>'}));
  await page.goto('http://synthetic.test/calendar?view=week&date=2026-10-07&appointment=42');
  await page.addScriptTag({content:calendarPaymentLinkClientScript()});
  await page.addScriptTag({content:calendarAppointmentDetailsClientScript()});
  await expect(page.locator('[data-details-forms]')).toHaveAttribute('href','/calendar/forms?appointmentId=42&returnView=week&returnDate=2026-10-07#appointment-42');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('[data-event-id="appointment-43"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-details-forms]')).toHaveAttribute('href','/calendar/forms?appointmentId=43&returnView=week&returnDate=2026-10-07#appointment-43');
  await expect(page.locator('[data-details-payment]')).toHaveAttribute('href','/calendar/payments/appointments/43');
});

test('existing client DOB advisory acknowledges once with CSRF and stays dismissed on reload',async({page},testInfo)=>{
  let acknowledged=false,requests=0;
  await page.route('**/my-shiloh/auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
  await page.route('**/my-shiloh/api/profile',route=>route.fulfill({json:{profile:{name:'Synthetic Client',dateOfBirth:null,gender:'female',mobile:'•••4567',revision:'a'.repeat(64),registrationComplete:false,requiresDobBeforeBooking:false,dobRequestNeeded:!acknowledged}}}));
  await page.route('**/my-shiloh/api/profile/dob-request/acknowledge',route=>{
    expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
    expect(route.request().postDataJSON()).toEqual({});acknowledged=true;requests++;
    return route.fulfill({json:{acknowledged:true}});
  });
  async function open(){
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-home&viewMode=story',{waitUntil:'networkidle'});
    await page.evaluate(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
    await page.addScriptTag({url:'/my-shiloh/assets/app.js'});
  }
  await page.setViewportSize({width:390,height:844});await open();
  await expect(page.locator('[data-dob-request]')).toBeVisible();
  await expect(page.locator('[data-dob-request]')).toContainText('Your existing bookings stay as they are.');
  await page.screenshot({path:testInfo.outputPath('phone-dob-advisory.png'),fullPage:true});
  await page.getByRole('button',{name:'Not now',exact:true}).click();
  await expect(page.locator('[data-dob-request]')).toBeHidden();await open();
  await expect(page.locator('[data-dob-request]')).toBeHidden();expect(requests).toBe(1);
});

test('booking note indicator opens the existing authorized panel without card contents',async({page},testInfo)=>{
  const {createCalendarReadOnlyUxService}=require('../src/services/calendarReadOnlyUx');
  const {renderCalendarPage}=require('../src/presentation/calendarReadOnlyUx');
  const {calendarOperationalMutationsClientScript}=require('../src/presentation/calendarOperationalMutationsUx');
  const {calendarManageAppointmentNotesClientScript}=require('../src/presentation/calendarAppointmentNotesUx');
  const {calendarAppointmentCompactEditorClientScript}=require('../src/presentation/calendarAppointmentCompactEditorUx');
  const {createWorkspaceAppointmentNotesService,attachBookingNotePresence}=require('../src/services/workspaceAppointmentNotes');
  const f=await fixture(),notes=createWorkspaceAppointmentNotesService({db:f.db});
  await f.db.query("UPDATE appointments SET notes='Synthetic booking note for review' WHERE id=42");
  const item={kind:'appointment',id:42,canonical:true,status:'confirmed',clientName:'Synthetic Client',clientMobile:'27821234567',serviceName:'Swedish Massage',staffIds:[12],serviceContexts:[{serviceId:7,serviceName:'Swedish Massage'}],startsAt:'2026-10-07T08:00:00Z',endsAt:'2026-10-07T09:00:00Z'};
  const timeline={meta:{},staff:[{id:12,displayName:'Synthetic Practitioner',schedulingType:'regular'}],appointments:[item],events:[item],blocks:[],leave:[],closures:[],externalBusy:[],workingWindows:[],scheduleExceptions:[],recurringClosures:[]};
  const projection=createCalendarReadOnlyUxService({listTimeline:async()=>timeline,query:async()=>({rows:[{appointment_id:'42',client_mobile:'27821234567'}]})});
  const model=await projection.buildModel({view:'day',date:'2026-10-07',viewer:{staffId:2,calendarScope:'all_business'},now:new Date('2026-10-07T06:00:00Z')});
  model.mutationCapability={enabled:true,operations:['appointment:reschedule'],calendarScope:'all_business',serviceScope:'all_services'};
  await attachBookingNotePresence(model,2,notes);
  const app=express();app.get('/calendar/pwa/icon-192.png',(_req,res)=>res.sendFile(path.join(__dirname,'../public/assets/brand/shiloh-mark-192.png')));app.get('/calendar',(_req,res)=>res.send(renderCalendarPage(model).replace(/<script[\s\S]*?<\/script>/g,'')));
  let reads=0;app.get('/calendar/operations/appointments/42/notes',async(_req,res)=>{reads++;res.json(await notes.get({adminId:2,appointmentId:42}));});
  app.get('/calendar/operations/appointments/42/my-shiloh-availability',(_req,res)=>res.json({label:'Synthetic availability'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
      await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.address().port}/calendar`);
      await page.addScriptTag({content:calendarOperationalMutationsClientScript()});
      await page.addScriptTag({content:calendarManageAppointmentNotesClientScript()});
      await page.addScriptTag({content:calendarAppointmentCompactEditorClientScript()});
      await expect(page.locator('.event-card')).not.toContainText('Synthetic booking note for review');
      await page.getByRole('button',{name:'View booking notes for appointment 42'}).click();
      await expect(page.locator('[data-calendar-management-panel]')).toBeVisible();
      await expect(page.locator('[data-appointment-notes-form] textarea')).toHaveValue('Synthetic booking note for review');
      await expect(page.locator('[data-appointment-notes-form] textarea')).toBeVisible();
      await page.screenshot({path:testInfo.outputPath(`${viewport.name}-booking-notes.png`),fullPage:true});
    }
    expect(reads).toBe(2);
  }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
});

for(const change of ['revoked','stale','expired','replaced']){
  test(`an open iPad confirmation clears after ${change} handover`,async({page})=>{
    const f=await fixture();
    const app=express();app.use(express.json());app.use('/assets',express.static(path.join(__dirname,'../public/assets')));
    app.use('/check-in',createClinicIpadPublicRouter({env:{SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'true'},service:f.service}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    try{
      const prepared=await f.service.queueForm(2,1,42,7);await f.service.confirmHandover(3,1,prepared.handoffId,true);
      await page.context().addCookies([{name:'shiloh_checkin_device',value:f.deviceToken,domain:'127.0.0.1',path:'/check-in'}]);
      await page.goto(base+'/check-in/verify');await expect(page.getByText('+27821234567',{exact:true})).toBeVisible();
      let replacement;
      if(change==='revoked')await f.service.revoke(2,1);
      if(change==='stale')await f.db.query("UPDATE crm_v2_clients SET date_of_birth='1990-01-01',updated_at=NOW() WHERE id=10");
      if(change==='expired')f.setClock(new Date(Date.now()+16*60*1000));
      if(change==='replaced')replacement=await f.service.queueForm(2,1,43,8);
      await expect(page.getByText('+27821234567',{exact:true})).toHaveCount(0,{timeout:10000});
      if(replacement){
        const row=(await f.db.query('SELECT status,handed_over_at FROM clinic_checkin_form_handoffs WHERE id=$1',[replacement.handoffId])).rows[0];
        expect(row.status).toBe('queued');expect(row.handed_over_at).toBe(null);
        await expect(page.getByText('+27829876543',{exact:true})).toHaveCount(0);
      }
    }finally{await new Promise(resolve=>server.close(resolve));await f.close();}
  });
}
