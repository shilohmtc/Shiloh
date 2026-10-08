'use strict';
const { createHash } = require('node:crypto');
const { pool } = require('../db/pool');
const { resolveCalendarAuthority, hasCapability } = require('./calendarAuthorization');
const { operation, text } = require('../domain/workspaceFinancialRecords');
const { voucherAmount, GiftVoucherError, assertGiftVoucherUsable, consumeGiftVoucherValue } = require('./giftVouchers');
const { voucherExpiryTimestamp } = require('../lib/voucherDate');
const { lockCompletedTreatmentAccount, remainingTreatmentCents } = require('./clientTreatmentCredit');
function positiveId(value) { const result=Number(value); if (!Number.isSafeInteger(result)||result<=0) throw new GiftVoucherError('VOUCHER_INVALID_TARGET','Choose a valid client and treatment.'); return result; }
function normalizedGift(input) {
  try {
    const data={adminId:positiveId(input.adminId),clientId:positiveId(input.clientId),appointmentId:positiveId(input.appointmentId),amount:voucherAmount(input.amount),operationId:operation(input.operationId),voucherCode:String(input.voucherCode||'').trim().toUpperCase(),notes:text(input.notes||'',240,false)};
    if (!/^SV-[A-F0-9]{12}$/.test(data.voucherCode)) throw new GiftVoucherError('VOUCHER_INVALID_CODE','Choose a valid Shiloh gift voucher.');
    data.fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex'); return data;
  } catch(error) { if(error instanceof GiftVoucherError)throw error; throw new GiftVoucherError('VOUCHER_INVALID_INPUT',error.message); }
}
function createBookingNoncashSettlementService({db=pool,authorityResolver=resolveCalendarAuthority}={}) {
  async function requireAccess(queryable,adminId,write=false) {
    const id=positiveId(adminId);
    if(write)await queryable.query('SELECT id FROM staff_admin_accounts WHERE id=$1 AND active=TRUE FOR SHARE',[id]);
    const principal=await authorityResolver(queryable,id,{additionalCapabilities:['voucher:view','voucher:redeem','payment:view']});
    const authority=principal?.calendarAuthority;
    if(!authority||authority.calendarScope!=='all_business'||authority.serviceScope!=='all_services'||!hasCapability(authority,'client:lookup')||!hasCapability(authority,'payment:view')||!hasCapability(authority,'voucher:view')||(write&&!hasCapability(authority,'voucher:redeem')))throw new GiftVoucherError('VOUCHER_FORBIDDEN','Your current access does not permit this booking voucher action.',403);
    return authority;
  }
  async function getAvailable({adminId,clientId}={}) {
    const authority=await requireAccess(db,adminId);
    const vouchers=(await db.query(`SELECT v.voucher_code,v.balance,v.valid_until FROM gift_vouchers v
      JOIN gift_voucher_orders o ON o.id=v.order_id JOIN crm_v2_clients c ON c.id=v.recipient_crm_v2_client_id
      WHERE v.recipient_crm_v2_client_id=$1 AND c.status='active' AND c.mobile_verified_at IS NOT NULL AND o.state='paid' AND v.state='active' AND v.balance>0 ORDER BY v.id`,[positiveId(clientId)])).rows;
    return {canApply:hasCapability(authority,'voucher:redeem'),vouchers:vouchers.filter(v=>v.valid_until==null||voucherExpiryTimestamp(v.valid_until)>=Date.now())};
  }
  async function applyGift(input) {
    const data=normalizedGift(input),connection=await db.connect();
    try {
      await connection.query('BEGIN'); await requireAccess(connection,data.adminId,true);
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`booking-gift:${data.operationId}`]);
      const replay=(await connection.query('SELECT * FROM booking_gift_voucher_allocations WHERE operation_id=$1',[data.operationId])).rows[0];
      if(replay){if(replay.request_fingerprint!==data.fingerprint)throw new GiftVoucherError('VOUCHER_RETRY_MISMATCH','This request already belongs to a different voucher action. Review the history.',409);await connection.query('COMMIT');return {status:'idempotent_replay',allocation:replay};}
      const account=await lockCompletedTreatmentAccount(connection,data);
      const voucher=(await connection.query(`SELECT v.*,o.state AS order_state,c.status AS client_status,c.mobile_verified_at AS client_verified_at FROM gift_vouchers v
        JOIN gift_voucher_orders o ON o.id=v.order_id JOIN crm_v2_clients c ON c.id=v.recipient_crm_v2_client_id
        WHERE v.voucher_code=$1 FOR UPDATE OF v,o`,[data.voucherCode])).rows[0];
      if(!voucher||Number(voucher.recipient_crm_v2_client_id)!==data.clientId||voucher.client_status!=='active'||!voucher.client_verified_at)throw new GiftVoucherError('VOUCHER_NOT_OWNED','Choose a voucher already linked to this active client. Unlinked vouchers need recipient identity review.',409);
      if(voucher.order_state!=='paid')throw new GiftVoucherError('VOUCHER_NOT_ACTIVE','This voucher is not available for use.',409);
      assertGiftVoucherUsable(voucher,data.amount);
      const outstanding=await remainingTreatmentCents(connection,account);
      if(Math.round(Number(data.amount)*100)>outstanding)throw new GiftVoucherError('VOUCHER_EXCEEDS_TREATMENT','This amount is greater than the remaining treatment balance.',409);
      const key=`redeem:booking:${data.operationId}`;
      if((await connection.query('SELECT id FROM gift_voucher_ledger_entries WHERE operation_key=$1',[key])).rowCount)throw new GiftVoucherError('VOUCHER_RETRY_MISMATCH','This request already belongs to a different voucher redemption. Review the history.',409);
      const ledger=await consumeGiftVoucherValue(connection,{voucher,amount:data.amount,operationKey:key,adminId:data.adminId,notes:data.notes||null});
      const allocation=(await connection.query(`INSERT INTO booking_gift_voucher_allocations(voucher_ledger_entry_id,booking_payment_account_id,appointment_id,crm_v2_client_id,actor_admin_id,amount,operation_id,request_fingerprint)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[ledger.id,account.id,data.appointmentId,data.clientId,data.adminId,data.amount,data.operationId,data.fingerprint])).rows[0];
      await connection.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        VALUES($1,'gift_voucher.booking_applied','booking_gift_voucher_allocation',$2,$3::jsonb)`,[data.adminId,allocation.id,JSON.stringify({appointmentId:data.appointmentId,clientId:data.clientId,amount:data.amount,voucherLedgerEntryId:ledger.id,operationId:data.operationId})]);
      await connection.query('COMMIT');return {status:'applied',allocation,balance:Number(voucher.balance)-Number(data.amount),outstanding:(outstanding-Math.round(Number(data.amount)*100))/100};
    } catch(error){try{await connection.query('ROLLBACK');}catch(_){}throw error;}finally{connection.release();}
  }
  return {getAvailable,applyGift,requireAccess};
}
module.exports={createBookingNoncashSettlementService,normalizedGift};
