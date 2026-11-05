const test = require('node:test');
const assert = require('node:assert/strict');
const { createClientDirectoryPaymentReview, clientIds } = require('../src/services/clientDirectoryPaymentReview');
const at = new Date('2026-11-05T12:00:00Z');
function fixture({ rows = [], groups = [], allowed = [1,2], summaries = {}, deposits = [], operator = {}, failure = null, elapsedNow } = {}) {
  const calls = [], positions = [];
  const client = { async query(sql) {
    calls.push(sql);
    if (failure && sql.includes(failure)) throw Error('Synthetic unavailable');
    if (sql.includes('DirectoryPaymentReview:clients')) return { rows: allowed.map(id => ({ id })) };
    if (sql.includes('DirectoryPaymentReview:appointments')) return { rows };
    if (sql.includes('DirectoryPaymentReview:groups')) return { rows: groups };
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    throw Error('Unexpected query');
  }, release() { calls.push('RELEASE'); } };
  const review = createClientDirectoryPaymentReview({ db: { connect: async () => client }, now: () => at, elapsedNow,
    resolveOperator: async () => ({ permissions: { 'client:lookup': true, 'appointment:view': true }, business_role: 'owner', calendarAuthority: { calendarScope: 'all_business', serviceScope: 'all_services' }, ...operator }),
    readPosition: async (_client, _operator, id) => { positions.push(id); return summaries[id] || { state: 'known', outstanding: '0.00' }; },
    depositReader: () => ({ list: async () => deposits }) });
  return { review, calls, positions };
}
const row = (id, client, overrides = {}) => ({ id, crm_v2_client_id: client, client_id: null, status: 'completed', starts_at: '2020-01-01', group_id: null, private_service: false, staff_ids:[11], service_ids:[21], ...overrides });

test('complete old and recent history uses canonical positions; shared accounts count once and deposits stay separate', async () => {
  const f = fixture({ rows: [row(10,1),row(11,1),row(12,1,{group_id:7}),row(13,2,{group_id:7}),row(14,1,{status:'scheduled',starts_at:'2027-01-01'})],
    groups: [row(12,1,{group_id:7}),row(13,2,{group_id:7})],
    summaries: { 10: {state:'known',outstanding:'50.00'},12:{state:'known',outstanding:'300.00'} },
    deposits: [{ members:[{appointmentId:14}] }] });
  const result = await f.review({ adminId:1, ids:[1,2] });
  assert.deepEqual(result[1],{state:'known',completedVisits:3,outstandingVisits:1,sharedBookings:1,reviewNeeded:0,upcomingDeposits:1});
  assert.equal(result[2].sharedBookings,1);assert.equal(result[2].outstandingVisits,0);
  assert.deepEqual(f.positions,[10,11,12]);
  assert.match(f.calls[0],/REPEATABLE READ READ ONLY/);assert.equal(f.calls.at(-2),'COMMIT');
  assert.ok(f.calls.every(sql => !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/.test(sql)));
});
test('private, legacy or out-of-clinic members suppress both completed and future shared information', async () => {
  for (const extra of [{private_service:true},{client_id:9},{outside_clinic:true},{staff_ids:[]}]) {
    const f=fixture({rows:[row(1,1,{group_id:7,status:'scheduled',starts_at:'2027-01-01'}),row(2,2)],groups:[row(1,1,{group_id:7}),row(9,3,{group_id:7,...extra})],deposits:[{members:[{appointmentId:1}]}]});
    const result=await f.review({adminId:1,ids:[1,2]});assert.deepEqual(result[1],{state:'restricted'});assert.equal(result[2].state,'known');
  }
});
test('ambiguous linkage and price review never become a paid state',async()=>{
  const f=fixture({rows:[row(1,1,{client_id:9}),row(2,2)],summaries:{2:{state:'needs_review',outstanding:null}}});
  const result=await f.review({adminId:1,ids:[1,2]});assert.deepEqual(result[1],{state:'restricted'});assert.equal(result[2].reviewNeeded,1);
});
test('revoked/limited authority and unknown client scope never expose subtotals',async()=>{
  for (const operator of [{permissions:{}},{business_role:'tenant_practitioner'},{calendarAuthority:{calendarScope:'own',serviceScope:'all_services'}},{calendarAuthority:{calendarScope:'all_business',serviceScope:'own_services'}}]) {
    const f=fixture({operator,rows:[row(1,1)]});assert.deepEqual(await f.review({adminId:1,ids:[1,2]}),{1:{state:'restricted'},2:{state:'restricted'}});assert.equal(f.positions.length,0);
  }
  const f=fixture({allowed:[1]});assert.equal((await f.review({adminId:1,ids:[1,2]}))[1].state,'restricted');
});
test('limits, errors, malformed money and duplicate membership return unavailable rather than partial balances',async()=>{
  for(const options of [{rows:Array.from({length:1001},(_,i)=>row(i+1,1))},{rows:Array.from({length:501},(_,i)=>row(i+1,1))},{rows:[row(1,1),row(1,1)]},{failure:'appointments'},{rows:[row(1,1)],summaries:{1:{state:'known',outstanding:'bad'}}},{rows:[row(1,1,{status:'scheduled',starts_at:'2027-01-01'})],deposits:null}]){
    const f=fixture(options);assert.deepEqual(await f.review({adminId:1,ids:[1,2]}),{1:{state:'unavailable'},2:{state:'unavailable'}});assert.ok(f.calls.includes('ROLLBACK'));
  }
});
test('future completed records need review, and malformed page requests never reach storage',async()=>{
 const f=fixture({rows:[row(1,1,{starts_at:'2027-01-01'})]});assert.equal((await f.review({adminId:1,ids:[1,2]}))[1].reviewNeeded,1);assert.equal(f.positions.length,0);
 for(const ids of [[],[0],['invalid'],Array(25).fill(1),null])assert.throws(()=>clientIds(ids));
});

test('real synthetic ledger proves partial money and applied rewards; repeated review writes nothing',async t=>{
 const {PGlite}=require('@electric-sql/pglite');const {install}=require('./helpers/priorPaymentFixture');const {createBookingPaymentService}=require('../src/services/bookingPayments');
 const pg=new PGlite();t.after(()=>pg.close());const seen=[];
 const query=async(sql,params)=>{seen.push(sql);const raw=params?await pg.query(sql,params):await pg.exec(sql),r=Array.isArray(raw)?raw.at(-1):raw;return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 const db={query,connect:async()=>({query,release(){}})};await install(db);
 await query("CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,owner_staff_id bigint); INSERT INTO crm_v2_client_relationships VALUES(101,'clinic',NULL),(102,'clinic',NULL); CREATE TABLE service_visibility_policies(service_id bigint,visibility_scope text,owner_staff_id bigint);");
 let notifications=0;
 const service=createBookingPaymentService({db,now:()=>at,ozow:{configured:()=>false},notifyClient:async()=>{notifications++;},rewards:{syncEligibleEarnings:async()=>{}},deposits:{ensureRequirement:async()=>({applicable:false}),getPosition:async()=>({applicable:false})},directoryDepositReader:()=>({list:async()=>[]})});
 const review=()=>service.getDirectoryReviews({adminId:1,ids:[101,102]});
 let mark=seen.length;assert.equal((await review())[101].outstandingVisits,2,'unused purchased gift vouchers do not settle either completed visit');assert.ok(seen.slice(mark).every(sql=>!/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
 const revision=new Date((await query('SELECT updated_at FROM appointments WHERE id=201')).rows[0].updated_at).toISOString();
 await service.recordManual({adminId:1,appointmentId:201,amount:'200.00',method:'cash',operationId:'synthetic_directory_partial',expectedRevision:revision});
 assert.equal((await review())[101].outstandingVisits,2);
 const account=(await query('SELECT id FROM booking_payment_accounts WHERE appointment_id=201')).rows[0].id;
 await query("INSERT INTO booking_loyalty_allocations(booking_payment_account_id,state,amount) VALUES($1,'applied',300)",[account]);
 const notices=notifications;mark=seen.length;assert.equal((await review())[101].outstandingVisits,1);assert.equal((await review())[101].outstandingVisits,1);
 assert.ok(seen.slice(mark).every(sql=>!/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
 assert.equal(notifications,notices,'read-only review must not send a client notification');
 assert.ok(seen.slice(mark).every(sql=>!sql.includes('external_reference,notes')&&!sql.includes('jsonb_agg(history')&&!sql.includes('SELECT id,request_key')),'summary must not fetch payment-link, receipt-note or credit-history detail');
 assert.equal(Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count),1);
 await query("UPDATE staff_admin_accounts SET permissions=permissions-'payment:view' WHERE id=1");
 assert.deepEqual((await review())[101],{state:'restricted'});
 await query("UPDATE staff_admin_accounts SET permissions=permissions || '{\"payment:view\":true}'::jsonb WHERE id=1");
 await query("INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES($1,'paid',25,'synthetic_unrecorded_provider')",[account]);
 const uncertain=(await review())[101];assert.equal(uncertain.reviewNeeded,1);assert.equal(uncertain.outstandingVisits,1);
 await query('UPDATE appointments SET total_price=NULL WHERE id=202');
 const unpriced=await review();assert.equal(unpriced[101].reviewNeeded,2);assert.equal(unpriced[102].outstandingVisits,1);
 await query('UPDATE appointments SET total_price=500 WHERE id=202');

 assert.equal(Number((await query('SELECT COUNT(*) AS count FROM payment_ledger_entries')).rows[0].count),1);
 await query("INSERT INTO appointments(id,crm_v2_client_id,status,total_price,currency,updated_at,starts_at) VALUES(205,101,'completed',250,'ZAR',NOW(),'2026-10-10'),(206,102,'completed',300,'ZAR',NOW(),'2026-10-10'); INSERT INTO appointment_groups(id,status,total_price,updated_at) VALUES(9,'confirmed',550,NOW()); INSERT INTO appointment_group_members(group_id,appointment_id) VALUES(9,205),(9,206); INSERT INTO appointment_staff VALUES(205,11,1),(206,11,1); INSERT INTO appointment_services VALUES(205,21,'Synthetic group',1),(206,21,'Synthetic group',1);");
 const shared=await review();assert.equal(shared[101].sharedBookings,1);assert.equal(shared[102].sharedBookings,1);
 await query("INSERT INTO service_visibility_policies VALUES(99,'tenant_private',55); UPDATE appointment_services SET service_id=99 WHERE appointment_id=206;");
 assert.deepEqual(await review(),{101:{state:'restricted'},102:{state:'restricted'}});

});

test('mounted read route binds the signed-in actor, denies anonymous reads and preserves private responses',async t=>{
 const express=require('express');const {createWorkspaceClientsRouter}=require('../src/routes/workspaceClients');const app=express(),calls=[];
 app.use('/calendar/clients',createWorkspaceClientsRouter({env:{SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'},sessionService:{validateSessionToken:async token=>token==='authorized'?{ok:true,adminId:41,viewer:{}}:{ok:false}},service:{requireAccess:async id=>assert.equal(id,41)},paymentService:{getDirectoryReviews:async input=>{calls.push(input);return {101:{state:'unavailable'}};}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/calendar/clients/payment-review?ids=101')).status,401);assert.equal(calls.length,0);
 const response=await fetch(base+'/calendar/clients/payment-review?ids=101&adminId=999',{headers:{Cookie:'shiloh_staff_session=authorized'}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(calls.length,1);assert.equal(calls[0].adminId,41);assert.deepEqual(calls[0].ids,['101']);assert.equal(typeof calls[0].isCancelled,'function');assert.deepEqual(await response.json(),{reviews:{101:{state:'unavailable'}}});
});


test('unrecorded provider money and exceptional receipts require review even on a cancelled booking',async()=>{
 const f=fixture({rows:[row(1,1,{payment_review:true}),row(2,2,{status:'cancelled',payment_review:true})]});
 const result=await f.review({adminId:1,ids:[1,2]});assert.equal(result[1].reviewNeeded,1);assert.equal(result[2].reviewNeeded,1);assert.equal(result[1].outstandingVisits,0);assert.equal(f.positions.length,0);
});


test('elapsed-work budget drops the entire projection rather than exposing a partial total',async()=>{
 let clockCalls=0;const f=fixture({rows:[row(1,1)],elapsedNow:()=>clockCalls++===0?0:5001});
 assert.deepEqual(await f.review({adminId:1,ids:[1,2]}),{1:{state:'unavailable'},2:{state:'unavailable'}});assert.equal(f.positions.length,0);assert.ok(f.calls.includes('ROLLBACK'));
});


test('abandoned searches stop before further financial reads and discard the snapshot',async()=>{
 const f=fixture({rows:[row(1,1)]});assert.deepEqual(await f.review({adminId:1,ids:[1,2],isCancelled:()=>true}),{1:{state:'unavailable'},2:{state:'unavailable'}});assert.equal(f.positions.length,0);assert.ok(f.calls.includes('ROLLBACK'));
});
