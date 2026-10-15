'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createMyShilohClientActionService } = require('../src/services/myShilohClientActions');
const { appointmentContextQuery, matchesClientProposal } = require('../src/services/clientRescheduleApproval');
const { createAssistantPreparation } = require('../src/services/myShilohAssistantPreparation');
const { createMyShilohReadTools, TOOL_NAMES, publicPayment } = require('../src/services/myShilohReadTools');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
const now = () => new Date('2026-10-15T08:00:00Z');
const original = '2026-11-02T08:00:00.000Z', proposed = '2026-11-03T08:00:00.000Z';

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,status TEXT,name TEXT,normalized_mobile TEXT);
    CREATE TABLE clients(id BIGINT,display_name TEXT);
    CREATE TABLE client_contacts(client_id BIGINT,normalized_value TEXT,contact_type TEXT);
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT,client_id BIGINT,location_id BIGINT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,status TEXT,updated_at TIMESTAMPTZ,source TEXT,source_client_name TEXT,title TEXT);
    CREATE TABLE appointment_group_members(appointment_id BIGINT,group_id BIGINT);
    CREATE TABLE staff(id BIGINT,display_name TEXT,status TEXT,client_bookable BOOLEAN,resource_type TEXT);
    CREATE TABLE staff_services(staff_id BIGINT,service_id BIGINT);
    CREATE TABLE services(id BIGINT,name TEXT,status TEXT);
    CREATE TABLE appointment_staff(id BIGINT,appointment_id BIGINT,staff_id BIGINT,position INT,staff_name_snapshot TEXT);
    CREATE TABLE appointment_services(id BIGINT,appointment_id BIGINT,service_id BIGINT,position INT,service_name_snapshot TEXT);
    CREATE TABLE client_browser_sessions(id BIGINT,crm_v2_client_id BIGINT,revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ);
    CREATE TABLE client_action_proposals(id BIGSERIAL,session_id BIGINT,crm_v2_client_id BIGINT,appointment_id BIGINT,action_type TEXT,token_hash TEXT,appointment_revision TIMESTAMPTZ,proposed_starts_at TIMESTAMPTZ,proposed_ends_at TIMESTAMPTZ,issued_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ,outcome TEXT);
    INSERT INTO crm_v2_clients VALUES(55,'active','Synthetic Client','27820000000'),(56,'active','Other Client','27820000001');
    INSERT INTO client_browser_sessions VALUES(1,55,NULL,'2027-01-01');
    INSERT INTO staff VALUES(11,'Synthetic practitioner','active',TRUE,'practitioner'); INSERT INTO services VALUES(101,'Synthetic treatment','active'); INSERT INTO staff_services VALUES(11,101);
    INSERT INTO appointments VALUES(901,55,NULL,1,'2026-10-20 08:00Z','2026-10-20 09:00Z','confirmed','2026-10-01',NULL,NULL,NULL),
      (902,55,NULL,1,'2026-11-02 08:00Z','2026-11-02 09:00Z','confirmed','2026-10-01 00:00:00.123456Z',NULL,NULL,NULL),
      (903,56,NULL,1,'2026-11-02 08:00Z','2026-11-02 09:00Z','confirmed','2026-10-01',NULL,NULL,NULL);
    INSERT INTO appointment_staff SELECT id,id,11,1,'Synthetic practitioner' FROM appointments;
    INSERT INTO appointment_services SELECT id,id,101,1,'Synthetic treatment' FROM appointments;`);
  const query = async (sql, args) => { const r = await pg.query(sql,args); return { rows:r.rows, rowCount:r.rows.length || r.affectedRows || 0 }; };
  const db = { query, connect:async () => ({ query, release() {} }) };
  return { pg, db, service:createMyShilohClientActionService({ db, now,
    availability:async () => ({ slots:[{starts_at:proposed,ends_at:'2026-11-03T09:00:00Z'}] }) }) };
}

test('selected owned appointment, same-start ambiguity, foreign match and shifted target use real PostgreSQL predicates', async t => {
  const h = await fixture(t);
  const prepare = () => h.service.prepareReschedule({ sessionId:1,crmV2ClientId:55,appointmentStartsAt:original,proposedStartsAt:proposed });
  assert.equal((await prepare()).ok,true);
  let rows = (await h.pg.query('SELECT appointment_id,appointment_revision::text FROM client_action_proposals')).rows;
  assert.equal(Number(rows[0].appointment_id),902); assert.match(rows[0].appointment_revision,/123456/);
  await h.pg.exec("INSERT INTO appointments SELECT 904,crm_v2_client_id,client_id,location_id,starts_at,ends_at,status,updated_at,source,source_client_name,title FROM appointments WHERE id=902");
  assert.equal((await prepare()).ok,false,'two owned matches must never pick first');
  await h.pg.exec('DELETE FROM appointments WHERE id=904');
  await h.pg.exec("UPDATE appointments SET starts_at=starts_at+INTERVAL '1 hour' WHERE id=902");
  assert.equal((await prepare()).ok,false,'foreign match must not replace shifted target or fall back to next');
  assert.equal(Number((await h.pg.query('SELECT COUNT(*) AS n FROM client_action_proposals')).rows[0].n),1);
  assert.equal((await h.service.prepareCancellation({ sessionId:1,crmV2ClientId:55,appointmentStartsAt:original })).ok,false);
});

test('canonical final locked lookup binds exact microsecond revision, client, future status and linked boundary', async t => {
  const h = await fixture(t);
  const sql = appointmentContextQuery({lock:true,bindProposal:true});
  const values=['27820000000',902,'2026-10-01T00:00:00.123456Z',55];
  // Runtime dates deliberately remain future relative to the actual test execution date.
  await h.pg.exec("UPDATE appointments SET starts_at='2099-11-02',ends_at='2099-11-02 01:00' WHERE id=902");
  assert.equal((await h.db.query(sql,values)).rowCount,1);
  await h.pg.exec('DELETE FROM staff_services'); assert.equal((await h.db.query(sql,values)).rowCount,0);
  await h.pg.exec('INSERT INTO staff_services VALUES(11,101)');
  assert.equal((await h.db.query(sql,[...values.slice(0,2),'2026-10-01T00:00:00.123457Z',55])).rowCount,0);
  assert.equal((await h.db.query(sql,[...values.slice(0,3),56])).rowCount,0);
  for (const change of ["status='cancelled'", "status='completed'", "status='confirmed',starts_at='2000-01-01'"]) {
    await h.pg.exec('UPDATE appointments SET '+change+' WHERE id=902'); assert.equal((await h.db.query(sql,values)).rowCount,0);
  }
  await h.pg.exec("UPDATE appointments SET starts_at='2099-11-02',status='confirmed' WHERE id=902; INSERT INTO appointment_group_members VALUES(902,1)");
  assert.equal((await h.db.query(sql,values)).rowCount,0);
  assert.equal(matchesClientProposal({crm_v2_client_id:56}, {expected_revision:original,expected_crm_v2_client_id:55}),false);
});

test('repeat history reads only completed owned individual visits and never answers or other guest treatment', async t => {
  const h=await fixture(t); const context=createMyShilohClientContextService({db:h.db,now});
  await h.pg.exec("UPDATE appointments SET starts_at='2026-10-01',ends_at='2026-10-01 01:00',status='completed'; INSERT INTO appointment_group_members VALUES(901,1)");
  const history=await context.loadTreatmentHistory(55);
  assert.equal(history.length,1); assert.equal(history[0].service,'Synthetic treatment');
  assert.deepEqual(Object.keys(history[0]).sort(),['practitioner','service','startsAt']);
});

test('booking preparation rechecks current price, practitioner and slot and never submits', async () => {
  let slots=[]; const calls=[];
  const preparation=createAssistantPreparation({booking:{
    catalogue:async () => [{id:101,name:'Synthetic treatment'}],
    practitioners:async () => ({service:{name:'Synthetic treatment',price:720},practitioners:[{id:11,name:'Synthetic practitioner'}]}),
    slots:async args => { calls.push(args); return {slots}; },
  }});
  const args={service:'Synthetic treatment',practitioner:'Synthetic practitioner',startsAt:proposed};
  assert.equal((await preparation.prepareBooking(args,55)).modelResult.error,'slot_unavailable');
  slots=[{startsAt:proposed}]; const result=await preparation.prepareBooking(args,55);
  assert.match(result.clientAction.href,/service=101#/); assert.match(result.clientAction.detail,/R720/);
  assert.equal(JSON.stringify(result.modelResult).includes('service=101'),false);
  assert.equal(calls[0].date,'2026-11-03'); assert.equal(calls[0].crmV2ClientId,55);
});

test('selected checklist uses exact bound existing form routes and keeps URLs/IDs out of model', async () => {
  const preparation=createAssistantPreparation({contextService:{
    loadUpcomingAppointments:async () => [{id:902,startsAt:original,services:['Synthetic treatment']}],
    loadForms:async (_client,id) => { assert.equal(id,902);return [{id:81,title:'Consultation',status:'sent',actionRequired:true,canComplete:true},{id:null,title:'Unassigned',status:'not_assigned',actionRequired:true}]; },
    loadPayment:async () => ({amountDue:'720.00',outstanding:'720.00',depositState:'waived',depositRequired:'360.00',depositOutstanding:'0.00',activePaymentPath:'/pay/SYNTHETIC_TOKEN'}),
  }});
  const result=await preparation.checklist({appointmentStartsAt:original},55);
  assert.deepEqual(result.clientAction.links,[{label:'Complete Consultation',href:'/my-shiloh/forms/complete?assignmentId=81'},{label:'Open secure payment',href:'/pay/SYNTHETIC_TOKEN'}]);
  assert.match(result.clientAction.detail,/Deposit waived/); assert.match(result.clientAction.detail,/Treatment remainder R720/);
  assert.doesNotMatch(JSON.stringify(result.modelResult),/SYNTHETIC_TOKEN|assignmentId|"id"|answers/);
  assert.equal(publicPayment({depositState:'waived',outstanding:'720.00'}).outstanding,'720.00');
});

test('form and balance selection fails closed on two same-start group-aware reads', async () => {
  const read=createMyShilohReadTools({contextService:{loadNextAppointment:async () => null,loadUpcomingAppointments:async () => [{startsAt:original},{startsAt:original}],loadPayment:async () => {throw Error('must not read payment');}}});
  const result=await read.execute(TOOL_NAMES.PAYMENT_STATUS,{appointmentStartsAt:original},{crmV2ClientId:55});
  assert.equal(result.error,'ambiguous_appointment');
});

test('canonical pending insert deduplicates simultaneous submissions and decline preserves original',async t=>{
  const h=await fixture(t);
  await h.pg.exec(`CREATE TABLE appointment_reschedule_requests(id BIGSERIAL,appointment_id BIGINT,client_id BIGINT,crm_v2_client_id BIGINT,service_id BIGINT,approver_staff_id BIGINT,requested_by_phone TEXT,original_starts_at TIMESTAMPTZ,original_ends_at TIMESTAMPTZ,proposed_starts_at TIMESTAMPTZ,proposed_ends_at TIMESTAMPTZ,status TEXT,decision_owner TEXT);
    CREATE UNIQUE INDEX one_pending ON appointment_reschedule_requests(appointment_id) WHERE status='pending';`);
  const {insertPendingRescheduleRequest}=require('../src/services/clientRescheduleApproval');
  const input={appointment:{id:902,service_id:101,staff_id:11,starts_at:original,ends_at:'2026-11-02T09:00:00Z'},authority:{clientId:null,crmV2ClientId:55},requestedByPhone:'27820000000',proposedStartsAt:proposed,proposedEndsAt:'2026-11-03T09:00:00Z'};
  const before=(await h.pg.query('SELECT * FROM appointments ORDER BY id')).rows;
  const results=await Promise.all([insertPendingRescheduleRequest(h.db,input),insertPendingRescheduleRequest(h.db,input)]);
  assert.equal(results.reduce((total,result)=>total+result.rowCount,0),1);
  assert.deepEqual((await h.pg.query('SELECT * FROM appointments ORDER BY id')).rows,before);
  await h.pg.exec("UPDATE appointment_reschedule_requests SET status='declined'");
  assert.deepEqual((await h.pg.query('SELECT * FROM appointments ORDER BY id')).rows,before);
});

test('actual practitioners DTO shapes preserve variable quote, prepaid entitlement and fixed price without model IDs',async()=>{
  for (const scenario of [
    {price:null,variablePrice:true,prepaidPackage:false,expected:'quote'},
    {price:null,variablePrice:false,prepaidPackage:false,expected:'quote'},
    {price:0,variablePrice:false,prepaidPackage:true,expected:'package'},
    {price:720,variablePrice:false,prepaidPackage:false,expected:'fixed'},
  ]) {
    const preparation=createAssistantPreparation({booking:{catalogue:async()=>[{id:101,name:'Synthetic treatment'}],practitioners:async()=>({
      service:{id:101,name:'Synthetic treatment',category:'Massage',durationMinutes:60,price:scenario.price,variablePrice:scenario.variablePrice,prepaidPackage:scenario.prepaidPackage},
      practitioners:[{id:11,name:'Synthetic practitioner',depositExempt:scenario.prepaidPackage}],deposit:{ratePercent:50,exemptStaffId:12},
    })}});
    const result=await preparation.prepareBooking({service:'Synthetic treatment'},55);
    assert.equal(Object.hasOwn(result.modelResult.service,'id'),false);
    if (scenario.expected==='quote') {
      assert.equal(result.modelResult.service.price,null); assert.equal(result.clientAction.type,'planning_request');
      assert.match(result.clientAction.note,/confirm the price/); assert.doesNotMatch(result.clientAction.detail,/R0|free/i);
    } else if(scenario.expected==='package') {
      assert.match(result.clientAction.detail,/Covered by your prepaid package/); assert.match(result.clientAction.href,/packageService=101/);
      assert.doesNotMatch(result.clientAction.detail,/R0|free/i);
    } else {assert.match(result.clientAction.detail,/R720\.00/);assert.equal(result.modelResult.service.price,720);}
  }
});

test('request tracker exposes pending approved declined with clinic year and does not confirm pending moves',()=>{
  const {buildClientExperience}=require('../src/services/myShilohExperienceOrchestrator');
  const experience=buildClientExperience({client:{name:'Synthetic'},forms:[],rescheduleHistory:['pending','approved','declined'].map(status=>({status,originalStartsAt:'2026-12-31T23:00:00Z',proposedStartsAt:'2027-01-02T08:00:00Z'}))});
  assert.deepEqual(experience.assistant.requests.map(item=>item.label),['Change requested / awaiting Shiloh approval','Change approved','Change declined']);
  assert.match(experience.assistant.requests[0].detail,/2027/); assert.match(experience.assistant.requests[0].detail,/not moved/);
});

test('tracker preserves pending planning awaiting-client and declined visibility authorities; tool excludes hidden history',async()=>{
  const {buildClientExperience}=require('../src/services/myShilohExperienceOrchestrator');
  const base={id:1,startsAt:original,endsAt:'2026-11-02T09:00:00Z',services:['Synthetic treatment'],practitioners:['Synthetic practitioner'],status:'scheduled',bookingRequestStatus:'pending'};
  const context={generatedAt:now().toISOString(),client:{name:'Synthetic'},forms:[],activeRequests:[base,
    {...base,id:2,bookingRequestStatus:'planning',planningStartedAt:now().toISOString()},
    {...base,id:3,bookingRequestStatus:'awaiting_client_confirmation',proposedStartsAt:proposed,proposalExpiresAt:'2027-01-01T00:00:00Z',proposalVersion:1}],
    declinedRequests:[{...base,id:4,services:['Hidden declined treatment'],status:'cancelled',bookingRequestStatus:'declined',historyHidden:true},
      {...base,id:5,services:['Visible declined treatment'],status:'cancelled',bookingRequestStatus:'declined',historyHidden:false}]};
  const experience=buildClientExperience(context);
  assert.deepEqual(experience.assistant.requests.map(item=>item.label),['Booking requested / awaiting Shiloh approval','Planning','Awaiting your response','Booking request declined']);
  assert.match(experience.assistant.requests[2].detail,/Review this proposed time/);
  assert.doesNotMatch(JSON.stringify(experience.assistant.requests),/Hidden declined treatment/);
  const tools=createMyShilohReadTools({contextService:{loadNextAppointment:async()=>null,getContext:async()=>context,loadRescheduleHistory:async()=>[]},planningService:{forClient:async()=>[]}});
  const result=await tools.execute(TOOL_NAMES.REQUEST_STATUS,{}, {crmV2ClientId:55});
  assert.equal(result.bookings.length,4);assert.equal(result.bookings[2].bookingRequestStatus,'awaiting_client_confirmation');
  assert.doesNotMatch(JSON.stringify(result),/Hidden declined treatment/);
});

test('bounded recent history never replaces an older canonical pending change in Bookings',()=>{
  const {buildClientExperience}=require('../src/services/myShilohExperienceOrchestrator');
  const pending={id:901,startsAt:original,endsAt:'2026-11-02T09:00:00Z',proposedStartsAt:proposed,status:'confirmed',services:['Older pending treatment'],practitioners:['Synthetic practitioner']};
  const experience=buildClientExperience({client:{name:'Synthetic'},forms:[],pendingRescheduleRequests:[pending],rescheduleHistory:Array.from({length:5},()=>({status:'approved',originalStartsAt:original,proposedStartsAt:proposed}))});
  assert.equal(experience.assistant.requests.length,5);
  assert.equal(experience.bookings.upcoming.find(item=>item.id===901).status,'Change requested');
  const script=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/my-shiloh/assets/app.js'),'utf8');
  assert.match(script,/No action is waiting among the recent requests shown here\. Check Bookings for all current requests\./);
  assert.match(script,/recent request\$\{waiting/);
  assert.doesNotMatch(script,/No request is waiting for your response or Shiloh approval\./);
});
