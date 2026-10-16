'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor,input,payload,SESSION}=require('./helpers/clientPaymentChoiceFixture');
async function setup(t,provider={}) {
  const pg=new PGlite();t.after(()=>pg.close());
  const query=async(sql,params)=>{const r=params?await pg.query(sql,params):(await pg.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};
  const db={query,connect:async()=>({query,release(){}})};await install(db);return {db,service:serviceFor(db,provider)};
}
async function reviewed(service,extra={}) {const i=input(extra);const m=await service.getClientPaymentChoices(i);return {...i,review:m.review};}
test('client references fit the existing 36-character provider envelope through the actual Ozow adapter and exact retry',async t=>{
 const {createOzowPaymentProvider,canonicalHash}=require('../src/services/ozowPaymentProvider');
 const env={OZOW_SITE_CODE:'SYNTHETIC_SITE',OZOW_PRIVATE_KEY:'synthetic-only-key',OZOW_API_KEY:'synthetic-only-api',SHILOH_PUBLIC_BASE_URL:'https://synthetic.example'};
 const sent=[];
 const provider=createOzowPaymentProvider({env,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);sent.push(body);
  assert.equal(url,'https://api.ozow.com/PostPaymentRequest');
  assert.match(body.TransactionReference,/^cpc_[a-f0-9]{32}$/);
  assert.equal(body.TransactionReference.length,36);
  const {HashCheck,...fields}=body;assert.equal(HashCheck,canonicalHash(Object.values(fields),env.OZOW_PRIVATE_KEY));
  return {ok:true,json:async()=>({requestId:'SYNTHETIC_REFERENCE',url:'https://pay.ozow.com/SYNTHETIC_REFERENCE'})};
 }});
 const {db,service}=await setup(t,provider);const i=await reviewed(service);
 assert.equal(i.review.length,64);
 const expected='cpc_'+require('crypto').createHash('sha256').update(JSON.stringify([i.crmV2ClientId,i.operationId])).digest('hex').slice(0,32);
 const first=await service.collectClientPayment(i),retry=await service.collectClientPayment(i);
 assert.equal(first.status,'ready');assert.deepEqual(retry,first);assert.equal(sent.length,1);
 assert.equal(sent[0].TransactionReference,expected);assert.equal(sent[0].Amount,'1000.00');
 assert.equal((await db.query('SELECT request_key FROM payment_requests')).rows[0].request_key,expected);
 assert.equal(first.paymentPath,`/pay/${expected}`);
});
test('read-only choices use canonical money and already-applied allocations; GET never creates a provider request',async t=>{
  let calls=0;const {db,service}=await setup(t,{createPaymentLink:async()=>{calls++;throw Error('No GET call');}});
  let m=await service.getClientPaymentChoices(input());assert.deepEqual(m.choices.map(c=>[c.key,c.amount]),[['deposit','500.00'],['full','1000.00']]);
  await db.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(80,'payment',200);INSERT INTO booking_loyalty_allocations VALUES(80,'applied',100)");
  m=await service.getClientPaymentChoices(input());assert.deepEqual(m.choices.map(c=>[c.key,c.amount]),[['deposit','300.00'],['full','700.00']]);assert.equal(m.appliedCredits,'100.00');assert.equal(calls,0);
});
test('owner/session/foreign identity cannot select a payment account and body amounts cannot select a charge',async t=>{
 const {db,service}=await setup(t);
 await assert.rejects(service.getClientPaymentChoices(input({crmV2ClientId:102})),{code:'PAYMENT_CLIENT_SESSION'});
 await assert.rejects(service.getClientPaymentChoices(input({appointmentId:204})),{code:'PAYMENT_CLIENT_BOOKING'});
 const r=await service.collectClientPayment({...await reviewed(service),amount:'0.01',payer_crm_v2_client_id:102});assert.equal(r.amount,'1000.00');
 assert.equal((await db.query('SELECT payer_crm_v2_client_id FROM payment_requests')).rows[0].payer_crm_v2_client_id,101);
 const reviewedBeforeRevocation=await reviewed(service);await db.query('UPDATE client_browser_sessions SET revoked_at=NOW() WHERE id=$1',[SESSION]);await assert.rejects(service.collectClientPayment(reviewedBeforeRevocation),{code:'PAYMENT_CLIENT_SESSION'});
});
test('actual existing loadPayment SQL selects exactly one member under canonical one-subject/member uniqueness and does not multiply receipts',async t=>{
 const {db}=await setup(t);
 await db.query(`ALTER TABLE clinic_booking_deposit_policy ADD COLUMN rate_basis_points INT DEFAULT 5000;
   INSERT INTO appointment_groups VALUES(700,'confirmed',1000,1000,NOW(),NULL);
   INSERT INTO appointment_group_members(group_id,appointment_id,guest_position) VALUES(700,201,1),(700,203,2);
   UPDATE booking_payment_accounts SET appointment_id=NULL,appointment_group_id=700 WHERE id=80;
   INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(80,'payment',100);`);
 const context=require('../src/services/myShilohClientContext').createMyShilohClientContextService({db});
 for(const id of [201,203]){const p=await context.loadPayment({id,crmV2ClientId:101});assert.equal(p.paid,'100.00');assert.equal(p.outstanding,'900.00');}
});
test('one durable external attempt: exact retry, other tab same choice, different choice and unknown outcome never reissue',async t=>{
 let calls=0;const {db,service}=await setup(t,{createPaymentLink:async()=>{calls++;throw Error('Synthetic unknown network outcome');}});
 const i=await reviewed(service);assert.equal((await service.collectClientPayment(i)).status,'needs_review');
 assert.equal((await service.collectClientPayment(i)).status,'needs_review');
 assert.equal((await service.collectClientPayment({...i,operationId:'synthetic_other_tab_0001'})).status,'needs_review');
 await assert.rejects(service.collectClientPayment({...i,choice:'deposit',operationId:'synthetic_other_tab_0002'}),{code:'PAYMENT_CHOICE_CHANGED'});
 assert.equal(calls,1);assert.equal((await db.query('SELECT state FROM payment_requests')).rows[0].state,'pending');
});
test('successful full payment satisfies cash deposit but never rewrites required deposit or forfeiture base; callback replay is once',async t=>{
 const {db,service}=await setup(t);const i=await reviewed(service);assert.equal((await service.collectClientPayment(i)).status,'ready');
 const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
 assert.equal((await service.handleOzowNotification(payload(request))).status,'paid');
 assert.equal((await service.handleOzowNotification({...payload(request),StatusMessage:'same verified transaction, changed envelope'})).status,'duplicate');
 const req=(await db.query('SELECT * FROM booking_deposit_requirements WHERE id=90')).rows[0];assert.equal(req.state,'satisfied');assert.equal(req.required_amount,'500.00');
 assert.equal((await db.query('SELECT required_amount FROM booking_deposit_requirement_members WHERE requirement_id=90')).rows[0].required_amount,'500.00');
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,1);
 await db.query(`INSERT INTO appointment_status_history(appointment_id,to_status,changed_at)
   SELECT 201,'cancelled',starts_at-interval '48 hours' FROM appointments WHERE id=201
   UNION ALL SELECT 201,'cancelled',starts_at-interval '24 hours' FROM appointments WHERE id=201
   UNION ALL SELECT 201,'cancelled',starts_at-interval '23 hours 59 minutes' FROM appointments WHERE id=201
   UNION ALL SELECT 201,'no_show',starts_at FROM appointments WHERE id=201`);
 assert.deepEqual((await db.query('SELECT policy_forfeit_amount FROM booking_deposit_policy_events ORDER BY id')).rows.map(e=>e.policy_forfeit_amount),['0.00','250.00','500.00','500.00']);
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_ledger_entries WHERE entry_type='refund'")).rows[0].n,0);
});
test('stale amount, price, waiver, members, expiry and exact-replay recovery cannot return a ready stale link',async t=>{
 const {db,service}=await setup(t);const i=await reviewed(service);const first=await service.collectClientPayment(i);assert.equal(first.status,'ready');
 assert.equal(await service.validatePaymentCheckout(first.paymentPath.slice(5)),true);
 await db.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(80,'payment',200)");
 assert.equal((await service.collectClientPayment(i)).status,'needs_review');assert.equal((await service.collectClientPayment({...i,operationId:'synthetic_new_tab_0001'})).status,'needs_review');
 assert.equal(await service.validatePaymentCheckout(first.paymentPath.slice(5)),false);
});
test('real late money after manual settlement/local closure is retained; second distinct verified receipt is retained and reviewed',async t=>{
 const {db,service}=await setup(t);await service.collectClientPayment(await reviewed(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
 await service.recordManual({adminId:2,appointmentId:201,amount:'1000.00',method:'cash',operationId:'synthetic_manual_receipt'});
 await db.query("UPDATE payment_requests SET state='cancelled'");
 assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
 assert.equal((await service.handleOzowNotification(payload(request,'SYNTHETIC_TXN_SECOND_ACTUAL_RECEIPT'))).status,'paid_review_required');
 assert.equal((await db.query("SELECT SUM(amount)::text AS n FROM payment_ledger_entries WHERE entry_type='payment'")).rows[0].n,'3000.00');
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_ledger_entries WHERE entry_type='refund'")).rows[0].n,0);
});
test('historic created, issued, pending and locally closed attempts block new competing collection; deferred provenance alone permits choice',async t=>{
 const {db,service}=await setup(t);
 for(const state of ['created','link_issued','pending','cancelled','failed','expired']){
  await db.query('DELETE FROM payment_requests');await db.query("INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose) VALUES(80,'historic_attempt_unknown',$1,500,'deposit')",[state]);
  assert.equal((await service.getClientPaymentChoices(input())).choices.length,0,state);
 }
 await db.query("DELETE FROM payment_requests;INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose) VALUES(80,'dpc_positive_new_protocol','created',500,'deposit')");assert.equal((await service.getClientPaymentChoices(input())).choices.length,0);
});
for(const [label,sql] of [['waived',"UPDATE booking_deposit_requirements SET state='waived'"],['equal amounts',"UPDATE booking_deposit_requirements SET required_amount=1000"],['settled',"INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(80,'payment',1000)"],['approval pending',"INSERT INTO appointment_booking_approvals VALUES(201,'pending')"],['cancelled',"UPDATE appointments SET status='cancelled' WHERE id=201"],['package',"INSERT INTO package_session_redemptions VALUES(201,'reserved')"]])test(`canonical eligibility: ${label}`,async t=>{
 const {db,service}=await setup(t);await db.query(sql);const m=await service.getClientPaymentChoices(input());
 assert.equal(m.choices.length,['waived','equal amounts'].includes(label)?1:0);if(label==='waived')assert.equal(m.depositRequired,'500.00');
});
for(const [label,sql] of [
 ['price change',"UPDATE appointments SET total_price=900,updated_at='2026-10-16 09:00:00.123456+00' WHERE id=201"],
 ['microsecond revision',"UPDATE appointments SET updated_at='2026-10-14 08:00:00.000001+00' WHERE id=201"],
 ['waiver',"UPDATE booking_deposit_requirements SET state='waived' WHERE id=90"],
 ['applied eligible credit',"INSERT INTO booking_loyalty_allocations VALUES(80,'applied',100)"],
 ['approval changed',"INSERT INTO appointment_booking_approvals VALUES(201,'pending')"],
 ['cancelled',"UPDATE appointments SET status='cancelled' WHERE id=201"],
 ['no charge',"UPDATE appointments SET financial_classification='no_charge' WHERE id=201"],
 ['package',"INSERT INTO package_session_redemptions VALUES(201,'reserved')"],
 ['expiry',"UPDATE payment_requests SET expires_at='2026-10-16T08:00Z'"],
])test(`issued deposit recovery and public checkout reject exact stale binding: ${label}`,async t=>{
 const {db,service}=await setup(t);const i=await reviewed(service,{choice:'deposit'}),first=await service.collectClientPayment(i);assert.equal(first.status,'ready');
 await db.query(sql);const retry=await service.collectClientPayment(i);assert.equal(retry.status,'needs_review');assert.equal(retry.paymentPath,null);
 assert.equal(await service.validatePaymentCheckout(first.paymentPath.slice(5)),false);
});
test('no-account read review can initialize the canonical account without a stale-review loop',async t=>{
 const {db,service}=await setup(t);await db.query('DELETE FROM booking_deposit_requirement_members;DELETE FROM booking_deposit_requirements;DELETE FROM booking_payment_accounts');
 const i=await reviewed(service);assert.equal((await service.collectClientPayment(i)).status,'ready');
});
test('refund increasing remaining invalidates an earlier smaller full request even though it is below the new balance',async t=>{
 const {db,service}=await setup(t);await db.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount,payer_crm_v2_client_id) VALUES(80,'payment',200,101)");
 const i=await reviewed(service),first=await service.collectClientPayment(i);assert.equal(first.amount,'800.00');
 await service.recordRefund({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:'synthetic_refund_100'});
 assert.equal((await service.collectClientPayment(i)).status,'needs_review');assert.equal(await service.validatePaymentCheckout(first.paymentPath.slice(5)),false);
});

test('verified pending then complete for one transaction records money once; alternate envelope is duplicate; distinct transaction remains distinct money',async t=>{
 const {db,service}=await setup(t);await service.collectClientPayment(await reviewed(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
 assert.equal((await service.handleOzowNotification({...payload(request),Status:'Pending'})).status,'accepted');
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,0);
 assert.equal((await service.handleOzowNotification(payload(request))).status,'paid');
 const alternate=Object.fromEntries(Object.entries(payload(request)).map(([k,v])=>[k.toLowerCase(),v]));alternate.status='Successful';
 assert.equal((await service.handleOzowNotification(alternate)).status,'duplicate');
 assert.equal((await service.handleOzowNotification(payload(request,'SYNTHETIC_SECOND_RECEIPT'))).status,'paid_review_required');
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,2);
});

test('historic staff dpc key and unaudited dpc2 key are unresolved; actual new automatic preparation has transactional provenance',async t=>{
 let calls=0;const {db,service}=await setup(t,{createPaymentLink:async()=>{calls++;throw Error('Must not issue');}});
 for(const [key,admin] of [['dpc_legacy_staff_attempt',2],['dpc2_legacy_staff_attempt',2],['dpc2_missing_positive_audit',null]]){
  await db.query('DELETE FROM payment_requests');await db.query(`INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose,deposit_requirement_id,deposit_member_appointment_id,created_by_admin_id,payer_crm_v2_client_id) VALUES(80,$1,'created',500,'deposit',90,201,$2,101)`,[key,admin]);
  const model=await service.getClientPaymentChoices(input());assert.equal(model.choices.length,0,key);await assert.rejects(service.collectClientPayment({...input(),review:model.review}),{code:'PAYMENT_CHOICE_CHANGED'});assert.equal(calls,0);
 }
 await db.query('DELETE FROM payment_requests');
 const preparedService=serviceFor(db,{createPaymentLink:async()=>{calls++;throw Error('Read preparation must not issue');}},{deposits:{ensureRequirement:async()=>({applicable:true,requirement:{id:90,payment_account_id:80,state:'awaiting',required_amount:'500.00'},members:[{appointment_id:201,required_amount:'500.00'}],scope:{appointmentId:201,members:[{appointmentId:201,crmV2ClientId:101,clientName:'Synthetic',clientMobile:'27810000101'}]}})}});
 const prepared=await preparedService.ensureDepositRequest({appointmentId:201});assert.equal(prepared.requests.length,1);assert.equal(calls,0);
 const {deferredDeposit}=require('../src/services/paymentCollectionGuard');assert.equal(deferredDeposit(prepared.requests[0]),true);assert.equal(deferredDeposit({...prepared.requests[0],created_by_admin_id:2}),false);assert.equal(deferredDeposit({...prepared.requests[0],unissued_provenance:undefined}),false);
 assert.equal((await service.getClientPaymentChoices(input())).choices.length,2);
 assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='payment.deposit_prepared_without_provider'")).rows[0].n,1);
});

test('mixed-client existing explicit payer keeps only the fixed continuation through actual service/projection; other payer gets none',async t=>{
 const {db,service}=await setup(t);await require('./helpers/clientPaymentChoiceFixture').mixedPayer(db);
 const own=await service.getClientPaymentChoices(input());assert.equal(own.continuationPath,'/pay/synthetic_mixed_payer_fixed');assert.equal(own.existingPayment.amount,'500.00');
 for(const key of ['amountDue','remaining','depositRequired','appointments','choices'])assert.equal(own[key],undefined,key);
 assert.equal(await service.validatePaymentCheckout('synthetic_mixed_payer_fixed'),true);
 const other=await service.getClientPaymentChoices(input({appointmentId:203,crmV2ClientId:102,sessionId:1002}));assert.equal(other.continuationPath,undefined);assert.equal(other.existingPayment,undefined);
 await assert.rejects(service.collectClientPayment(input({review:own.review})),{code:'PAYMENT_CHOICE_UNAVAILABLE'});
 const context=require('../src/services/myShilohClientContext').createMyShilohClientContextService({db});
 await db.query('ALTER TABLE clinic_booking_deposit_policy ADD COLUMN rate_basis_points INT DEFAULT 5000');
 const payment=await context.loadPayment({id:201,crmV2ClientId:101});assert.equal(payment.activePaymentPath,'/pay/synthetic_mixed_payer_fixed');
 const projected=require('../src/services/myShilohExperienceOrchestrator').paymentPosition(payment);assert.equal(projected.actionPath,'/my-shiloh/payment?appointment=201');
 const foreign=await context.loadPayment({id:203,crmV2ClientId:102});assert.equal(foreign.activePaymentPath,null);
 const preparation=require('../src/services/myShilohAssistantPreparation').createAssistantPreparation({contextService:{loadUpcomingAppointments:async()=>[{id:201,startsAt:'2099-10-15T08:00:00.000Z',services:['Synthetic own treatment']}]},payments:service});
 const action=await preparation.preparePayment({appointmentStartsAt:'2099-10-15T08:00:00.000Z'},101,SESSION);assert.equal(action.clientAction.href,projected.actionPath);assert.doesNotMatch(JSON.stringify(action.modelResult),/synthetic_mixed_payer_fixed|1500|appointments|"id"/);
});

test('an audit failure rolls automatic preparation back, and historic mixed-prefix staff requests never retry provider issuance',async t=>{
 const {db}=await setup(t);let calls=0;
 const service=serviceFor(db,{createPaymentLink:async()=>{calls++;throw Error('No provider retry');}},{deposits:{ensureRequirement:async()=>({applicable:true,requirement:{id:90,payment_account_id:80,state:'awaiting',required_amount:'500.00'},members:[{appointment_id:201,required_amount:'500.00'}],scope:{appointmentId:201,members:[{appointmentId:201,crmV2ClientId:101,clientName:'Synthetic',clientMobile:'27810000101'}]}})}});
 await db.query("ALTER TABLE crm_audit_events ADD CONSTRAINT synthetic_reject_unissued CHECK(action<>'payment.deposit_prepared_without_provider')");
 await assert.rejects(service.ensureDepositRequest({appointmentId:201}),/synthetic_reject_unissued/);assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_requests')).rows[0].n,0);assert.equal(calls,0);
 await db.query('ALTER TABLE crm_audit_events DROP CONSTRAINT synthetic_reject_unissued');
 for(const key of ['dpm_legacy_staff_unknown','dpm2_legacy_staff_unknown']){
  await db.query(`INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose,deposit_requirement_id,deposit_member_appointment_id,created_by_admin_id,payer_crm_v2_client_id) VALUES(80,$1,'created',500,'deposit',90,201,2,101)`,[key]);
  const result=await service.ensureDepositRequest({appointmentId:201});assert.equal(result.status,'deposit_needs_review');assert.equal(calls,0);await db.query('DELETE FROM payment_requests');
 }
});
