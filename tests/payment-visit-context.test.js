'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor}=require('./helpers/priorPaymentFixture');
const {paymentVisitContext,paymentVisitReturnHref}=require('../src/presentation/paymentVisitContext');
const {renderCalendarPaymentPage}=require('../src/presentation/calendarPaymentsUx');
const {paymentFixture}=require('./fixtures/bookingPaymentPresentation');
test('payment context uses the selected visit, clinic time and escaped practitioner snapshots',()=>{
 const model=paymentFixture();Object.assign(model.subject,{startsAt:'2026-12-14T22:30:00Z',endsAt:'2026-12-14T23:30:00Z',practitionerNames:['Synthetic <practitioner>'],groupId:88});
 assert.equal(paymentVisitContext(model.subject),'15 Dec 2026, 00:30 – 01:30 SAST · Synthetic <practitioner>');
 const html=renderCalendarPaymentPage({model});assert.match(html,/Selected visit: 15 Dec 2026/);assert.match(html,/Synthetic &lt;practitioner&gt;/);assert.doesNotMatch(html,/<practitioner>/);assert.match(html,/date=2026-12-15/);assert.match(html,/Linked booking #88/);
 assert.equal(paymentVisitContext({startsAt:'invalid',endsAt:'invalid',practitionerNames:[]}), '');
});
test('payment return fills a missing date without discarding safe Calendar context',()=>{
 const subject={appointmentId:779,startsAt:'2026-12-14T22:30:00Z'};
 const fallback=new URL(paymentVisitReturnHref(subject),'https://safe.test');assert.equal(fallback.searchParams.get('date'),'2026-12-15');assert.equal(fallback.searchParams.get('appointment'),'779');
 const explicit=paymentVisitReturnHref(subject,'/calendar/read-only?view=day&date=2026-12-15&staff=11&phoneLayout=compact');assert.match(explicit,/view=day&date=2026-12-15&staff=11&phoneLayout=compact&appointment=779/);
 for(const raw of ['https://evil.test','//evil.test','/calendar/read-only?appointment=9&next=https://evil.test']){const url=new URL(paymentVisitReturnHref(subject,raw),'https://safe.test');assert.equal(url.origin,'https://safe.test');assert.equal(url.searchParams.get('appointment'),'779');assert.equal(url.searchParams.get('date'),'2026-12-15');assert.equal(url.searchParams.get('next'),null);}
});
test('authorized payment model reads exact visit context and preserves financial values',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());const calls=[];
 const query=async(sql,params)=>{calls.push(sql);const r=params?await pg.query(sql,params):await pg.exec(sql);const v=Array.isArray(r)?r.at(-1):r;return {...v,rowCount:v.rows.length||v.affectedRows};};const db={query,connect:async()=>({query,release(){}})};
 await install(db);await pg.exec("ALTER TABLE appointments ADD COLUMN ends_at timestamptz; ALTER TABLE appointment_staff ADD COLUMN staff_name_snapshot text; UPDATE appointments SET ends_at=starts_at+interval '1 hour'; UPDATE appointment_staff SET staff_name_snapshot='Synthetic practitioner'");calls.length=0;
 const model=await serviceFor(db).getReview({adminId:2,appointmentId:201});assert.equal(new Date(model.subject.startsAt).toISOString(),'2026-10-08T08:00:00.000Z');assert.equal(new Date(model.subject.endsAt).toISOString(),'2026-10-08T09:00:00.000Z');assert.deepEqual(model.subject.practitionerNames,['Synthetic practitioner']);assert.equal(model.payment.amountDue,'500.00');assert.equal(model.payment.netPaid,'0.00');assert.equal(model.payment.outstanding,'500.00');
 assert.ok(calls.every(sql=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql)));
 await assert.rejects(serviceFor(db).getReview({adminId:3,appointmentId:201}));
});
