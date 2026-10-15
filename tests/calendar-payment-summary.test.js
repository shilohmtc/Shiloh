'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {install,serviceFor}=require('./helpers/priorPaymentFixture');
test('summary is read-only, follows canonical balances and fails closed on permission or price review',async(t)=>{
 const pg=new PGlite();t.after(()=>pg.close());const calls=[];const query=async(sql,params)=>{calls.push(sql);const r=params?await pg.query(sql,params):await pg.exec(sql),v=Array.isArray(r)?r.at(-1):r;return{...v,rowCount:v.rows.length||v.affectedRows};};const db={query,connect:async()=>({query,release(){}})};await install(db);const service=serviceFor(db);
 const counts=async()=>JSON.stringify((await pg.query('SELECT (SELECT COUNT(*) FROM booking_payment_accounts) accounts,(SELECT COUNT(*) FROM payment_requests) requests,(SELECT COUNT(*) FROM payment_ledger_entries) receipts,(SELECT COUNT(*) FROM booking_deposit_requirements) deposits')).rows);
 let before=await counts();calls.length=0;assert.equal((await service.getSummary({adminId:2,appointmentId:201})).outstanding,'500.00');assert.equal(await counts(),before);assert.match(calls[0],/REPEATABLE READ READ ONLY/);assert.ok(calls.includes('COMMIT'));assert.ok(calls.every(s=>!/^\s*(INSERT|UPDATE|DELETE)/i.test(s)));
 await pg.exec("INSERT INTO booking_payment_accounts(id,appointment_id,canonical_amount_due,currency,pricing_revision) VALUES(100,201,500,'ZAR',NOW());INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(100,'payment',200)");before=await counts();assert.equal((await service.getSummary({adminId:2,appointmentId:201})).outstanding,'300.00');assert.equal(await counts(),before);
 await pg.exec("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES(100,'payment',300)");assert.equal((await service.getSummary({adminId:2,appointmentId:201})).outstanding,'0.00');await pg.exec('UPDATE appointments SET total_price=700 WHERE id=201');assert.equal((await service.getSummary({adminId:2,appointmentId:201})).state,'needs_review');calls.length=0;await assert.rejects(service.getSummary({adminId:3,appointmentId:201}),{httpStatus:403});assert.ok(calls.includes('ROLLBACK'));
 await pg.exec('BEGIN READ ONLY');await assert.rejects(pg.query('UPDATE appointments SET total_price=1 WHERE id=201'),/read-only/);await pg.exec('ROLLBACK');
});
