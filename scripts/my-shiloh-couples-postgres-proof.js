'use strict';
const { Pool } = require('pg');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createMyShilohMultipleBookingService } = require('../src/services/myShilohMultipleBooking');
async function main() {
  assert.ok(process.env.TEST_COUPLES_DATABASE_URL,'Dedicated synthetic PostgreSQL URL required');
  const admin=new Pool({ connectionString:process.env.TEST_COUPLES_DATABASE_URL });
  const db=new Pool({ connectionString:process.env.TEST_COUPLES_DATABASE_URL,options:'-c search_path=couples_proof',max:5 });
  const pair=[11,12].map(staffId => ({ serviceId:1,staffId,startsAt:'2026-11-02T08:00:00.000Z' }));
  const guest={ name:'Guest Person',mobile:'0822345678',consent:true };
  let failApproval=false,staffConflict=false;
  const alerts=[];
  try {
    await admin.query('CREATE SCHEMA couples_proof');
    await db.query(fs.readFileSync('tests/fixtures/couples-schema.sql','utf8'));
    for(const file of ['084_clean_crm_v2_foundation.sql','120_couples_booking_groups.sql','121_couples_booking_pricing_audit.sql','124_group_bookings_and_optional_discount_note.sql','145_multi_service_client_bookings.sql']) await db.query(fs.readFileSync('migrations/'+file,'utf8'));
    await db.query(`INSERT INTO locations VALUES(1,'active'); INSERT INTO services(id,name,price,duration_minutes,status) VALUES(1,'Swedish',590,90),(2,'Hot Stone',720,60); INSERT INTO staff VALUES(11,'Christel','active','practitioner',true,'owner'),(12,'Abigail','active','practitioner',true,'employee'); INSERT INTO staff_services VALUES(11,1),(12,1),(11,2),(12,2); INSERT INTO crm_v2_clients(id,name,normalized_mobile,source,mobile_verified_at) VALUES(55,'Organiser','27821234567','test',NOW());`);
    const service=createMyShilohMultipleBookingService({ db,couples:true,booking:{ slots:async () => ({ slots:[{ startsAt:pair[0].startsAt }] }) },deposits:{ loadPolicy:async () => ({ rateBasisPoints:5000,exemptStaffId:null }) },ensureApproval:async () => {},stageApproval:async (tx,{ appointmentId }) => { if(failApproval) return null; await tx.query("INSERT INTO appointment_booking_approvals VALUES($1,'pending')",[appointmentId]); return {}; },alert:async value => alerts.push(value),locationProvider:async () => ({ id:1 }),checkClinic:async () => ({ covered:true }),checkSchedule:async () => ({ covered:true }),conflicts:async () => staffConflict ? [{}] : [],now:() => new Date('2026-10-01') });
    async function request(overrides={}) { const data={ crmV2ClientId:55,treatments:pair,guest,...overrides }; const review=await service.review(data); return { ...data,quoteHash:review.quoteHash,requestId:'couples_request_123456',policyAccepted:true,specialOccasion:false }; }
    const count=async table => (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
    const input=await request();
    assert.equal(await count('crm_v2_clients'),1,'review must not create guest');
    failApproval=true; await assert.rejects(service.createRequest(input),{ code:'BOOKING_CART_APPROVAL_FAILED' }); failApproval=false;
    for(const table of ['appointments','appointment_groups','appointment_group_members','appointment_booking_approvals','booking_policy_acceptances','crm_audit_events']) assert.equal(await count(table),0,'rollback '+table);
    assert.equal(await count('crm_v2_clients'),1,'guest insert rolls back with failed booking'); assert.equal(alerts.length,0);
    staffConflict=true; await assert.rejects(service.createRequest(input),{ code:'BOOKING_CART_CONFLICT' }); staffConflict=false;
    assert.equal(await count('crm_v2_clients'),1); assert.equal(await count('appointments'),0);
    await assert.rejects(service.createRequest(await request({ guest:{ ...guest,mobile:'0821234567' } })),{ code:'BOOKING_GUEST_INVALID' });
    await db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(99,'Someone Else','27823345678','test')");
    await assert.rejects(service.createRequest(await request({ guest:{ ...guest,mobile:'0823345678' } })),{ code:'BOOKING_GUEST_REVIEW' });
    await db.query('DELETE FROM crm_v2_clients WHERE id=99');
    const race=await Promise.all([service.createRequest(input),service.createRequest(input)]);
    assert.deepEqual(race[0].appointmentIds,race[1].appointmentIds); assert.equal(race.filter(r=>r.replay).length,1);
    assert.equal(await count('appointments'),2); assert.equal(await count('appointment_groups'),1); assert.equal(await count('crm_v2_clients'),2); assert.equal(alerts.length,2);
    const clients=(await db.query('SELECT * FROM crm_v2_clients ORDER BY id')).rows;
    const companion=clients.find(c=>c.id !== '55'); assert.equal(companion.mobile_verified_at,null); assert.equal(companion.profile_status,'minimal'); assert.equal(companion.provenance.marketingConsent,false);
    const appts=(await db.query('SELECT crm_v2_client_id,total_price FROM appointments ORDER BY id')).rows;
    assert.deepEqual(appts.map(a=>a.crm_v2_client_id),['55',companion.id]); assert.deepEqual(appts.map(a=>a.total_price),['590.00','590.00']);
    assert.equal(await count('appointment_booking_approvals'),2); assert.equal(await count('booking_policy_acceptances'),2);
    await assert.rejects(service.createRequest({ ...input,specialOccasion:true,occasionNote:'Anniversary' }),{ code:'BOOKING_CART_REQUEST_CHANGED' });
    // Existing guest is reused without modifying verification, provenance or profile fields.
    await db.query("UPDATE appointments SET status='cancelled'");
    const second=await request(); second.requestId='second_couples_request';
    await service.createRequest(second); assert.equal(await count('crm_v2_clients'),2);
    assert.deepEqual((await db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[companion.id])).rows[0],companion);
    // Existing guest appointments also block a new pair atomically.
    const third=await request(); third.requestId='third_couples_request';
    await assert.rejects(service.createRequest(third),{ code:'BOOKING_CART_CONFLICT' }); assert.equal(await count('appointment_groups'),2);
    console.log('Couples PostgreSQL proof passed: consent, distinct identities, atomic guest/appointment rollback, profile reuse, conflicts and concurrent replay.');
  } finally { await db.end(); await admin.query('DROP SCHEMA IF EXISTS couples_proof CASCADE'); await admin.end(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
