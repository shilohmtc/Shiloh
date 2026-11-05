'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor}=require('./helpers/priorPaymentFixture');
test('completion payment shortcut uses recorded balance, rejects stale revisions and never duplicates a retried receipt',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  const query=async(sql,params)=>{const raw=params?await pg.query(sql,params):await pg.exec(sql),r=Array.isArray(raw)?raw.at(-1):raw;return {...r,rowCount:r.rows.length||r.affectedRows||0};};
  const db={query,connect:async()=>({query,release(){}})};await install(db);
  const service=serviceFor(db);
  const before=await service.getReview({adminId:1,appointmentId:201});
  const input={adminId:1,appointmentId:201,amount:'100.00',method:'cash',operationId:'synthetic_complete_001',expectedRevision:before.subject.pricingRevision};
  await assert.rejects(service.recordManual({...input,expectedRevision:'2000-01-01T00:00:00Z'}),{code:'PAYMENT_STALE_REVISION'});
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count),0);
  await service.recordManual(input);await service.recordManual(input);
  const after=await service.getReview({adminId:1,appointmentId:201});
  assert.equal(Number(after.payment.outstanding),Number(before.payment.outstanding)-100);
  assert.equal(Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count),1);
});
