'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { DEPOSIT_ATTENTION_SQL, projectDeposit, createWorkspaceDepositAttentionService } = require('../src/services/workspaceDepositAttention');
const { depositSettlementPosition } = require('../src/services/bookingDepositPolicy');
const { createWorkspaceDashboardService } = require('../src/services/workspaceDashboard');
const { depositQueueContent } = require('../src/presentation/workspaceDashboardUx');
const now = new Date('2026-10-06T12:00:00Z');
const policy = { enabled: true, effectiveFrom: new Date('2026-09-01') };
const authority = { calendarScope:'all_business', serviceScope:'all_services', capabilities:['appointment:view'] };
const principal = { permissions:{'payment:view':true}, calendarAuthority:authority };
function row(overrides = {}) {
  return { payment_account_id:1,required_amount:'250.00',state:'awaiting',net_paid:'0',currency:'ZAR',canonical_amount_due:'500',has_link:true,
    members:[{appointmentId:1,startsAt:'2026-10-07T12:00:00Z',createdAt:'2026-10-01',status:'scheduled',currency:'ZAR',canonicalTotal:'500',requiredAmount:'250',staffIds:[11],serviceIds:[21],clientName:'Synthetic Aloe',serviceName:'Massage',staffNames:['Practitioner']}],...overrides };
}
test('canonical settlement helper covers zero, partial, paid, overpaid and refunded net evidence', () => {
  for (const [paid,outstanding] of [[0,'250.00'],[100,'150.00'],[250,'0.00'],[300,'0.00'],[200,'50.00']]) {
    const result=depositSettlementPosition({required_amount:'250'},paid);
    assert.equal(result.outstanding,outstanding);assert.equal(result.satisfied,paid>=250);
  }
});
test('paid stale requirement disappears; refunded satisfied requirement reopens read-only',()=>{
  assert.equal(projectDeposit(row({net_paid:'250'}),authority,policy,now),null);
  assert.equal(projectDeposit(row({state:'satisfied',net_paid:'200'}),authority,policy,now).outstanding,'50.00');
  assert.equal(projectDeposit(row({state:'exempt'}),authority,policy,now),null);
});
test('excludes final, past, pre-policy and pending approval bookings',()=>{
  for(const change of [{status:'cancelled'},{status:'completed'},{status:'no_show'},{startsAt:now.toISOString()},{createdAt:'2026-08-01'},{approval:'pending'},{source:'shiloh_client_whatsapp'}]) {
    const data=row();Object.assign(data.members[0],change);assert.equal(projectDeposit(data,authority,policy,now),null);
  }
});
test('shared accounts appear once only when every member is within Calendar and service scope',()=>{
  const data=row();data.required_amount='500';data.members.push({...data.members[0],appointmentId:2,staffIds:[12],serviceIds:[22]});
  assert.equal(projectDeposit(data,authority,policy,now).members.length,2);
  assert.equal(projectDeposit(data,{...authority,calendarScope:'own_appointments',linkedStaffId:11},policy,now),null);
  assert.equal(projectDeposit(data,{...authority,serviceScope:'own_services',allowedServiceIds:[21]},policy,now),null);
  data.members[1].staffIds=[11];data.members[1].serviceIds=[21];
  assert.ok(projectDeposit(data,{...authority,calendarScope:'own_appointments',linkedStaffId:11,serviceScope:'own_services',allowedServiceIds:[21]},policy,now));
});
test('inconsistent evidence does not invent an amount; missing links remain ordinary follow-up',()=>{
  for(const change of [{net_paid:'-1'},{unrecorded_payment:true},{canonical_amount_due:'900'}]) {
    assert.equal(projectDeposit(row(change),authority,policy,now).outstanding,null);
  }
  const data=row();data.members[0].requiredAmount=null;assert.equal(projectDeposit(data,authority,policy,now).state,'review');
  const shared=row();shared.members.push({...shared.members[0],appointmentId:2,status:'cancelled'});
  assert.equal(projectDeposit(shared,authority,policy,now).outstanding,null);
  const missing=projectDeposit(row({has_link:false}),authority,policy,now);
  assert.equal(missing.outstanding,'250.00');assert.match(depositQueueContent({items:[missing]}),/No active payment link/);
});
test('no payment permission means no query; policy disabled means no queue',async()=>{
  const service=createWorkspaceDepositAttentionService({db:{query(){throw Error('must not query');}},deposits:{async loadPolicy(){return {...policy,enabled:false};}}});
  assert.equal(await service.list({principal:{...principal,permissions:{}}}),null);
  assert.deepEqual(await service.list({principal}),[]);
});
test('refresh re-resolves current Dashboard authority and removes revoked financial access',async()=>{
  let current={...principal,display_name:'Synthetic',permissions:{'appointment:view':true,'payment:view':true},calendarAuthority:{...authority,businessRole:'owner'}};
  const service=createWorkspaceDashboardService({resolvePrincipal:async()=>current,depositAttentionService:{list:async({principal:p})=>p.permissions['payment:view']?[projectDeposit(row(),authority,policy,now)]:null}});
  const input={adminId:1,viewer:{calendarScope:'business_all_staff'},now};
  assert.equal((await service.depositQueue(input)).items.length,1);
  current.permissions['payment:view']=false;assert.equal(await service.depositQueue(input),null);
  current.calendarAuthority.capabilities=[];await assert.rejects(()=>service.depositQueue(input),{httpStatus:403});
});
test('actual production SQL projects synthetic shared ledger once and refreshes without writes',async()=>{
  const db=new PGlite();
  try {
    await db.exec(require('./helpers/workspaceDepositFixture'));
    const queries=[];
    const service=createWorkspaceDepositAttentionService({db:{query(sql,args){assert.match(sql,/^\/\* WorkspaceDepositAttention:read \*\/\s+SELECT/);queries.push(sql);return db.query(sql,args);}},deposits:{loadPolicy:async()=>policy}});
    let items=await service.list({principal,now});assert.equal(items.length,1);assert.equal(items[0].outstanding,'350.00');assert.equal(items[0].members.length,2);
    await db.exec("INSERT INTO payment_ledger_entries VALUES(1,null,'payment',350)");
    assert.deepEqual(await service.list({principal,now}),[]);
    await db.exec("INSERT INTO payment_ledger_entries VALUES(1,null,'refund',25)");
    items=await service.list({principal,now});assert.equal(items[0].outstanding,'25.00');assert.equal(queries.length,3);
    assert.match(DEPOSIT_ATTENTION_SQL,/jsonb_agg/);
  } finally {await db.close();}
});
