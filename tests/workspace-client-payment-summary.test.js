'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clientHistoryPayments}=require('../src/services/workspaceClientPaymentSummary');
const {renderClientDetailPage}=require('../src/presentation/workspaceClientsUx');

test('client history asks canonical read-only summaries only for completed visits and preserves scope',async()=>{
 const appointments=[{id:1,status:'completed'},{id:2,status:'scheduled'},{id:3,status:'no_charge'}],calls=[];
 const paymentService={async getSummary(input){calls.push(input);if(input.appointmentId===3)throw Object.assign(Error('denied'),{httpStatus:403});return {available:true,state:'known',outstanding:'650.00'};}};
 const scoped=await clientHistoryPayments({appointments,adminId:41,scope:{kind:'clinic'},paymentService});
 assert.deepEqual(calls,[{adminId:41,appointmentId:1},{adminId:41,appointmentId:3}]);
 assert.equal(scoped[0].paymentSummary.outstanding,'650.00');assert.equal(scoped[2].paymentSummary.restricted,true);
 assert.equal(appointments[0].paymentSummary,undefined);
 calls.length=0;await clientHistoryPayments({appointments,adminId:41,scope:{kind:'tenant_staff'},paymentService});assert.equal(calls.length,0);
});

test('completed visit balance labels distinguish owed, settled, group, denied, unavailable and price review',()=>{
 for(const [summary,label] of [
  [{available:true,state:'known',outstanding:'650.00'},'Payment outstanding · R650.00'],
  [{available:true,state:'known',outstanding:'125.00'},'Payment outstanding · R125.00'],
  [{available:true,state:'known',outstanding:'0.00'},'No balance remaining'],
  [{available:true,state:'known',outstanding:'650.00',scopeLabel:'Whole booking balance'},'Whole booking outstanding · R650.00'],
  [{available:true,state:'needs_review',outstanding:null},'Payment review needed'],
  [{available:false,restricted:true},'Payment details restricted'],
  [null,'Payment status unavailable'],
  [{available:true,state:'known',outstanding:null},'Payment status unavailable'],
 ]) {
  const html=renderClientDetailPage({client:{id:1,name:'Synthetic'},appointments:[{id:1,status:'completed',starts_at:'2030-01-01',ends_at:'2030-01-01',paymentSummary:summary}],policyAcceptances:[]});
  assert.ok(html.includes(label));assert.doesNotMatch(html,/Terms awaiting|Deposit not recorded/);
 }
});

test('closing or an interrupted acknowledgement cannot erase debt or duplicate a receipt in completed history',async t=>{
 const {PGlite}=require('@electric-sql/pglite');
 const {install,serviceFor}=require('./helpers/priorPaymentFixture');
 const pg=new PGlite();t.after(()=>pg.close());
 const query=async(sql,params)=>{const raw=params?await pg.query(sql,params):await pg.exec(sql),r=Array.isArray(raw)?raw.at(-1):raw;return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 const db={query,connect:async()=>({query,release(){}})};await install(db);await query("UPDATE appointments SET status='completed' WHERE id=201");
 const paymentService=serviceFor(db),appointments=[{id:201,status:'completed'}];
 const history=async()=> (await clientHistoryPayments({appointments,adminId:1,scope:{kind:'clinic'},paymentService}))[0].paymentSummary;
 const count=async()=>Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count);
 assert.equal((await history()).outstanding,'500.00');assert.equal((await history()).outstanding,'500.00');assert.equal(await count(),0,'close and refresh reads never manufacture a receipt');
 const revision=new Date((await query('SELECT updated_at FROM appointments WHERE id=201')).rows[0].updated_at).toISOString();
 const partial={adminId:1,appointmentId:201,amount:'200.00',method:'cash',operationId:'synthetic_history_partial',expectedRevision:revision};
 await paymentService.recordManual(partial); // A committed receipt whose browser acknowledgement was lost.
 assert.equal((await history()).outstanding,'300.00');
 await paymentService.recordManual(partial);assert.equal(await count(),1,'unchanged retry must not record the same money twice');
 const balance={...partial,amount:'300.00',operationId:'synthetic_history_balance'};
 await paymentService.recordManual(balance);assert.equal((await history()).outstanding,'0.00');assert.equal(await count(),2);
});
