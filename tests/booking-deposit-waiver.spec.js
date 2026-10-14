'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const express=require('express'),{once}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {install,input}=require('./helpers/depositWaiverFixture');
const {createBookingPaymentService}=require('../src/services/bookingPayments');
const {createCalendarPaymentsRouter}=require('../src/routes/calendarPayments');
const {renderCalendarPaymentPage,calendarPaymentsClientScript}=require('../src/presentation/calendarPaymentsUx');
let server,base,db,service,pg,received,interrupt;
test.beforeAll(async()=>{
 const app=express();app.use(express.json());app.use('/storybook',express.static('storybook-static'));
 app.get('/client.js',(_q,r)=>r.type('js').send(calendarPaymentsClientScript()));
 app.get('/payment',async(q,r,next)=>{try{r.send(renderCalendarPaymentPage({model:await service.get({adminId:Number(q.query.actor||2),appointmentId:201}),csrfToken:'synthetic-csrf',clientScriptPath:'/client.js'}));}catch(e){next(e);}});
 app.use('/calendar/payments',createCalendarPaymentsRouter({env:{NODE_ENV:'test'},sessionService:{validateSessionToken:async token=>token==='synthetic'?{ok:true,adminId:2}:{ok:false},validateCsrfToken:(_s,token)=>token==='synthetic-csrf'},service:{recordDepositWaiver:async data=>{received.push(data);const result=await service.recordDepositWaiver(data);if(interrupt){interrupt=false;throw Error('Synthetic lost response after commit');}return result;}}}));
 app.use((error,_q,r,_n)=>r.status(503).json({error:error.message}));server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(async()=>{pg=new PGlite();received=[];interrupt=false;const query=async(sql,params)=>{const r=params?await pg.query(sql,params):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};db={query,connect:async()=>({query,release(){}})};await install(db);
 const getPosition=async()=>{const requirement=(await db.query("SELECT r.*,COALESCE((SELECT SUM(amount) FROM payment_ledger_entries e WHERE e.payment_account_id=r.payment_account_id AND e.entry_type='payment'),0) AS net_paid FROM booking_deposit_requirements r WHERE id=90")).rows[0];const rows=(await db.query("SELECT a.id,a.crm_v2_client_id,c.name FROM appointments a JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id WHERE a.id=201 OR EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.group_id=70 AND gm.appointment_id=a.id) ORDER BY a.id")).rows;return {applicable:true,requirement,policy:{rateBasisPoints:5000},scope:{members:rows.map(r=>({appointmentId:Number(r.id),crmV2ClientId:Number(r.crm_v2_client_id),clientName:r.name,serviceName:'Synthetic treatment'}))},events:[]};};
 service=createBookingPaymentService({db,ozow:{configured:()=>false},rewards:{getClientBalance:async()=>null,syncEligibleEarnings:async()=>{}},deposits:{ensureRequirement:getPosition,getPosition},confirmBooking:async()=>{}});
});
test.afterEach(async()=>pg.close());
for(const width of [1180,1440,390,500])for(const shared of [false,true])test(`deposit-only waiver ${shared?'shared':'ordinary'} at browser width ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:757});if(shared)await db.query("INSERT INTO appointment_groups(id,status,final_total,total_price,updated_at,source) VALUES(70,'confirmed',1000,1000,'2026-10-14T08:00Z','shiloh_my_shiloh_couples');INSERT INTO appointment_group_members VALUES(70,201,1),(70,203,2);UPDATE appointments SET crm_v2_client_id=102 WHERE id=203;INSERT INTO appointment_booking_approvals VALUES(201,'approved'),(203,'approved');UPDATE booking_payment_accounts SET appointment_id=NULL,appointment_group_id=70,canonical_amount_due=1000 WHERE id=80;UPDATE booking_deposit_requirements SET required_amount=500 WHERE id=90;INSERT INTO booking_deposit_requirement_members VALUES(90,203,250,500,NULL,'{}')");
 await page.context().addCookies([{name:'shiloh_staff_session',value:'synthetic',url:base}]);await page.goto(base+'/payment',{waitUntil:'networkidle'});const form=page.locator('[data-deposit-waiver-form]'),button=form.getByRole('button',{name:'Waive deposit',exact:true});await expect(button).toBeDisabled();await expect(form.locator('li')).toHaveCount(shared?2:1);if(shared)await expect(form).toContainText('Whole shared booking');
 await form.getByLabel('Reason',{exact:true}).fill('Agreed deposit exception');await form.getByRole('checkbox').check();await expect(button).toBeEnabled();expect(await button.evaluate(n=>n.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 const a11y=await new AxeBuilder({page}).include('[data-payment-page]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a11y.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('before-waiver.png'),fullPage:true});
 for(const dismiss of ['Keep deposit','Escape','Keep deposit','Escape']){await button.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await page.locator('[data-payment-page]').evaluate(root=>root.shilohPaymentMethod.blocked())).toBe(true);await form.evaluate(node=>node.requestSubmit());if(dismiss==='Escape')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:dismiss,exact:true}).click();await expect(dialog).toBeHidden();await expect(button).toBeEnabled();await expect(button).toBeFocused();expect(received).toHaveLength(0);}
 interrupt=true;await button.click();await page.getByRole('dialog').getByRole('button',{name:'Waive deposit',exact:true}).click();await expect(page.locator('[data-payment-status]')).toContainText('Retry this unchanged decision');await expect(button).toBeEnabled();await expect(form.getByLabel('Reason',{exact:true})).toHaveAttribute('readonly','');
 await button.click();await expect(page.locator('[data-deposit-policy]')).toContainText('Deposit waived');await expect(page.locator('[data-deposit-waiver-form]')).toHaveCount(0);expect(received).toHaveLength(2);expect(received[1]).toEqual(received[0]);expect(received[0].adminId).toBe(2);
 expect((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='booking.deposit_waived'")).rows[0].n).toBe(1);expect((await db.query("SELECT SUM(amount)::text AS total FROM payment_ledger_entries WHERE payment_account_id=80")).rows[0].total).toBe('50.00');expect((await service.get({adminId:2,appointmentId:201})).payment.outstanding).toBe(shared?'950.00':'450.00');await page.reload({waitUntil:'networkidle'});await expect(page.locator('[data-deposit-policy]')).toContainText('Deposit waived');await page.screenshot({path:testInfo.outputPath('after-waiver.png'),fullPage:true});
});
test('unauthorized current actor sees no waiver form',async({page})=>{await page.goto(base+'/payment?actor=1',{waitUntil:'networkidle'});await expect(page.locator('[data-deposit-waiver-form]')).toHaveCount(0);expect(received).toHaveLength(0);});

test('Storybook waiver states retain accessible current actions and distinct waived evidence',async({page},testInfo)=>{
 for(const width of [1180,390])for(const state of ['ordinary','shared','waived','forbidden']){
  await page.setViewportSize({width,height:757});await page.goto(base+'/storybook/iframe.html?id=workspace-deposit-waiver--'+state+'&viewMode=story',{waitUntil:'networkidle'});
  await expect(page.locator('[data-payment-page]')).toBeVisible();await expect(page.locator('[data-deposit-waiver-form]')).toHaveCount(['ordinary','shared'].includes(state)?1:0);
  if(state==='waived')await expect(page.locator('[data-deposit-policy]')).toContainText('Deposit waived');
  const axe=await new AxeBuilder({page}).include('[data-payment-page]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('storybook-'+state+'-'+width+'.png'),fullPage:true});
 }
});
