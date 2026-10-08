'use strict';
const {Pool}=require('pg');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createBookingNoncashSettlementService}=require('../src/services/bookingNoncashSettlement');
const {createClientTreatmentCreditService}=require('../src/services/clientTreatmentCredit');
const {createGiftVoucherService}=require('../src/services/giftVouchers');
async function run(){
 const url=new URL(process.env.CREDIT_PROOF_DATABASE_URL||'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/shiloh_credit_test')throw Error('Settlement proof requires the isolated local synthetic credit database.');
 const pool=new Pool({connectionString:url.toString(),max:8}),schema='settlement_'+randomUUID().replaceAll('-',''),admin=await pool.connect();
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);await admin.query(fs.readFileSync('tests/fixtures/treatment-credit-schema.sql','utf8'));await admin.query(fs.readFileSync('migrations/188_client_treatment_credit.sql','utf8'));
  const db={async connect(){const c=await pool.connect();await c.query(`SET search_path TO ${schema}`);return c;},async query(sql,values){const c=await this.connect();try{return await c.query(sql,values);}finally{c.release();}}};
  const gift=createBookingNoncashSettlementService({db}),credit=createClientTreatmentCreditService({db}),standalone=createGiftVoucherService({db});
  const use=changes=>({adminId:2,clientId:101,appointmentId:201,voucherCode:'SV-AAAAAAAAAAAA',amount:'100',operationId:randomUUID(),...changes});
  const first=use();const repeats=await Promise.all([gift.applyGift(first),gift.applyGift(first)]);assert.deepEqual(repeats.map(r=>r.status).sort(),['applied','idempotent_replay']);
  await assert.rejects(gift.applyGift({...first,amount:'101'}),{code:'VOUCHER_RETRY_MISMATCH'});
  await credit.issue({adminId:1,clientId:101,amount:'500',creditType:'goodwill',reason:'Synthetic mixed settlement',reference:'',operationId:randomUUID()});
  await admin.query("INSERT INTO appointments VALUES(205,NULL,101,'completed',100,'ZAR',NOW(),'2026-10-08T10:00Z','Synthetic mixed contention')");
  const mixed=await Promise.allSettled([gift.applyGift(use({appointmentId:205,amount:'80'})),credit.apply({adminId:2,clientId:101,appointmentId:205,amount:'80',operationId:randomUUID()})]);
  assert.equal(mixed.filter(r=>r.status==='fulfilled').length,1);assert.equal(mixed.find(r=>r.status==='rejected').reason.code.endsWith('EXCEEDS_TREATMENT'),true);
  // The existing standalone flow competes safely with a booking application for the same voucher.
  const competition=await Promise.allSettled([gift.applyGift(use({appointmentId:202,amount:'300'})),standalone.redeem({adminId:1,voucherCode:'SV-AAAAAAAAAAAA',amount:'300',operationId:randomUUID(),notes:'Synthetic standalone contention'})]);
  assert.equal(competition.filter(r=>r.status==='fulfilled').length,1);assert.equal(competition.find(r=>r.status==='rejected').reason.code,'VOUCHER_EXCEEDS_BALANCE');
  const wallet=(await admin.query('SELECT balance FROM gift_vouchers WHERE id=401')).rows[0];assert.ok(Number(wallet.balance)>=0);
  assert.equal((await admin.query("SELECT COUNT(*)::int AS n FROM gift_voucher_ledger_entries WHERE operation_key=$1",[`redeem:booking:${first.operationId}`])).rows[0].n,1);
  assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM payment_ledger_entries')).rows[0].n,0);
  assert.equal((await admin.query(`SELECT COUNT(*)::int AS n FROM booking_gift_voucher_allocations a JOIN gift_voucher_ledger_entries e ON e.id=a.voucher_ledger_entry_id WHERE e.amount<>a.amount OR e.entry_type<>'redemption'`)).rows[0].n,0);
  console.log('PostgreSQL booking noncash proof passed: exact gift retry, conflicting retry, mixed gift/credit account contention, standalone/booking voucher contention, atomic source linkage and zero cash entries.');
 }finally{await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);admin.release();await pool.end();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
