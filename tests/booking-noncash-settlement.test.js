'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createBookingNoncashSettlementService}=require('../src/services/bookingNoncashSettlement');
const {createClientTreatmentCreditService,remainingTreatmentCents}=require('../src/services/clientTreatmentCredit');
const {GIFT_APPLICATIONS_SQL}=require('../src/services/workspaceFinancialReports');
const {renderCalendarPaymentPage,calendarPaymentsClientScript}=require('../src/presentation/calendarPaymentsUx');
async function setup(t){const pg=new PGlite();t.after(()=>pg.close());await pg.exec(fs.readFileSync('tests/fixtures/treatment-credit-schema.sql','utf8'));await pg.exec(fs.readFileSync('migrations/188_client_treatment_credit.sql','utf8'));const db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};return {pg,gift:createBookingNoncashSettlementService({db}),credit:createClientTreatmentCreditService({db})};}
const apply=overrides=>({adminId:2,clientId:101,appointmentId:201,voucherCode:'SV-AAAAAAAAAAAA',amount:'100',operationId:randomUUID(),...overrides});
const issue=()=>({adminId:1,clientId:101,amount:'500',creditType:'service_exchange',reason:'Synthetic supplier exchange',reference:'SYNTHETIC-INVOICE-101',operationId:randomUUID()});
test('partial gift plus treatment credit leaves only actual-money remainder, with distinct evidence and exact retries',async t=>{
 const {pg,gift,credit}=await setup(t);await credit.issue(issue());const input=apply();const result=await gift.applyGift(input);assert.equal(result.outstanding,550);assert.equal(result.balance,400);
 assert.equal((await gift.applyGift(input)).status,'idempotent_replay');
 for(const change of [{amount:'101'},{appointmentId:202},{voucherCode:'SV-CCCCCCCCCCCC'},{adminId:1}])await assert.rejects(gift.applyGift({...input,...change}),{code:'VOUCHER_RETRY_MISMATCH'});
 const used=await credit.apply({adminId:2,clientId:101,appointmentId:201,amount:'200',operationId:randomUUID()});assert.equal(used.outstanding,350);
 const account=(await pg.query('SELECT * FROM booking_payment_accounts WHERE appointment_id=201')).rows[0];
 await pg.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',350)",[account.id]);assert.equal(await remainingTreatmentCents(pg,account),0);
 assert.equal(Number((await pg.query('SELECT SUM(amount) AS n FROM payment_ledger_entries')).rows[0].n),350);
 assert.equal(Number((await pg.query('SELECT SUM(amount) AS n FROM booking_gift_voucher_allocations')).rows[0].n),100);
 assert.equal(Number((await pg.query("SELECT -SUM(signed_amount) AS n FROM treatment_credit_entries WHERE entry_type='apply'")).rows[0].n),200);
 const report=(await pg.query(GIFT_APPLICATIONS_SQL,['2000-01-01','2100-01-01'])).rows;assert.equal(report.length,1);assert.equal(Number(report[0].amount),100);assert.equal(Number(report[0].appointment_id),201);assert.equal(report[0].actor_name,'Synthetic Reception');
 await assert.rejects(pg.query('DELETE FROM booking_gift_voucher_allocations'),/immutable/);
});
test('booking voucher use fails closed for invalid/expired/unowned/unpaid/unlinked/unverified and insufficient values',async t=>{
 const {pg,gift}=await setup(t);
 for(const [input,code] of [[{voucherCode:'bad'},'VOUCHER_INVALID_CODE'],[{voucherCode:'SV-BBBBBBBBBBBB'},'VOUCHER_EXPIRED'],[{voucherCode:'SV-CCCCCCCCCCCC'},'VOUCHER_NOT_OWNED'],[{voucherCode:'SV-DDDDDDDDDDDD'},'VOUCHER_NOT_ACTIVE'],[{amount:'501'},'VOUCHER_EXCEEDS_BALANCE'],[{amount:'1.001'},'VOUCHER_INVALID_AMOUNT']])await assert.rejects(gift.applyGift(apply(input)),{code});
 await pg.query('UPDATE gift_vouchers SET recipient_crm_v2_client_id=NULL WHERE id=401');await assert.rejects(gift.applyGift(apply()),{code:'VOUCHER_NOT_OWNED'});
 await pg.query('UPDATE gift_vouchers SET recipient_crm_v2_client_id=101 WHERE id=401');await pg.query('UPDATE crm_v2_clients SET mobile_verified_at=NULL WHERE id=101');await assert.rejects(gift.applyGift(apply()),{code:'VOUCHER_NOT_OWNED'});
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM gift_voucher_ledger_entries')).rows[0].n,0);assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM crm_audit_events')).rows[0].n,0);
});
test('voucher permissions are current on every write/replay; list is read-only and never links ownership',async t=>{
 const {pg,gift}=await setup(t);await assert.rejects(gift.applyGift(apply({adminId:3})),{code:'VOUCHER_FORBIDDEN'});
 const available=await gift.getAvailable({adminId:2,clientId:101});assert.deepEqual(available.vouchers.map(v=>v.voucher_code),['SV-AAAAAAAAAAAA']);
 const input=apply();await gift.applyGift(input);await pg.query("UPDATE staff_admin_accounts SET permissions=permissions-'voucher:redeem' WHERE id=2");await assert.rejects(gift.applyGift(input),{code:'VOUCHER_FORBIDDEN'});assert.equal((await gift.getAvailable({adminId:2,clientId:101})).canApply,false);
 await pg.query("UPDATE staff_admin_accounts SET calendar_scope='self' WHERE id=1");await assert.rejects(gift.applyGift(apply({adminId:1})),{code:'VOUCHER_FORBIDDEN'});
});
test('deposit, future, cancelled, mixed-client group and open-link guards are shared; no automatic gift return',async t=>{
 const {pg,gift}=await setup(t);
 await assert.rejects(gift.applyGift(apply({appointmentId:203})),{code:'CREDIT_TREATMENT_INCOMPLETE'});
 await pg.exec("INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,650,'ZAR',NOW()); INSERT INTO booking_deposit_requirements(payment_account_id,state) VALUES(100,'awaiting')");await assert.rejects(gift.applyGift(apply()),{code:'CREDIT_DEPOSIT_REQUIRED'});
 await pg.exec("UPDATE booking_deposit_requirements SET state='satisfied'; INSERT INTO payment_requests(payment_account_id,state) VALUES(100,'pending')");await assert.rejects(gift.applyGift(apply()),{code:'CREDIT_OPEN_PAYMENT'});
 await pg.query("UPDATE payment_requests SET state='cancelled'");const input=apply();await gift.applyGift(input);
 await pg.query("UPDATE appointments SET status='cancelled' WHERE id=201");assert.equal((await gift.applyGift(input)).status,'idempotent_replay');await assert.rejects(gift.applyGift(apply()),{code:'CREDIT_TREATMENT_INCOMPLETE'});
 await pg.query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(100,'payment',50),(100,'refund',50)");assert.equal(Number((await pg.query('SELECT balance FROM gift_vouchers WHERE id=401')).rows[0].balance),400);assert.equal((await pg.query('SELECT state FROM booking_deposit_requirements')).rows[0].state,'satisfied');
 await pg.exec("UPDATE appointments SET status='completed' WHERE id=201;INSERT INTO appointment_groups VALUES(50,'completed',1300,1300,NOW());INSERT INTO appointment_group_members VALUES(50,201),(50,204)");await assert.rejects(gift.applyGift(apply()),{code:'CREDIT_GROUP_REVIEW'});
});
test('cash and other noncash cap gift use; credit return reopens only its applied amount and leaves voucher untouched',async t=>{
 const {pg,gift,credit}=await setup(t);await credit.issue(issue());await gift.applyGift(apply({amount:'300'}));const used=await credit.apply({adminId:2,clientId:101,appointmentId:201,amount:'300',operationId:randomUUID()});assert.equal(used.outstanding,50);
 await assert.rejects(gift.applyGift(apply({amount:'51'})),{code:'VOUCHER_EXCEEDS_TREATMENT'});
 await credit.undo({adminId:2,clientId:101,sourceEntryId:used.entry.id,amount:'100',reason:'Synthetic reviewed correction',reviewed:true,operationId:randomUUID()});assert.equal(Number((await pg.query('SELECT balance FROM gift_vouchers WHERE id=401')).rows[0].balance),200);
 assert.equal((await gift.applyGift(apply({amount:'150'}))).outstanding,0);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,0);
});
test('payment surface shows distinct noncash choices/preview/history and keeps cash methods and deposit restrictions',()=>{
 const model={subject:{appointmentId:201,crmV2ClientId:101,status:'completed'},authority:{canCollect:true,ozowConfigured:false},payment:{amountDue:'650',netPaid:'50',rewardsApplied:0,treatmentCreditApplied:'100',giftVoucherApplied:'200',outstanding:'300',state:'partially_paid',requests:[],entries:[],noncashEntries:[{kind:'gift_voucher',id:1,action:'apply',amount:200,reason:'Voucher ending <AAAA>',actor:'Synthetic Reception',created_at:'2026-10-08T08:00Z'}]},noncash:{eligible:true,credit:{canApply:true,balance:350},gift:{canApply:true,vouchers:[{voucher_code:'SV-AAAAAAAAAAAA',balance:300,valid_until:null}]}}};
 const html=renderCalendarPaymentPage({model});assert.match(html,/Use voucher/);assert.match(html,/Use credit/);assert.match(html,/data-noncash-preview/);assert.match(html,/Gift voucher used \(noncash\)/);assert.match(html,/Voucher ending &lt;AAAA&gt;/);
 assert.match(html,/name="method" value="card_machine"/);assert.match(html,/data-payment-method/);assert.doesNotMatch(html,/<select name="method">/);
 assert.doesNotMatch(renderCalendarPaymentPage({model:{...model,noncash:{eligible:false}}}),/data-booking-noncash=/);
 new(require('node:vm').Script)(calendarPaymentsClientScript());
});
test('both booking noncash routes enforce browser session, origin and CSRF, and own actor/target',async t=>{
 const express=require('express'),{once}=require('node:events'),{createCalendarPaymentsRouter}=require('../src/routes/calendarPayments');let writes=0,reads=0;
 const app=express();app.use(express.json());const action=async input=>{assert.equal(input.adminId,2);assert.equal(input.appointmentId,'201');writes++;return {status:'applied'};};
 app.use('/calendar/payments',createCalendarPaymentsRouter({env:{},sessionService:{async validateSessionToken(token){return token==='test'?{ok:true,adminId:2}:{ok:false};},validateCsrfToken:(_session,token)=>token==='valid'},service:{async get(input){assert.equal(input.adminId,2);assert.equal(input.appointmentId,'201');reads++;return {};}},creditService:{apply:action},giftSettlementService:{applyGift:action}}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const origin=`http://127.0.0.1:${server.address().port}`,headers={Cookie:'shiloh_staff_session=test',Origin:origin,'Content-Type':'application/json','X-Shiloh-CSRF-Token':'valid'};
 for(const action of ['client-credit','gift-voucher']){const post=custom=>fetch(`${origin}/calendar/payments/appointments/201/${action}`,{method:'POST',headers:custom,body:JSON.stringify({adminId:1,appointmentId:999})});const before=writes;assert.equal((await post({...headers,Cookie:''})).status,401);assert.equal((await post({...headers,Origin:'https://other.test'})).status,403);assert.equal((await post({...headers,'X-Shiloh-CSRF-Token':'wrong'})).status,403);assert.equal(writes,before);const response=await post(headers);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);}
 assert.equal(writes,2);assert.equal(reads,2);
});
