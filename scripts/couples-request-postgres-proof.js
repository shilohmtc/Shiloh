'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {setup,OWNER,NOW,START}=require('../tests/helpers/couplesRequestFixture');
const approval=require('../src/services/clientBookingApproval');
async function main(){
  assert.ok(process.env.TEST_COUPLES_DATABASE_URL,'Dedicated synthetic PostgreSQL URL required');
  const admin=new Pool({connectionString:process.env.TEST_COUPLES_DATABASE_URL});
  const pool=new Pool({connectionString:process.env.TEST_COUPLES_DATABASE_URL,options:'-c search_path=couples_request_proof',max:5});
  const normalize=result=>Array.isArray(result)?result.at(-1):result;
  const db={query:async(sql,params)=>normalize(await pool.query(sql,params)),connect:async()=>{const client=await pool.connect();return {query:async(sql,params)=>normalize(await client.query(sql,params)),release:()=>client.release()};}};
  try{
    await admin.query('CREATE SCHEMA couples_request_proof');
    const f=await setup({after(){}},{db});const input=await f.input();
    const creates=await Promise.all([f.service.createRequest(input),f.service.createRequest(input)]);
    assert.deepEqual(creates[0].appointmentIds,creates[1].appointmentIds);assert.equal(creates.filter(row=>row.replay).length,1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM appointment_groups')).rows[0].n,1);
    const id=creates[0].appointmentIds[0];
    const revision=(await db.query('SELECT requested_revision FROM appointment_booking_approvals WHERE appointment_id=$1',[id])).rows[0].requested_revision;
    const base={dbPool:db,principal:OWNER,appointmentId:id,expectedRevision:revision,now:NOW,startsAt:'2030-11-03T08:00:00Z',
      validateWindow:async()=>({ok:true,canonical:{display_name:'Synthetic practitioner'}}),sendProposal:async()=>{},sendConfirmation:async()=>{},depositPreflight:async()=>{}};
    const offers=await Promise.all([approval.proposeAlternative(base),approval.proposeAlternative(base)]);
    assert.deepEqual(offers.map(row=>row.proposalVersion).sort(),[1,2]);
    const pending=(await db.query('SELECT proposal_version,proposed_starts_at FROM appointment_booking_approvals')).rows;
    assert.ok(pending.every(row=>row.proposal_version===2));
    const before=await f.snapshot();let checks=0;
    await assert.rejects(approval.acceptProposedAlternative({...base,crmV2ClientId:55,proposalVersion:2,depositPreflight:async()=>{if(++checks===2)throw new Error('Synthetic second preflight failure');}}),/second preflight/);
    assert.deepEqual(await f.snapshot(),before);
    const accepts=await Promise.allSettled([1,2].map(()=>approval.acceptProposedAlternative({...base,crmV2ClientId:55,proposalVersion:2})));
    assert.equal(accepts.filter(row=>row.status==='fulfilled').length,1);
    const after=await f.snapshot();assert.ok(after.approvals.every(row=>row.status==='approved'));
    assert.ok(after.appointments.every(row=>row.starts_at.toISOString()==='2030-11-03T08:00:00.000Z'));
    assert.equal(after.groups[0].starts_at.toISOString(),'2030-11-03T08:00:00.000Z');
    assert.equal(after.groups[0].final_total,'1080.01');assert.notEqual(after.appointments[0].crm_v2_client_id,after.appointments[1].crm_v2_client_id);
    assert.notEqual(after.groups[0].starts_at.toISOString(),START);
    console.log('Couples request PostgreSQL proof passed: concurrent request replay, serial shared proposals, atomic second-member rollback and one shared client acceptance.');
  }finally{await pool.end();await admin.query('DROP SCHEMA IF EXISTS couples_request_proof CASCADE');await admin.end();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
