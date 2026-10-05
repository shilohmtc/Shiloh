const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWorkspaceFinancialRecordsService } = require('../src/services/workspaceFinancialRecords');

async function proof(db) {
  // The caller must supply an isolated local test database. Use a unique schema;
  // production connection URLs are refused in the executable entrypoint below.
  const schema = 'financial_records_proof_' + crypto.randomBytes(6).toString('hex');
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema}`);
  try {
    await db.query(`
      CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,active boolean,business_role text,display_name text,permissions jsonb,calendar_scope text,service_scope text,staff_id bigint);
      CREATE TABLE staff(id bigint PRIMARY KEY,display_name text,status text);
      CREATE TABLE crm_audit_events(id bigserial PRIMARY KEY,actor_admin_id bigint,action text,entity_type text,entity_id bigint,metadata jsonb);
      CREATE TABLE appointments(id bigint PRIMARY KEY);
      CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint);
      CREATE TABLE booking_payment_accounts(id bigint,appointment_id bigint,appointment_group_id bigint);
      CREATE TABLE payment_ledger_entries(id bigint,payment_account_id bigint,created_at timestamptz,entry_type text,amount numeric,method text);
      CREATE TABLE gift_voucher_payment_entries(id bigint,order_id bigint,created_at timestamptz,amount numeric,method text);
      CREATE TABLE gift_vouchers(id bigint,order_id bigint);
      CREATE TABLE gift_voucher_ledger_entries(id bigint,voucher_id bigint,created_at timestamptz,entry_type text,amount numeric,operation_key text);
      CREATE TABLE client_package_entitlements(id bigint,purchased_at timestamptz,purchase_price numeric,payment_method text,payment_status text);
      INSERT INTO client_package_entitlements VALUES
        (1,'2026-10-05 10:00Z',75,'cash','paid'),
        (2,'2026-10-05 10:00Z',150,'card_machine','paid'),
        (3,'2026-10-05 10:00Z',999,'cash','pending'),
        (4,'2026-10-05 10:00Z',999,null,'paid'),
        (5,'2026-10-05 22:00Z',999,'cash','paid');
      INSERT INTO staff_admin_accounts VALUES
        (2,true,'owner','Christel','{"staff_earnings:manage":true,"appointment:view":true,"payment:view":true,"voucher:view":true}','all_business','all_services',null),
        (4,true,'business_admin','Jean-Pierre','{"staff_earnings:manage":true,"appointment:view":true,"payment:view":true,"voucher:view":true}','all_business','all_services',null),
        (51,true,'booking_operator','Reception','{"appointment:view":true}','all_business','all_services',null);
      INSERT INTO booking_payment_accounts VALUES(1,1,null);
      INSERT INTO payment_ledger_entries VALUES(1,1,'2026-10-04 22:00Z','payment',300,'cash'),(2,1,'2026-10-05 12:00Z','refund',25,'cash'),(3,1,'2026-10-05 12:00Z','payment',500,'card_machine'),(4,1,'2026-10-05 22:00Z','payment',999,'cash');
      INSERT INTO gift_voucher_payment_entries VALUES(1,1,'2026-10-05 10:00Z',100,'cash');
      INSERT INTO gift_vouchers VALUES(1,1);
      INSERT INTO gift_voucher_ledger_entries VALUES(1,1,'2026-10-05 10:00Z','issue',100,'issue:walk-in:1'),(2,1,'2026-10-05 11:00Z','redemption',50,'redeem:1'),(3,1,'2026-10-05 13:00Z','issue',200,'issue:ozow:1');
    `);
    const migration = fs.readFileSync(path.join(__dirname,'../migrations/185_workspace_expenses_cashups.sql'),'utf8');
    await db.query(migration);
    const service=createWorkspaceFinancialRecordsService({db,now:()=>new Date('2026-10-05T16:00Z')});
    const expense={adminId:2,operationId:crypto.randomUUID(),paidOn:'2026-10-05',category:'supplies',description:'Oils',reference:'104',amount:'125.50',method:'cash'};
    const saved=await service.addExpense(expense);
    assert.equal((await service.addExpense(expense)).replayed,true);
    await assert.rejects(db.query('UPDATE workspace_expenses SET voided_at=NOW(),voided_by_admin_id=2,void_reason=NULL WHERE id=$1',[saved.id]),{code:'23514'});
    await assert.rejects(service.addExpense({...expense,amount:'126'}),{httpStatus:409});
    await assert.rejects(service.addExpense({...expense,adminId:51,operationId:crypto.randomUUID()}),{httpStatus:403});
    const {resolvePeriod}=require('../src/services/workspaceReports');
    const period=resolvePeriod({from:'2026-10-05',to:'2026-10-05'});
    assert.equal((await service.build({adminId:4,period})).total,125.5);
    const preview=await service.preview({adminId:4,date:'2026-10-05'});
    assert.equal(preview.methods.find(row=>row.key==='cash').netReceived,450);
    assert.equal(preview.methods.find(row=>row.key==='card_machine').received,650);
    assert.equal(preview.methods.find(row=>row.key==='ozow').received,200);
    assert.equal(preview.cashExpenses,125.5);
    const close={adminId:4,operationId:crypto.randomUUID(),date:'2026-10-05',fingerprint:preview.fingerprint,revision:0,openingFloat:'200',cashAdded:'0',cashRemoved:'0',countedCash:'520',note:'R4.50 short; receipts reviewed'};
    const result=await service.saveCashup(close);
    assert.equal(result.expectedCash,524.5);
    assert.equal(result.difference,-4.5);
    assert.equal((await service.saveCashup(close)).replayed,true);
    await assert.rejects(service.saveCashup({...close,countedCash:'446'}),{httpStatus:409});
    await assert.rejects(service.saveCashup({...close,operationId:crypto.randomUUID()}),{httpStatus:409});
    await db.query("INSERT INTO payment_ledger_entries VALUES(5,1,'2026-10-05 16:30Z','payment',10,'cash')");
    const changed=await service.preview({adminId:2,date:'2026-10-05'});
    assert.equal(changed.changedSinceClose,true);
    await assert.rejects(service.saveCashup({...close,operationId:crypto.randomUUID(),revision:1}),{httpStatus:409});
    await assert.rejects(service.saveCashup({...close,operationId:crypto.randomUUID(),revision:1,fingerprint:changed.fingerprint,note:''}),{httpStatus:400});
    const revised=await service.saveCashup({...close,adminId:2,operationId:crypto.randomUUID(),revision:1,fingerprint:changed.fingerprint,note:'Later receipt entered'});
    assert.equal(revised.revision,2);
    await service.voidExpense({adminId:4,expenseId:saved.id,reason:'Duplicate purchase'});
    const afterVoid=await service.preview({adminId:2,date:'2026-10-05'});
    assert.equal(afterVoid.cashExpenses,0);
    assert.equal(afterVoid.changedSinceClose,true);
    const history=await service.build({adminId:2,period});
    assert.equal(history.total,0);assert.equal(history.rows.length,1);assert.equal(history.rows[0].voided_by,'Jean-Pierre');
    assert.equal(history.closes.length,2);assert.equal(Number(history.closes[1].expected_cash),524.5);
    assert.equal(Number(history.closes[1].snapshot.cashExpenses),125.5);
    assert.equal((await db.query('SELECT * FROM crm_audit_events')).rows.length,4);
    // Force an audit failure and prove the record itself rolls back.
    await db.query("ALTER TABLE crm_audit_events ADD CONSTRAINT reject_test_action CHECK (action <> 'workspace.expense.create') NOT VALID");
    await assert.rejects(service.addExpense({...expense,operationId:crypto.randomUUID()}));
    assert.equal(Number((await db.query('SELECT COUNT(*) AS count FROM workspace_expenses')).rows[0].count),1);
    await db.query("UPDATE staff_admin_accounts SET permissions=permissions-'staff_earnings:manage' WHERE id=4");
    await assert.rejects(service.preview({adminId:4,date:'2026-10-05'}),{httpStatus:403});
    console.log('Financial records PostgreSQL proof passed: real migration/queries, equal role access, denied/revoked authority, canonical cash/refund/voucher/paid-package evidence, pending/unattributed packages excluded, date boundaries, idempotent saves, stale close rejection, versioned history, void corrections and atomic audit rollback.');
  } finally {
    await db.query('SET search_path TO public');
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
  }
}
async function main() {
  const url=new URL(process.env.FINANCIAL_PROOF_DATABASE_URL || '');
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/shiloh_financial_test') throw new Error('Financial records proof requires its isolated local test database.');
  const {Client}=require('pg');
  const client=new Client({connectionString:url.toString()});await client.connect();
  const db={query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  try {await proof(db);} finally {await client.end();}
}
if (require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={proof};
