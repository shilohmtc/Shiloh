'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBookingNoChargeActions}=require('../src/services/bookingNoCharge');
const {renderBookingPaymentMethod}=require('../src/presentation/bookingPaymentMethodUx');
const {renderNoChargeForm}=require('../src/presentation/bookingPriorPaymentsUx');
const {priorPaymentFixture}=require('./fixtures/bookingPriorPaymentPresentation');
const actions=createBookingNoChargeActions({});
const completed={status:'completed',appointmentId:201,financialClassification:'standard'};
test('No charge read-only eligibility checks all existing evidence without creating accounts',async()=>{
  const sql=[];
  const db={query:async(q,args)=>{sql.push(q);assert.deepEqual(args,[201]);return {rowCount:0};}};
  assert.deepEqual(await actions.eligibility(db,completed,null),{eligible:true,reason:''});
  assert.equal(sql.length,1);assert.match(sql[0],/^SELECT/);
  const queries=[];
  const accountDb={query:async(q,args)=>{queries.push(q);assert.deepEqual(args,[q.includes('package_session')?201:100]);return {rowCount:q.includes('payment_ledger')?1:0};}};
  const result=await actions.eligibility(accountDb,completed,{id:100});
  assert.equal(result.eligible,false);assert.match(result.reason,/payment or credit activity/);
  for(const table of ['payment_ledger_entries','treatment_credit_entries','booking_gift_voucher_allocations','booking_prior_payment_entries','booking_loyalty_allocations','booking_welcome_voucher_allocations'])assert.ok(queries[1].includes(table));
  assert.match(queries[1],/source_payment_account_id/);
  assert.doesNotMatch(queries[1],/state=|entry_type=/); // Reversed/zeroed evidence still blocks, as on record().
});
test('completion, linked visits, already free and package evidence explain the first applicable blocker',async()=>{
  const noQuery={query:()=>assert.fail('ineligible visit must not query financial evidence')};
  for(const subject of [{...completed,status:'scheduled'},{...completed,groupId:51},{...completed,financialClassification:'no_charge'}])assert.equal((await actions.eligibility(noQuery,subject,null)).eligible,false);
  const result=await actions.eligibility({query:async()=>({rowCount:1})},completed,{id:100});
  assert.match(result.reason,/package visit/);
});
test('selector and form fail closed on absent eligibility and preserve allowed entry',()=>{
  const model=priorPaymentFixture({noCharge:true});
  const html=()=>renderBookingPaymentMethod({model,manualForm:'',noncashForms:''});
  assert.match(html(),/value="no-charge" selected|value="no-charge">/);
  assert.match(renderNoChargeForm(model),/data-prior-payment="no-charge"/);
  delete model.noChargeEligibility;
  assert.match(html(),/value="no-charge" disabled/);
  assert.match(html(),/Refresh the payment review/);
  assert.equal(renderNoChargeForm(model),'');
  model.authority.canRecordNoCharge=false;
  assert.doesNotMatch(html(),/value="no-charge"/);
});
