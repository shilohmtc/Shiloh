const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { install } = require('./helpers/priorPaymentFixture');
const { createBookingPaymentService } = require('../src/services/bookingPayments');
const { renderCalendarPaymentPage } = require('../src/presentation/calendarPaymentsUx');
const { priorPaymentFixture } = require('./fixtures/bookingPriorPaymentPresentation');
async function fixture(t) {
  const pg=new PGlite();t.after(()=>pg.close());
  const queries=[];
  const query=async(sql,values)=>{queries.push(sql);const r=values?await pg.query(sql,values):await pg.exec(sql);const result=Array.isArray(r)?r.at(-1):r;return{...result,rowCount:result.rows.length||result.affectedRows||0};};
  const db={query,connect:async()=>({query,release(){}})};await install(db);
  await pg.exec("INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW()); INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,method) VALUES(100,'payment',100,'cash'); UPDATE appointments SET total_price=0 WHERE id=201;");
  let sideEffects=0;
  const service=createBookingPaymentService({db,now:()=>new Date('2026-10-12T10:00Z'),ozow:{configured:()=>true},rewards:{getClientBalance:async()=>{sideEffects++;return null;}},deposits:{ensureRequirement:async()=>{sideEffects++;return null;},getPosition:async()=>{sideEffects++;return null;}}});
  queries.length=0;return{pg,service,queries,effects:()=>sideEffects};
}
test('review reads original account and current price with receipts, without changing finances or enabling actions',async t=>{
  const f=await fixture(t);const model=await f.service.getReview({adminId:1,appointmentId:201});
  assert.deepEqual(model.priceReview,{kind:'price_changed_after_settlement',recordedAmountDue:'500.00',currentAmountDue:'0.00'});
  assert.equal(model.payment.amountDue,'500.00');assert.equal(model.payment.netPaid,'100.00');assert.equal(model.payment.entries.length,1);
  for(const key of ['canCollect','canRefund','canRecordPrior','canRecordNoCharge'])assert.equal(model.authority[key],false);
  assert.equal(model.priorPayments.candidates.length,0);assert.equal(f.effects(),0);
  assert.equal(f.queries.some(sql=>/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)),false);
  assert.equal(Number((await f.pg.query('SELECT canonical_amount_due FROM booking_payment_accounts WHERE id=100')).rows[0].canonical_amount_due),500);
  assert.equal(Number((await f.pg.query('SELECT total_price FROM appointments WHERE id=201')).rows[0].total_price),0);
});
test('normal reads and mutations keep rejecting the mismatch; injected review flag cannot weaken the guard',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.get({adminId:1,appointmentId:201,allowPriceReview:true}),{code:'PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT'});
  await assert.rejects(f.service.recordManual({adminId:1,appointmentId:201,amount:'10.00',method:'cash',reference:'Synthetic',notes:'Synthetic',operationId:'payment_review_123'}),{code:'PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT'});
  const model=await f.service.getReview({adminId:1,appointmentId:201});
  await assert.rejects(f.service.recordNoCharge({adminId:1,appointmentId:201,operationId:'review_nocharge_123',expectedRevision:model.subject.pricingRevision,reason:'Synthetic free treatment',reviewed:true}),{code:'PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT'});
  await assert.rejects(f.service.getReview({adminId:3,appointmentId:201}),{code:'PAYMENT_FORBIDDEN'});
  assert.equal((await f.pg.query('SELECT COUNT(*)::int n FROM payment_ledger_entries')).rows[0].n,1);
});
test('review presentation identifies R0 as separate from No charge, preserves evidence, and offers no mutation or share controls',()=>{
  const model=priorPaymentFixture({settled:true});
  model.priceReview={kind:'price_changed_after_settlement',recordedAmountDue:'500.00',currentAmountDue:'0.00'};
  model.subject.amountDue='0.00';
  model.authority={...model.authority,canCollect:false,canRefund:false,canRecordPrior:false,canRecordNoCharge:false};
  model.payment.requests=[{state:'pending',amount:'500.00',request_key:'synthetic_link_123',provider_payment_url:'https://pay.ozow.com/synthetic'}];
  const html=renderCalendarPaymentPage({model});
  assert.match(html,/Price review needed/);assert.match(html,/R0 is not yet a No charge decision/);assert.match(html,/Recorded balance · review only/);
  assert.match(html,/id="payment-history"/);assert.match(html,/SYNTHETIC-SEPTEMBER-RECEIPT/);
  const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  assert.doesNotMatch(body,/data-(manual-form|refund-form|ozow-form|copy-link|retry-deposit|payment-method-card)|data-prior-payment="/);
  assert.match(html,/Existing request · review required/);assert.doesNotMatch(html,/No balance outstanding/);
});
test('private HTML and state routes allow history review while retaining strict mutation preflight',async t=>{
  const f=await fixture(t);const express=require('express');const {createCalendarPaymentsRouter}=require('../src/routes/calendarPayments');
  let walletCalls=0;const app=express();app.use(express.json());
  app.use('/calendar/payments',createCalendarPaymentsRouter({env:{},service:f.service,sessionService:{validateSessionToken:async token=>({ok:token==='synthetic',adminId:1,sessionId:41}),rotateCsrfToken:async()=>({ok:true,csrfToken:'synthetic-csrf'}),validateCsrfToken:(_s,token)=>token==='synthetic-csrf'},creditService:{getClientModel:async()=>{walletCalls++;throw Error('Must not load wallets');},apply:async()=>{throw Error('Must not settle');}},giftSettlementService:{getAvailable:async()=>{walletCalls++;throw Error('Must not load gifts');}}}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={Cookie:'shiloh_staff_session=synthetic'};
  const page=await fetch(origin+'/calendar/payments/appointments/201',{headers});assert.equal(page.status,200);assert.match(await page.text(),/Read-only payment review/);assert.match(page.headers.get('cache-control'),/no-store/);
  const state=await fetch(origin+'/calendar/payments/appointments/201/state',{headers});assert.equal(state.status,200);assert.equal((await state.json()).priceReview.currentAmountDue,'0.00');assert.equal(walletCalls,0);
  assert.equal((await fetch(origin+'/calendar/payments/appointments/201')).status,401);
  const write=await fetch(origin+'/calendar/payments/appointments/201/client-credit',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json','X-Shiloh-CSRF-Token':'synthetic-csrf'},body:JSON.stringify({allowPriceReview:true,amount:'10.00'})});assert.equal(write.status,409);assert.equal((await write.json()).code,'PAYMENT_PRICE_CHANGED_AFTER_SETTLEMENT');
  assert.equal((await f.pg.query('SELECT COUNT(*)::int n FROM payment_ledger_entries')).rows[0].n,1);
});
