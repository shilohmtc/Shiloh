'use strict';
// Explicit isolated Unix-socket database only. Never consumes DATABASE_URL.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {Pool}=require('pg');
const sourcePaths=['src/services/bookingPayments.js','src/services/myShilohPaymentChoice.js','src/services/paymentCollectionGuard.js','src/services/bookingDepositPolicy.js','src/services/bookingNoCharge.js','src/services/clientTreatmentCredit.js','src/services/myShilohWelcomeVoucher.js','src/services/shilohRewards.js','tests/helpers/clientPaymentChoiceFixture.js','tests/helpers/depositWaiverFixture.js','tests/helpers/priorPaymentFixture.js',__filename];
const sourceBefore=sourcePaths.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));
const {install,serviceFor,input,payload}=require('../tests/helpers/clientPaymentChoiceFixture');
const socket=process.env.CLIENT_PAYMENT_PROOF_SOCKET;
if(!/^\/tmp\/shiloh-client-payment-proof-[A-Za-z0-9_-]+\/socket$/.test(socket||''))throw Error('An explicit isolated proof socket is required.');
const config={host:socket,port:5446,user:'agent',database:'client_payment_proof'};
const admin=new Pool({...config,max:3});let currentPool;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(name,run){
 await admin.query(`CREATE SCHEMA ${name}`);
 const pool=new Pool({...config,max:12,options:`-c search_path=${name},public`});currentPool=pool;
 try{await install(pool);await run(pool);}finally{await pool.end();currentPool=null;}
}
async function review(service,extra={}){const i=input(extra);return {...i,review:(await service.getClientPaymentChoices(i)).review};}
async function waitForAccountLock(){
 for(let n=0;n<150;n++){
  const r=await admin.query(`SELECT pid FROM pg_stat_activity WHERE datname='client_payment_proof'
    AND wait_event_type='Lock' AND query LIKE '%booking_payment_accounts%'`);
  if(r.rowCount)return;await pause(20);
 }assert.fail('Expected actual native booking-account lock wait was not observed');
}
async function group(db){
 await db.query(`INSERT INTO appointment_groups(id,status,final_total,total_price,updated_at,source) VALUES(700,'confirmed',1500,1500,NOW(),'shiloh_my_shiloh_multi');
  INSERT INTO appointment_group_members(group_id,appointment_id,guest_position,allocated_price) VALUES(700,201,1,1000),(700,203,2,500);
  UPDATE booking_payment_accounts SET appointment_id=NULL,appointment_group_id=700,canonical_amount_due=1500 WHERE id=80;
  UPDATE booking_deposit_requirements SET required_amount=750 WHERE id=90;
  INSERT INTO booking_deposit_requirement_members VALUES(90,203,250,500,NULL,'{}');`);
}
async function observedAccountWait(db, operation){
 const hold=await db.connect();await hold.query('BEGIN');await hold.query('SELECT id FROM booking_payment_accounts WHERE id=80 FOR UPDATE');
 const running=operation().then(value=>({value}),error=>({error}));
 try{await waitForAccountLock();await hold.query('COMMIT');return await running;}
 finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();await running;}
}
async function promotionalSchema(db){
 await db.query(`ALTER TABLE crm_v2_clients ADD COLUMN date_of_birth DATE,ADD COLUMN gender TEXT,ADD COLUMN profile_status TEXT;
  UPDATE crm_v2_clients SET date_of_birth='1980-01-01',gender='female',profile_status='registered';
  ALTER TABLE staff ADD COLUMN resource_type TEXT,ADD COLUMN business_role TEXT;
  INSERT INTO staff VALUES(11,'active','practitioner','clinic_practitioner');
  DROP TABLE booking_loyalty_allocations;DROP TABLE booking_welcome_voucher_allocations;`);
 for(const path of ['migrations/140_shiloh_rewards_wallet.sql','migrations/143_my_shiloh_welcome_voucher.sql']){
  const sql=fs.readFileSync(path,'utf8');await db.query(path.includes('140_')?sql.slice(0,sql.indexOf('ALTER TABLE payment_requests')):sql);
 }
 await db.query(`INSERT INTO loyalty_wallets(id,crm_v2_client_id) VALUES(10,101);
  INSERT INTO loyalty_wallet_entries(wallet_id,entry_type,signed_amount,operation_key) VALUES(10,'adjustment',500,'synthetic_existing_reward');
  INSERT INTO my_shiloh_welcome_vouchers(crm_v2_client_id,amount,minimum_booking_value,issued_at,expires_at) VALUES(101,100,450,'2026-10-01','2026-11-30');`);
}
async function financialMatrix(){
 const {createClientTreatmentCreditService,TreatmentCreditError}=require('../src/services/clientTreatmentCredit');
 const {createShilohRewardsService,ShilohRewardsError}=require('../src/services/shilohRewards');
 const {createMyShilohWelcomeVoucherService,MyShilohWelcomeVoucherError}=require('../src/services/myShilohWelcomeVoucher');
 const {priorInput}=require('../tests/helpers/priorPaymentFixture');
 const {input:waiverInput}=require('../tests/helpers/depositWaiverFixture');
 const {SESSION}=require('../tests/helpers/clientPaymentChoiceFixture');
 await fixture('credit_apply_and_undo',async db=>{
  const credit=createClientTreatmentCreditService({db}),service=serviceFor(db);
  await credit.issue({adminId:2,clientId:101,amount:'200',creditType:'goodwill',reason:'Synthetic existing credit',operationId:crypto.randomUUID()});
  await assert.rejects(credit.apply({adminId:2,clientId:101,appointmentId:201,amount:'100',operationId:crypto.randomUUID()}),{code:'CREDIT_TREATMENT_INCOMPLETE'});
  await db.query("UPDATE appointments SET status='completed' WHERE id=201;UPDATE booking_deposit_requirements SET state='satisfied'");
  const applied=await credit.apply({adminId:2,clientId:101,appointmentId:201,amount:'100',operationId:crypto.randomUUID()});
  await db.query("UPDATE appointments SET status='confirmed' WHERE id=201;UPDATE booking_deposit_requirements SET state='awaiting'");
  const prepared=await review(service);assert.equal((await service.getClientPaymentChoices(input())).remaining,'900.00');await service.collectClientPayment(prepared);
  const undo=await observedAccountWait(db,()=>credit.undo({adminId:2,clientId:101,sourceEntryId:applied.entry.id,amount:'100',reviewed:true,reason:'Synthetic correction',operationId:crypto.randomUUID()}));
  assert.equal(undo.error.code,'CREDIT_OPEN_PAYMENT');assert.ok(undo.error instanceof TreatmentCreditError);
  await db.query("UPDATE appointments SET status='completed' WHERE id=201");
  const blocked=await observedAccountWait(db,()=>credit.apply({adminId:2,clientId:101,appointmentId:201,amount:'50',operationId:crypto.randomUUID()}));
  assert.equal(blocked.error.code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');assert.equal(blocked.error.httpStatus,409);assert.ok(blocked.error instanceof TreatmentCreditError);
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
  assert.equal((await db.query("SELECT -SUM(signed_amount) AS amount FROM treatment_credit_entries WHERE entry_type IN ('apply','undo')")).rows[0].amount,'100.00');
 });
 await fixture('gift_credit_account',async db=>{
  const {createBookingNoncashSettlementService}=require('../src/services/bookingNoncashSettlement');
  const gift=createBookingNoncashSettlementService({db}),service=serviceFor(db);
  const data={adminId:2,clientId:101,appointmentId:201,voucherCode:'SV-AAAAAAAAAAAA',amount:'100',operationId:crypto.randomUUID()};
  await assert.rejects(gift.applyGift(data),{code:'CREDIT_TREATMENT_INCOMPLETE'});
  await db.query("UPDATE appointments SET status='completed' WHERE id=201;UPDATE booking_deposit_requirements SET state='satisfied'");
  const first=await observedAccountWait(db,()=>gift.applyGift(data));assert.equal(first.value.status,'applied');
  await db.query("UPDATE appointments SET status='confirmed' WHERE id=201;UPDATE booking_deposit_requirements SET state='awaiting'");
  assert.equal((await service.getClientPaymentChoices(input())).remaining,'900.00');await service.collectClientPayment(await review(service));
  await db.query("UPDATE appointments SET status='completed' WHERE id=201");
  const blocked=await observedAccountWait(db,()=>gift.applyGift({...data,operationId:crypto.randomUUID()}));assert.equal(blocked.error.code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');
  assert.equal((await db.query('SELECT balance::text AS amount FROM gift_vouchers WHERE id=401')).rows[0].amount,'400.00');
 });
 console.log('PASS actual gift-voucher settlement shares observed account wait and completed-treatment/active-attempt guards, preserving voucher value.');
 console.log('PASS actual treatment-credit issue/apply/undo: no early redemption; observed account waits and typed active-attempt conflicts; verified arrival retained.');
 for(const kind of ['rewards','welcome'])await fixture(`${kind}_matrix`,async db=>{
  await promotionalSchema(db);const service=serviceFor(db);
  const rewards=createShilohRewardsService({db}),welcome=createMyShilohWelcomeVoucherService({db,now:()=>new Date('2026-10-16T09:00Z')});
  const apply=()=>kind==='rewards'?rewards.applyCredit({crmV2ClientId:101,clientSessionId:SESSION,appointmentId:201,amount:'100',operationId:crypto.randomUUID()}):welcome.applyToBooking({crmV2ClientId:101,sessionId:SESSION,appointmentId:201,operationId:crypto.randomUUID()});
  const first=await observedAccountWait(db,apply);assert.equal(first.value?.status,'applied');
  const i=await review(service);assert.equal((await service.getClientPaymentChoices(input())).remaining,'900.00');await service.collectClientPayment(i);
  if(kind==='welcome')await db.query("UPDATE my_shiloh_welcome_vouchers SET state='available',redeemed_at=NULL;DELETE FROM booking_welcome_voucher_allocations");
  const blocked=await observedAccountWait(db,apply);assert.equal(blocked.error.code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');assert.equal(blocked.error.httpStatus,409);
  assert.ok(blocked.error instanceof (kind==='rewards'?ShilohRewardsError:MyShilohWelcomeVoucherError));
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
  if(kind==='rewards'){
    await db.query("UPDATE appointments SET status='cancelled' WHERE id=201");
    const reversed=await observedAccountWait(db,()=>rewards.syncCancelledRedemptions());assert.equal(reversed.value.reversed,1);
    assert.equal((await db.query("SELECT SUM(signed_amount) AS amount FROM loyalty_wallet_entries WHERE wallet_id=10")).rows[0].amount,'500.00');
    assert.equal((await rewards.syncCancelledRedemptions()).reversed,0);
  }
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
 });
 console.log('PASS actual Rewards application and cancellation reversal, plus welcome entrypoints: observed account waits, applied value deducted before choice; later attempt guards typed409 and preserve money.');
 await fixture('prior_apply_callback',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));
  const applied=await observedAccountWait(db,()=>service.recordPrior(priorInput({amount:'1000'})));assert.equal(applied.value.status,'applied');
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
  assert.equal((await db.query("SELECT SUM(amount) AS amount FROM payment_ledger_entries WHERE entry_type='payment'")).rows[0].amount,'1000.00');
 });
 await fixture('prior_reverse_callback',async db=>{
  const service=serviceFor(db),prior=await service.recordPrior(priorInput({amount:'200'}));await service.collectClientPayment(await review(service));
  const reversed=await observedAccountWait(db,()=>service.reversePrior({adminId:2,appointmentId:201,entryId:prior.entry.id,reason:'Synthetic evidence correction',reviewed:true,operationId:crypto.randomUUID()}));assert.equal(reversed.value.status,'reversed');
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
 });
 console.log('PASS actual prior-evidence apply/reversal observed account waits, stale fixed links rejected and subsequent actual receipts retained.');
 await fixture('refund_callback',async db=>{
  const service=serviceFor(db);await service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:crypto.randomUUID()});
  await service.collectClientPayment(await review(service));
  const refunded=await observedAccountWait(db,()=>service.recordRefund({adminId:2,appointmentId:201,amount:'50',method:'cash',operationId:crypto.randomUUID()}));assert.equal(refunded.value.status,'refunded');
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
  assert.equal((await db.query("SELECT SUM(amount) AS amount FROM payment_ledger_entries WHERE entry_type='refund'")).rows[0].amount,'50.00');
 });
 await fixture('waiver_callback',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service,{choice:'deposit'}));
  const waived=await observedAccountWait(db,()=>service.recordDepositWaiver(waiverInput()));assert.equal(waived.value.status,'waived');
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
  assert.equal((await db.query('SELECT required_amount::text AS amount,state FROM booking_deposit_requirements')).rows[0].amount,'500.00');
  assert.equal((await db.query("SELECT SUM(amount) AS amount FROM payment_ledger_entries WHERE entry_type='payment'")).rows[0].amount,'500.00');
 });
 await fixture('no_charge_callback',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));
  await db.query("UPDATE appointments SET status='completed' WHERE id=201");
  const free=await observedAccountWait(db,()=>service.recordNoCharge({adminId:2,appointmentId:201,expectedRevision:'2026-10-14T08:00:00.000Z',reason:'Synthetic no-charge authority',reviewed:true,operationId:crypto.randomUUID()}));assert.equal(free.value.status,'no_charge_recorded');
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid_review_required');
 });
 console.log('PASS actual No charge entrypoint observed account wait; old fixed link blocked and later verified receipt retained for existing No charge review.');
 console.log('PASS actual refund/waiver entrypoints observed account waits; stale checkout denied, late provider cash retained, deposit unchanged and no fabricated refund.');
}

async function main(){
 await financialMatrix();
 await fixture('background_scope_claim',async db=>{
  const member={appointmentId:201,crmV2ClientId:101,clientName:'Synthetic Client',clientMobile:'27810000101'};
  const service=serviceFor(db,{}, {deposits:{ensureRequirement:async()=>({applicable:true,requirement:{id:90,payment_account_id:80,state:'awaiting',required_amount:'500.00'},members:[{appointment_id:201,required_amount:'500.00'}],scope:{appointmentId:201,members:[member]}})}});
  const prepared=await observedAccountWait(db,()=>service.ensureDepositRequest({appointmentId:201}));assert.equal(prepared.value.requests.length,1);
  const row=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.match(row.request_key,/^dpc2_/);assert.equal(row.state,'created');assert.equal(row.provider_payment_url,null);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='payment.deposit_prepared_without_provider'")).rows[0].n,1);
  assert.equal((await service.getClientPaymentChoices(input())).choices.length,2);
  await service.collectClientPayment(await review(service));
  const blocked=await observedAccountWait(db,()=>service.ensureDepositRequest({appointmentId:201}));assert.equal(blocked.error.code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');
 });
 console.log('PASS actual background deposit entrypoint observed account wait, positively unissued preparation and active-client-attempt guard.');
 await fixture('historic_prefix_not_proof',async db=>{
  let calls=0;const service=serviceFor(db,{createPaymentLink:async()=>{calls++;throw Error('Historic attempt must not reissue');}});
  for(const key of ['dpc_historic_staff_operation','dpc2_historic_staff_operation','dpm_historic_staff_operation','dpm2_historic_staff_operation']){
   await db.query('DELETE FROM payment_requests');await db.query(`INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose,deposit_requirement_id,deposit_member_appointment_id,created_by_admin_id,payer_crm_v2_client_id) VALUES(80,$1,'created',500,'deposit',90,201,2,101)`,[key]);
   const i=await review(service);assert.equal((await service.getClientPaymentChoices(input())).choices.length,0);await assert.rejects(service.collectClientPayment(i),{code:'PAYMENT_CHOICE_CHANGED'});
  }assert.equal(calls,0);
 });
 console.log('PASS historic staff operation prefixes never prove non-issuance; no competing client collection or blind provider retry.');
 await fixture('pending_then_paid',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
  assert.equal((await service.handleOzowNotification({...payload(request),Status:'Pending'})).status,'accepted');
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid');
  assert.equal((await service.handleOzowNotification({...payload(request),Status:'Successful'})).status,'duplicate');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,1);
 });
 console.log('PASS actual pending then successful notification for one transaction settles exactly once across status/envelope variants.');
 await fixture('choice_before_issuance',async db=>{
  let calls=0,entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  const service=serviceFor(db,{createPaymentLink:async()=>{calls++;entered();await gate;return {providerRequestId:'NATIVE_ONE',paymentUrl:'https://pay.ozow.com/NATIVE_ONE'};}});
  const i=await review(service);const first=service.collectClientPayment(i);let staff,other;
  try{
   await started;
   other=await service.collectClientPayment({...i,choice:'deposit',operationId:'native_other_choice_0001'}).then(()=>null,e=>e);
   assert.equal(other.code,'PAYMENT_CHOICE_BUSY');
   staff=await service.createOzowRequest({adminId:2,appointmentId:201,amount:'500',payerConfirmed:true,operationId:'native_staff_competing'}).then(()=>null,e=>e);
   assert.equal(staff.code,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED');
   const durable=(await db.query('SELECT state,provider_payment_url FROM payment_requests')).rows[0];assert.equal(durable.state,'pending');assert.equal(durable.provider_payment_url,null);
  }finally{release();}
  assert.equal((await first).status,'ready');assert.equal((await service.collectClientPayment(i)).status,'ready');
  assert.equal((await service.collectClientPayment({...i,operationId:'native_same_other_tab_001'})).status,'ready');assert.equal(calls,1);
 });
 console.log('PASS durable claim, different-choice and direct-staff guard, same-operation/tab recovery; one provider mock call.');
 await fixture('manual_wins',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
  const hold=await db.connect();await hold.query('BEGIN');await hold.query('SELECT id FROM booking_payment_accounts WHERE id=80 FOR UPDATE');
  const manual=service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:'native_manual_actual_100'});
  let callback;
  try{await waitForAccountLock();callback=service.handleOzowNotification(payload(request));await hold.query('COMMIT');}
  finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
  assert.equal((await manual).status,'recorded');assert.equal((await callback).status,'paid_review_required');
  assert.equal((await db.query("SELECT SUM(amount)::text AS amount FROM payment_ledger_entries WHERE entry_type='payment'")).rows[0].amount,'1100.00');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_ledger_entries WHERE entry_type='refund'")).rows[0].n,0);
  assert.equal(await service.validatePaymentCheckout(request.request_key),false);
 });
 console.log('PASS observed native account wait; manual receipt then provider arrival retains1100 and flags review without refund.');
 await fixture('provider_wins',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
  const hold=await db.connect();await hold.query('BEGIN');await hold.query('SELECT id FROM booking_payment_accounts WHERE id=80 FOR UPDATE');
  const callback=service.handleOzowNotification(payload(request));let manual;
  try{await waitForAccountLock();manual=service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:'native_manual_prospective'}).then(v=>v,e=>e);await hold.query('COMMIT');}
  finally{await hold.query('ROLLBACK').catch(()=>{});hold.release();}
  assert.equal((await callback).status,'paid');assert.equal((await manual).code,'PAYMENT_EXCEEDS_OUTSTANDING');
  assert.equal((await db.query("SELECT SUM(amount)::text AS amount FROM payment_ledger_entries WHERE entry_type='payment'")).rows[0].amount,'1000.00');
  const alternate=Object.fromEntries(Object.entries(payload(request)).map(([k,v])=>[k.toLowerCase(),v]));alternate.statusmessage='same verified transaction, alternate field envelope';
  assert.equal((await service.handleOzowNotification(alternate)).status,'duplicate');
  assert.equal((await service.handleOzowNotification(payload(request,'NATIVE_DISTINCT_REAL_RECEIPT'))).status,'paid_review_required');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,2);
 });
 console.log('PASS provider-first account serialization blocks prospective collection; equivalent envelope replays once, distinct verified money retained.');
 await fixture('group_order',async db=>{
  await group(db);let calls=0;const service=serviceFor(db,{createPaymentLink:async()=>{calls++;return {providerRequestId:'NATIVE_GROUP',paymentUrl:'https://pay.ozow.com/NATIVE_GROUP'};}});
  const a=await review(service),b=await review(service,{appointmentId:203,operationId:'native_group_entry_203'});
  assert.equal(a.review,b.review);
  const results=await Promise.all([service.recordManual({adminId:2,appointmentId:201,amount:'100',method:'cash',operationId:'native_member_201_cash'}),service.recordManual({adminId:2,appointmentId:203,amount:'100',method:'cash',operationId:'native_member_203_cash'})]);
  assert.ok(results.every(r=>r.status==='recorded'));
  const fresh=await review(service);assert.equal((await service.collectClientPayment(fresh)).status,'ready');
  assert.equal((await service.collectClientPayment({...fresh,appointmentId:203,operationId:'native_group_other_tab'})).status,'ready');assert.equal(calls,1);
  await db.query('UPDATE appointments SET crm_v2_client_id=102 WHERE id=203');
  const hidden=await service.getClientPaymentChoices(input());assert.equal(hidden.reason,'shared_scope');assert.equal(hidden.remaining,undefined);assert.equal(hidden.appointments,undefined);
  const request=(await db.query('SELECT * FROM payment_requests')).rows[0];assert.equal(await service.validatePaymentCheckout(request.request_key),false);
 });
 console.log('PASS distinct group-member staff entrypoints serialize without deadlock; all-owned full scope and changed-member privacy fail closed.');
 await fixture('no_account',async db=>{
  await db.query('DELETE FROM booking_deposit_requirement_members;DELETE FROM booking_deposit_requirements;DELETE FROM booking_payment_accounts');
  const service=serviceFor(db),i=await review(service);assert.equal((await service.collectClientPayment(i)).status,'ready');
 });
 console.log('PASS no-account read review survives canonical account initialization without endless stale rejection.');
 await fixture('full_deposit_policy',async db=>{
  const service=serviceFor(db);await service.collectClientPayment(await review(service));const request=(await db.query('SELECT * FROM payment_requests')).rows[0];
  assert.equal((await service.handleOzowNotification(payload(request))).status,'paid');
  await db.query(`INSERT INTO appointment_status_history(appointment_id,to_status,changed_at)
    SELECT 201,'cancelled',starts_at-interval '48 hours' FROM appointments WHERE id=201
    UNION ALL SELECT 201,'cancelled',starts_at-interval '24 hours' FROM appointments WHERE id=201
    UNION ALL SELECT 201,'cancelled',starts_at-interval '23 hours 59 minutes' FROM appointments WHERE id=201
    UNION ALL SELECT 201,'no_show',starts_at FROM appointments WHERE id=201;`);
  const events=(await db.query('SELECT member_required_amount,policy_forfeit_amount FROM booking_deposit_policy_events ORDER BY id')).rows;
  assert.deepEqual(events.map(x=>[String(x.member_required_amount),String(x.policy_forfeit_amount)]),[['500.00','0.00'],['500.00','250.00'],['500.00','500.00'],['500.00','500.00']]);
  assert.equal((await db.query('SELECT required_amount::text AS amount,state FROM booking_deposit_requirements')).rows[0].amount,'500.00');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM payment_ledger_entries WHERE entry_type='refund'")).rows[0].n,0);
 });
 console.log('PASS canonical cancellation trigger: full1000 receipt retains deposit500 base and 48h/24h/late/no-show0/250/500/500; no refund.');
 assert.deepEqual(sourcePaths.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),sourceBefore,'Proof source changed while the native test process was running');
 console.log(JSON.stringify({sourceUnchangedDuringProof:true,source:sourceBefore}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(currentPool)await currentPool.end();await admin.end();console.log('Pool cleanup completed before this receipt.');});
