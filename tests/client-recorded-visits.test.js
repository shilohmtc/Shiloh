'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readClientRecordedVisits } = require('../src/services/clientRecordedVisits');
const { projectRecordedVisits } = require('../src/domain/clientRecordedVisits');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const fixture = () => clientRecordedVisitsFixture({ nativeUrl: process.env.TEST_RECORDED_VISITS_DATABASE_URL || null });

const asOf = '2026-11-08T08:00:00Z';
test('actual SQL counts scoped recorded visits, linked treatments and independent guest identities', async t => {
  const f = await fixture(); t.after(f.close);
  const empty=(await readClientRecordedVisits({db:f.db,clientIds:[2],scope:f.scope,asOf}))[2];
  assert.equal(empty.visitCount,0);assert.equal(empty.lastVisitAt,null);
  for (const [id, date] of [[1,'2026-08-01'],[2,'2026-08-22'],[3,'2026-09-12'],[4,'2026-10-03']]) await f.add({ id, date });
  await f.add({ id: 5, date: '2026-10-03', group: 20 });
  await f.add({ id: 6, date: '2026-10-03', time: '11:00', group: 20, services: [{ id: 10, name: 'Back massage' }, { id: 11, name: 'Facial' }] });
  await f.add({ id: 7, client: 2, date: '2026-10-03', group: 20, status: 'no_charge', services: [{ id: 11, name: 'Facial' }] });
  for (const [id,status] of [[8,'cancelled'],[9,'no_show'],[10,'scheduled'],[11,'unknown']]) await f.add({ id, status });
  await f.add({ id: 12, date: '2027-01-01' });
  await f.add({ id: 13, legacy: 99 });
  await f.add({ id: 14, client: null, legacy: 99 });
  await f.add({ id: 15, date: '2026-11-08', time: '09:30' }); // started, not ended
  const before = (await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n;
  const start = f.calls.length;
  const result = await readClientRecordedVisits({ db: f.db, clientIds: [1,2,3], scope: f.scope, asOf });
  assert.equal(result[1].visitCount, 5); // independent same-day appointment stays separate
  assert.equal(result[1].interval.state, 'regular'); assert.equal(result[1].interval.days, 21);
  assert.deepEqual(result[1].leaders, [{ name: 'Back massage', visits: 5 }]);
  assert.equal(result[1].lastVisitAt, '2026-10-03T07:00:00.000Z');
  assert.equal(result[2].visitCount, 1); assert.equal(result[2].interval.state, 'sparse');
  assert.equal(result[3].available, false);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM appointments')).rows[0].n, before);
  const reads = f.calls.slice(start,-1).map(c => c.text);
  assert.equal(reads[0], 'BEGIN READ ONLY'); assert.equal(reads.at(-1), 'ROLLBACK');
  assert.equal(reads.filter(sql => sql.includes('clientRecordedVisits:scoped-batch')).length, 1);
  assert.equal(f.releases(), 2);
});

test('actual SQL prevents mixed-scope treatment disclosure, preserves ties and marks missing details', async t => {
  const f = await fixture(); t.after(f.close);
  await f.add({ id: 1, services: [{ id: 10, name: '<Public treatment>' },{ id: 90, name: 'Private owner seven' },{ id: 91, name: 'Private owner eight' }] });
  await f.add({ id: 2, services: [{ id: 11, name: 'Other public treatment' }] });
  await f.add({ id: 3, client: 3, services: [{ id: 90, name: 'Private owner seven' }] });
  const clinic = (await readClientRecordedVisits({ db: f.db, clientIds: [1,3], scope: f.scope, asOf }));
  assert.equal(clinic[1].visitCount, 2); assert.equal(clinic[1].leaderCount, 2);
  assert.equal(clinic[3].available, false); assert.doesNotMatch(JSON.stringify(clinic), /Private owner/);
  const tenant = await readClientRecordedVisits({ db: f.db, clientIds: [1,2,3], scope: { kind: 'tenant_staff', ownerStaffId: 7 }, asOf });
  assert.equal(tenant[1].visitCount, 1); assert.equal(tenant[3].visitCount, 1); assert.equal(tenant[2].available, false);
  assert.doesNotMatch(JSON.stringify(tenant), /Public treatment|Other public|owner eight/);
  await f.add({ id: 4, services: [{ id: 10, name: '<Public treatment>' }, { id: null, name: 'Unlinked treatment' }] });
  await f.add({ id: 5, services: [] });
  const missing = (await readClientRecordedVisits({ db: f.db, clientIds: [1], scope: f.scope, asOf }))[1];
  assert.equal(missing.missingTreatmentVisits, 2);
});

test('actual SQL handles SAST calendar boundaries, more than a history page and conservative split groups', async t => {
  const f = await fixture(); t.after(f.close);
  await f.add({ id: 1, date: '2025-11-07', time: '23:59' });
  await f.add({ id: 2, date: '2025-11-08', time: '00:00' });
  for (let id = 3; id <= 32; id++) await f.add({ id, date: `2026-10-${String(id-2).padStart(2,'0')}` });
  const summary = (await readClientRecordedVisits({ db: f.db, clientIds: [1], scope: f.scope, asOf }))[1];
  assert.equal(summary.visitCount, 31); assert.equal(summary.periodStart, '2025-11-08');
  await f.add({id:33,date:'2027-02-27'});await f.add({id:34,date:'2027-02-28'});
  const leap=(await readClientRecordedVisits({db:f.db,clientIds:[1],scope:f.scope,asOf:'2028-02-29T08:00:00Z'}))[1];
  assert.equal(leap.periodStart,'2027-02-28');assert.equal(leap.visitCount,1);
  await f.add({ id: 40, group: 10, date: '2026-10-01' });
  await f.add({ id: 41, group: 10, date: '2026-10-02' });
  assert.equal((await readClientRecordedVisits({ db: f.db, clientIds: [1], scope: f.scope, asOf }))[1].available, false);
});

test('caps, invalid scopes and query failures never invent zero visits', async t => {
  const f = await fixture(); t.after(f.close);
  await f.db.query("INSERT INTO appointments SELECT n,NULL,1,'2026-10-01'::timestamptz,'2026-10-01 01:00'::timestamptz,'completed','Synthetic' FROM generate_series(1,5001) n");
  assert.equal((await readClientRecordedVisits({ db: f.db, clientIds: [1], scope: f.scope, asOf }))[1].available, false);
  assert.equal(f.calls.find(c=>c.text.includes('clientRecordedVisits:scoped-batch')).errorCode,undefined,'the explicit record cap must work without waiting for a query timeout');
  let connects=0;const forbidden = { connect: () => { connects++; throw Error('No connection allowed'); } };
  assert.equal((await readClientRecordedVisits({ db: forbidden, clientIds: [1], scope: null, asOf }))[1].available,false); assert.equal(connects,0);
  const failed = { connect: async () => ({ query: async () => { throw Error('Synthetic offline'); }, release: () => { connects++; } }) };
  assert.deepEqual((await readClientRecordedVisits({ db: failed, clientIds: [1], scope: f.scope, asOf }))[1], { available:false });
});

test('intervals require four distinct dates and avoid calling irregular gaps usual', () => {
  const base = {record_count:5,visit_count:5,missing_treatment_visits:0,treatment_count:1,leader_count:1,period_start:'2025-11-08',leaders:[{name:'Synthetic',visits:5}]};
  assert.equal(projectRecordedVisits({...base,visit_dates:['2026-01-01','2026-01-02','2026-01-03']},asOf).interval.state,'sparse');
  assert.equal(projectRecordedVisits({...base,visit_dates:['2026-01-01','2026-01-02','2026-01-03','2026-07-01']},asOf).interval.state,'variable');
  assert.equal(projectRecordedVisits({...base,record_count:5001},asOf).available,false);
});

test('Workspace keeps Directory lightweight and rejects unauthorized clients before Overview summary reads', async t => {
  const f = await fixture();t.after(f.close);
  await f.add({id:1});
  const list=await f.service.listClients({adminId:41}); assert.equal(list.clients.length,2);
  assert.equal(list.clients[0].visitSummary,undefined);
  assert.equal(f.calls.filter(c=>c.text.includes('clientRecordedVisits:scoped-batch')).length,0);
  const detail=await f.service.getClientDetail({adminId:41,clientId:1});assert.equal(detail.visitSummary.visitCount,1);
  const before=f.calls.filter(c=>c.text.includes('clientRecordedVisits:scoped-batch')).length;
  await assert.rejects(f.service.getClientDetail({adminId:41,clientId:3}),e=>e.httpStatus===404);
  await assert.rejects(f.service.listClients({adminId:999}),e=>e.httpStatus===403);
  assert.equal(f.calls.filter(c=>c.text.includes('clientRecordedVisits:scoped-batch')).length,before);
});

test('a realistic synthetic page uses one bounded aggregate and existing client/service indexes', async t => {
  const f = await fixture(); t.after(f.close);
  await f.db.query("INSERT INTO crm_v2_clients(id,name,status) SELECT n,'Synthetic page '||n,'active' FROM generate_series(10,33) n");
  await f.db.query("INSERT INTO crm_v2_client_relationships SELECT n,'clinic',NULL,'active' FROM generate_series(10,33) n");
  await f.db.query("INSERT INTO appointments SELECT n,NULL,10+(n-1)/80, '2026-01-01'::timestamptz+((n-1)%80)*INTERVAL '3 days','2026-01-01 01:00'::timestamptz+((n-1)%80)*INTERVAL '3 days','completed','Synthetic' FROM generate_series(1,1920) n");
  await f.db.query("INSERT INTO appointment_services SELECT n,10,1,'Synthetic treatment' FROM generate_series(1,1920) n");
  const ids=Array.from({length:24},(_,i)=>i+10), start=Date.now();
  const result=await readClientRecordedVisits({db:f.db,clientIds:ids,scope:f.scope,asOf});
  const elapsedMs=Date.now()-start;
  for(const id of ids)assert.equal(result[id].visitCount,80);
  const call=f.calls.find(c=>c.text.includes('clientRecordedVisits:scoped-batch'));
  const plan=await f.db.query('EXPLAIN (FORMAT JSON) '+call.text,call.values);
  t.diagnostic(JSON.stringify({clients:24,appointments:1920,aggregateQueries:1,elapsedMs,statementTimeoutMs:2000,clientIndexInPlan:JSON.stringify(plan.rows).includes('fixture_client_visits')}));
});

test('presentation distinguishes ties, sparse, missing, unavailable and empty recorded history and escapes snapshots',()=>{
  const {renderRecordedVisits,renderCompactRecordedVisits}=require('../src/presentation/clientRecordedVisitsUx');
  const base={available:true,asOf,periodStart:'2025-11-08',lastVisitAt:null,visitCount:1,interval:{state:'sparse'},missingTreatmentVisits:0,treatmentCount:2,leaderCount:2,leaders:[{name:'<script>fictional</script>',visits:1},{name:'Other',visits:1}]};
  const html=renderRecordedVisits(base,{clientId:1,returnTo:'/calendar/clients?q=Alpha'});
  assert.match(html,/2 treatments tied/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/Not enough recorded history/);assert.match(html,/returnTo=/);
  assert.match(renderCompactRecordedVisits({...base,missingTreatmentVisits:1}),/Treatment details incomplete/);
  assert.match(renderRecordedVisits({available:false},{clientId:1}),/Visit summary unavailable/);
  assert.match(renderCompactRecordedVisits({...base,visitCount:0}),/0 recorded visits/);
});
