'use strict';
const { install:installWaiver } = require('./depositWaiverFixture');
const { createBookingPaymentService } = require('../../src/services/bookingPayments');
const { createBookingDepositPolicyService } = require('../../src/services/bookingDepositPolicy');
const SESSION = 1001;
async function install(db) {
  await installWaiver(db);
  await db.query(`ALTER TABLE payment_requests ADD COLUMN created_by_admin_id BIGINT;
    ALTER TABLE payment_requests ALTER COLUMN state SET DEFAULT 'created';
    ALTER TABLE appointment_group_members ADD COLUMN allocated_price NUMERIC(12,2);
    CREATE UNIQUE INDEX synthetic_member_deposit ON payment_requests(deposit_requirement_id,deposit_member_appointment_id) WHERE purpose='deposit' AND deposit_requirement_id IS NOT NULL AND deposit_member_appointment_id IS NOT NULL;
    CREATE UNIQUE INDEX synthetic_payment_request_key ON payment_requests(request_key);
    CREATE UNIQUE INDEX synthetic_provider_event ON payment_provider_events(provider,provider_event_key);
    CREATE UNIQUE INDEX synthetic_provider_money ON payment_ledger_entries(method,provider_transaction_id,entry_type);
    ALTER TABLE booking_payment_accounts ADD CONSTRAINT synthetic_one_subject CHECK((appointment_id IS NOT NULL)::int+(appointment_group_id IS NOT NULL)::int=1);
    CREATE UNIQUE INDEX synthetic_one_group_member ON appointment_group_members(appointment_id);
    CREATE TABLE client_browser_sessions(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT,revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ);
    INSERT INTO client_browser_sessions VALUES('${SESSION}',101,NULL,'2099-12-01');
    DELETE FROM payment_requests; DELETE FROM payment_ledger_entries;
    UPDATE appointments SET total_price=1000 WHERE id=201;
    UPDATE booking_payment_accounts SET canonical_amount_due=1000 WHERE id=80;
    UPDATE booking_deposit_requirements SET required_amount=500 WHERE id=90;
    UPDATE booking_deposit_requirement_members SET required_amount=500,eligible_amount=1000 WHERE requirement_id=90;`);
}
function serviceFor(db, provider = {}, overrides = {}) {
  const deposits = createBookingDepositPolicyService({db});
  return createBookingPaymentService({ db, now:()=>new Date('2026-10-16T09:00Z'),
    ozow:{configured:()=>true,createPaymentLink:async()=>({providerRequestId:'SYNTHETIC_PROVIDER',paymentUrl:'https://pay.ozow.com/SYNTHETIC'}),verifyNotification:()=>true,...provider},
    rewards:{syncEligibleEarnings:async()=>{}},
    deposits:{ensureRequirement:async()=>({applicable:false}),getPosition:async({appointmentId})=>{
      const requirement=(await db.query(`SELECT r.* FROM booking_deposit_requirements r JOIN booking_payment_accounts bpa ON bpa.id=r.payment_account_id
        WHERE bpa.appointment_id=$1 OR EXISTS(SELECT 1 FROM appointment_group_members gm WHERE gm.group_id=bpa.appointment_group_id AND gm.appointment_id=$1)`,[appointmentId])).rows[0];
      const synced=await deposits.syncState(db,requirement);return {requirement:synced,scope:{members:[]}};
    }},confirmBooking:async()=>{},...overrides });
}
function input(overrides={}) { return {crmV2ClientId:101,sessionId:SESSION,appointmentId:201,operationId:'synthetic_operation_0001',choice:'full',confirmed:true,...overrides}; }
const payload = (request, transaction = 'SYNTHETIC_TXN') => ({TransactionId:transaction,TransactionReference:request.request_key,Status:'Complete',Amount:String(request.amount),CurrencyCode:'ZAR'});
async function mixedPayer(db){
 await db.query(`INSERT INTO appointment_groups(id,status,final_total,total_price,updated_at,source) VALUES(700,'confirmed',1500,1500,'2026-10-14T08:00Z','shiloh_my_shiloh_couples');
  INSERT INTO appointment_group_members(group_id,appointment_id,guest_position,allocated_price) VALUES(700,201,1,1000),(700,203,2,500);
  UPDATE appointments SET crm_v2_client_id=102 WHERE id=203;
  UPDATE booking_payment_accounts SET appointment_id=NULL,appointment_group_id=700,canonical_amount_due=1500 WHERE id=80;
  UPDATE booking_deposit_requirements SET required_amount=750 WHERE id=90;
  INSERT INTO booking_deposit_requirement_members VALUES(90,203,250,500,NULL,'{}');
  INSERT INTO client_browser_sessions VALUES(1002,102,NULL,'2099-12-01');
  INSERT INTO payment_requests(payment_account_id,request_key,state,amount,purpose,deposit_requirement_id,deposit_member_appointment_id,payer_crm_v2_client_id,payer_mobile,provider_payment_url)
  VALUES(80,'synthetic_mixed_payer_fixed','link_issued',500,'deposit',90,201,101,'27810000101','https://pay.ozow.com/SYNTHETIC_MIXED');`);
}
module.exports={install,serviceFor,input,payload,SESSION,mixedPayer};
