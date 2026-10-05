const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { moneyCents, day, summarizeExpenses, cashCalculation } = require('../src/domain/workspaceFinancialRecords');
const { fingerprint, createWorkspaceFinancialRecordsService } = require('../src/services/workspaceFinancialRecords');
const { recordSections, recordsClientScript } = require('../src/presentation/workspaceFinancialRecordsUx');
const { createWorkspaceReportsRouter } = require('../src/routes/workspaceReports');
const { financialCsv } = require('../src/presentation/workspaceFinancialReportsUx');
const { summarizeFinancials } = require('../src/domain/workspaceFinancialReports');
const { resolvePeriod } = require('../src/services/workspaceReports');

test('paid expense inputs reject invalid precision, blank amounts, dates and forecasts', () => {
  for (const amount of ['', '1.001', '-5', '1e3', 'Infinity', null]) assert.throws(() => moneyCents(amount), { httpStatus: 400 });
  assert.throws(() => moneyCents('0', { positive: true }), { httpStatus: 400 });
  assert.equal(moneyCents('0.10'), 10);
  for (const value of ['2026-02-30','2026-13-01','2026-10-06','1999-12-31','tomorrow']) assert.throws(() => day(value, '2026-10-05'), { httpStatus: 400 });
  assert.equal(day('2026-10-05', '2026-10-05'), '2026-10-05');
});
test('voided entries stay in history but are excluded from expense totals', () => {
  const rows = [{id:1,category:'supplies',amount:'0.10'}, {id:2,category:'supplies',amount:'0.20'}, {id:3,category:'supplies',amount:'100',voided_at:'2026-10-05T08:00Z'}];
  const model = summarizeExpenses(rows);
  assert.equal(model.total, 0.3);
  assert.equal(model.count, 2);
  assert.equal(model.rows.length, 3);
  assert.equal(model.categories.find(row => row.key === 'supplies').amount, 0.3);
});
test('drawer calculation handles expenses, float, movements, shortage and refund-only days in cents', () => {
  const source = { methods:[{key:'cash',netReceived:275},{key:'card_machine',netReceived:900}],cashExpenses:125.5 };
  const result = cashCalculation(source, {openingFloat:'200',cashAdded:'50',cashRemoved:'100',countedCash:'295'});
  assert.equal(result.expectedCash, 299.5);
  assert.equal(result.difference, -4.5);
  assert.equal(cashCalculation({methods:[{key:'cash',netReceived:-25}],cashExpenses:0}, {openingFloat:'0',cashAdded:'0',cashRemoved:'0',countedCash:'0'}).difference,25);
});
test('close fingerprint detects later cash and noncash entries, refunds and voids without row-order changes', () => {
  const receipts = [{source:'booking',id:1,created_at:'2026-10-05T08:00Z',entry_type:'payment',amount:'100.00',method:'cash'}, {source:'voucher',id:1,created_at:'2026-10-05T09:00Z',entry_type:'payment',amount:'100.00',method:'ozow'}];
  const expenses = [{id:1,paid_on:'2026-10-05',amount:'50.00',method:'manual_eft'}];
  const hash = fingerprint(receipts,expenses);
  assert.equal(hash,fingerprint([...receipts].reverse(),expenses));
  assert.notEqual(fingerprint([],[],'2026-10-04'),fingerprint([],[],'2026-10-05'));
  assert.notEqual(hash,fingerprint([...receipts,{...receipts[0],id:3,entry_type:'refund'}],expenses));
  assert.notEqual(hash,fingerprint(receipts,[{...expenses[0],voided_at:'2026-10-05T10:00Z'}]));
  assert.notEqual(hash,fingerprint(receipts,[{...expenses[0],amount:'51.00'}]));
});
test('unauthorized financial readers cannot access or mutate expense and cash-up records', async () => {
  const service = createWorkspaceFinancialRecordsService({db:{query(){throw new Error('Unexpected data read');},connect(){throw new Error('Unexpected write');}},access:()=>({async requireAccess(){throw Object.assign(new Error('Denied'),{httpStatus:403});}})});
  for (const method of ['build','addExpense','voidExpense','preview','saveCashup']) await assert.rejects(service[method]({adminId:51}),{httpStatus:403});
});
test('record markup and CSV retain correction history and escape saved descriptions and notes', () => {
  const period=resolvePeriod({preset:'today',now:new Date('2026-10-05T12:00Z')});
  const records={...summarizeExpenses([{id:1,paid_on:'2026-10-05',category:'supplies',amount:'5',method:'cash',description:'<script>bad</script>',reference:'=formula',created_by:'Christel',voided_at:'2026-10-05T12:00Z',voided_by:'Jean-Pierre',void_reason:'duplicate'}]),today:'2026-10-05',closes:[]};
  const markup=recordSections(records,period,'<bad>');
  assert.doesNotMatch(markup,/<script>bad/);
  assert.match(markup,/Voided by Jean-Pierre: duplicate/);
  assert.match(markup,/Expected cash = opening float/);
  const csv=financialCsv({...summarizeFinancials({period}),period,records});
  assert.match(csv,/"'=formula"/);
  assert.match(csv,/duplicate/);
  new (require('node:vm').Script)(recordsClientScript());
});
test('write routes enforce session, origin, CSRF, current authority and server-owned actor identity', async () => {
  let allowed=true, writes=0;
  const env={SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'};
  const app=express();
  app.use('/calendar/reports',createWorkspaceReportsRouter({env,service:{},sessionService:{async validateSessionToken(token){return token==='test' ? {ok:true,adminId:4} : {ok:false};},validateCsrfToken:(_session,token)=>token==='valid'},recordsService:{async requireAccess(){},async addExpense(input){if(!allowed)throw Object.assign(new Error('Denied'),{httpStatus:403});assert.equal(input.adminId,4);writes++;return {id:1};}}}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`, url=origin+'/calendar/reports/expenses';
  const headers={Cookie:'shiloh_staff_session=test',Origin:origin,'Content-Type':'application/json','X-Shiloh-CSRF-Token':'valid'};
  const post=custom=>fetch(url,{method:'POST',headers:custom,body:JSON.stringify({adminId:2})});
  try {
    assert.equal((await post({...headers,Cookie:''})).status,401);
    assert.equal((await post({...headers,Origin:'https://other.test'})).status,403);
    assert.equal((await post({...headers,'X-Shiloh-CSRF-Token':'bad'})).status,403);
    assert.equal(writes,0);
    const response=await post(headers);assert.equal(response.status,201);assert.match(response.headers.get('cache-control'),/private, no-store/);
    allowed=false;assert.equal((await post(headers)).status,403);assert.equal(writes,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
