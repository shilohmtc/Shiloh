const test=require('node:test');
const assert=require('node:assert/strict');
const {setup,START,NOW,OWNER,GUEST}=require('./helpers/couplesRequestFixture');
const approval=require('../src/services/clientBookingApproval');
const {createMyShilohBookingService}=require('../src/services/myShilohBooking');
const {createMyShilohClientContextService}=require('../src/services/myShilohClientContext');
const {renderBookingPage}=require('../src/services/publicBookingPage');

test('named Couples Massage keeps one canonical price, exact cents and two independent clients',async t=>{
  const {service,input,query}=await setup(t);
  const quote=await service.review({crmV2ClientId:55,guest:GUEST,treatments:[11,12].map(staffId=>({serviceId:1,staffId,startsAt:START}))});
  assert.equal(quote.total,'1080.01');assert.deepEqual(quote.treatments.map(row=>row.price),['540.00','540.01']);
  const request=await input();const result=await service.createRequest(request);const retry=await service.createRequest(request);
  assert.deepEqual(result.appointmentIds,retry.appointmentIds);assert.equal(retry.replay,true);
  const appointments=(await query('SELECT crm_v2_client_id,total_price FROM appointments ORDER BY id')).rows;
  assert.notEqual(appointments[0].crm_v2_client_id,appointments[1].crm_v2_client_id);
  assert.deepEqual(appointments.map(row=>row.total_price),['540.00','540.01']);
  assert.equal((await query('SELECT final_total FROM appointment_groups')).rows[0].final_total,'1080.01');
  await assert.rejects(service.review({crmV2ClientId:55,guest:GUEST,treatments:[{serviceId:1,staffId:11,startsAt:START},{serviceId:2,staffId:12,startsAt:START}]}),{code:'BOOKING_COUPLES_NAMED_PAIR'});
});

test('special couples treatment is isolated from ordinary single appointment booking',async t=>{
  const {db}=await setup(t);
  const options={db,eligibleStaff:async()=>[{id:11,display_name:'Practitioner A'},{id:12,display_name:'Practitioner B'}],
    depositPolicy:{loadPolicy:async()=>({rateBasisPoints:5000,exemptStaffId:null})},catalogueProvider:async()=>[{id:1,name:'Couples Massage'},{id:2,name:'Ordinary Massage'}]};
  const single=createMyShilohBookingService(options),couples=createMyShilohBookingService({...options,allowCouplesService:true});
  await assert.rejects(single.practitioners({serviceId:1}),{code:'BOOKING_SERVICE_CHANGED'});
  assert.equal((await couples.practitioners({serviceId:1})).practitioners.length,2);
  assert.deepEqual((await single.catalogue()).map(row=>row.id),[2]);
  assert.equal((await couples.couplesCatalogue()).find(row=>row.couplesService).price,'R1080.01 for two');
  const html=renderBookingPage(null,[{id:1,name:'Couples Massage',price:'R1080.01',duration:'90 min'}],1,{bookableIds:new Set(),couplesServiceIds:new Set([1])});
  assert.match(html,/my-shiloh\/book\?service=1&amp;for=two/);
});

async function created(t){const setupValue=await setup(t);const result=await setupValue.service.createRequest(await setupValue.input());
  const revisions=(await setupValue.query('SELECT appointment_id,requested_revision FROM appointment_booking_approvals ORDER BY appointment_id')).rows;
  return {...setupValue,result,revisions,inputAction:{dbPool:setupValue.db,principal:OWNER,appointmentId:result.appointmentIds[0],expectedRevision:revisions[0].requested_revision,now:NOW,
    validateWindow:async()=>({ok:true,canonical:{display_name:'Synthetic practitioner'}}),sendConfirmation:async()=>{},depositPreflight:async()=>{}}};}

test('one approval checks both windows and rolls both back when the second preflight fails',async t=>{
  const {inputAction,snapshot,query,result}=await created(t);const before=await snapshot();let checks=0;
  await assert.rejects(approval.acceptRequestedAppointment({...inputAction,depositPreflight:async()=>{if(++checks===2)throw new Error('Deposit unresolved');}}),/Deposit unresolved/);
  assert.deepEqual(await snapshot(),before);
  await approval.acceptRequestedAppointment(inputAction);
  assert.deepEqual((await query('SELECT status FROM appointment_booking_approvals ORDER BY appointment_id')).rows.map(row=>row.status),['approved','approved']);
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM appointments')).rows[0].n,2);
  assert.equal(result.appointmentIds.length,2);
});

test('alternative is shared, organiser-owned, versioned and applied atomically after acceptance',async t=>{
  const {inputAction,db,result,query,snapshot}=await created(t);const start='2030-11-03T08:00:00Z';
  const proposed=await approval.proposeAlternative({...inputAction,startsAt:start,sendProposal:async()=>{}});
  const pending=(await query('SELECT status,proposed_starts_at,proposal_version FROM appointment_booking_approvals ORDER BY appointment_id')).rows;
  assert.equal(pending.length,2);assert.ok(pending.every(row=>row.status==='awaiting_client_confirmation'&&row.proposal_version===proposed.proposalVersion));
  assert.equal(new Date(pending[0].proposed_starts_at).getTime(),new Date(pending[1].proposed_starts_at).getTime());
  assert.equal((await query('SELECT starts_at FROM appointment_groups')).rows[0].starts_at.toISOString(),START);
  const response={dbPool:db,appointmentId:result.appointmentIds[0],proposalVersion:proposed.proposalVersion,crmV2ClientId:55,now:NOW,
    validateWindow:inputAction.validateWindow,sendConfirmation:async()=>{},depositPreflight:async()=>{}};
  const before=await snapshot();
  await assert.rejects(approval.acceptProposedAlternative({...response,crmV2ClientId:999}),{code:'BOOKING_PROPOSAL_IDENTITY'});
  await assert.rejects(approval.acceptProposedAlternative({...response,appointmentId:result.appointmentIds[1]}),{code:'BOOKING_PROPOSAL_IDENTITY'});
  await assert.rejects(approval.acceptProposedAlternative({...response,proposalVersion:proposed.proposalVersion+1}),{code:'BOOKING_PROPOSAL_STALE'});
  assert.deepEqual(await snapshot(),before);
  await approval.acceptProposedAlternative(response);
  const after=await snapshot();assert.ok(after.approvals.every(row=>row.status==='approved'));
  assert.ok(after.appointments.every(row=>row.starts_at.toISOString()===new Date(start).toISOString()));assert.equal(after.groups[0].starts_at.toISOString(),new Date(start).toISOString());
  await assert.rejects(approval.acceptProposedAlternative(response),{code:'BOOKING_COUPLES_CHANGED'});
});

test('another option or expired offer releases both proposals; original shared appointments stay unchanged',async t=>{
  const {inputAction,db,result,query}=await created(t);
  let proposed=await approval.proposeAlternative({...inputAction,startsAt:'2030-11-03T08:00:00Z',sendProposal:async()=>{}});
  const response={dbPool:db,appointmentId:result.appointmentIds[0],proposalVersion:proposed.proposalVersion,crmV2ClientId:55};
  await approval.requestAnotherOption(response);
  assert.ok((await query('SELECT status,proposed_starts_at FROM appointment_booking_approvals')).rows.every(row=>row.status==='pending'&&row.proposed_starts_at===null));
  proposed=await approval.proposeAlternative({...inputAction,startsAt:'2030-11-03T08:00:00Z',sendProposal:async()=>{}});
  const expired=await approval.acceptProposedAlternative({...response,proposalVersion:proposed.proposalVersion,now:new Date('2030-10-03')});
  assert.equal(expired.status,'pending');assert.match(expired.reply,/expired/);
  assert.ok((await query('SELECT starts_at FROM appointments')).rows.every(row=>row.starts_at.toISOString()===START));
});

test('second client conflict or canonical drift leaves both request members unchanged',async t=>{
  const {inputAction,query,snapshot,result}=await created(t);const before=await snapshot();let n=0;
  await assert.rejects(approval.proposeAlternative({...inputAction,startsAt:'2030-11-03T08:00:00Z',validateWindow:async()=>({ok:++n===1}),sendProposal:async()=>{}}),{code:'BOOKING_REQUEST_ALTERNATIVE_UNAVAILABLE'});
  assert.deepEqual(await snapshot(),before);
  await query('UPDATE appointments SET updated_at=updated_at+INTERVAL \'1 second\' WHERE id=$1',[result.appointmentIds[1]]);
  const changed=await snapshot();await assert.rejects(approval.acceptRequestedAppointment(inputAction),{code:'BOOKING_COUPLES_CHANGED'});assert.deepEqual(await snapshot(),changed);
});

test('existing enquiry creates, approves and links one pair atomically; missing agreement and retries are safe',async t=>{
  const {enquiry,query,state,snapshot}=await setup(t);
  await query(`INSERT INTO client_planning_requests(submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,preferred_date,preferred_daypart,special_occasion,occasion_note)
    VALUES('a81e1cad-30af-45b4-a204-7d653d1ead31',$1,55,'flexible','Couples Massage','2030-11-02','morning',true,'Anniversary')`,['a'.repeat(64)]);
  const id=(await query('SELECT id FROM client_planning_requests')).rows[0].id;
  await assert.rejects(enquiry.completeCouplesEnquiry({principal:{id:11,business_role:'practitioner',calendar_scope:'all_business'},id,action:'options'}),{code:'PLANNING_FORBIDDEN'});
  const options=await enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'options'});assert.equal(options.preferredDate,'2030-11-02');
  const payload={staffIds:[11,12],startsAt:START,guest:GUEST};
  const review=await enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'review',payload});
  Object.assign(payload,{quoteHash:review.quoteHash,requestId:'enquiry_booking_request_1',revision:options.revision});
  const before=await snapshot();await assert.rejects(enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'confirm',payload}),{code:'PLANNING_CLIENT_AGREEMENT_REQUIRED'});assert.deepEqual(await snapshot(),before);
  state.failApproval=true;await assert.rejects(enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'confirm',payload:{...payload,clientAgreed:true}}),{code:'BOOKING_CART_APPROVAL_FAILED'});state.failApproval=false;
  assert.deepEqual(await snapshot(),before);
  const result=await enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'confirm',payload:{...payload,clientAgreed:true}});
  const retry=await enquiry.completeCouplesEnquiry({principal:OWNER,id,action:'confirm',payload:{...payload,clientAgreed:true}});
  assert.deepEqual(result.appointmentIds,retry.appointmentIds);assert.equal(retry.replay,true);
  const after=await snapshot();assert.equal(after.enquiries[0].status,'arranged');assert.equal(Number(after.enquiries[0].linked_appointment_id),result.appointmentIds[0]);assert.ok(after.approvals.every(row=>row.status==='approved'&&row.client_occasion_note==='Anniversary'));
  assert.equal(state.confirmations.length,2);assert.equal(state.alerts.length,0);
  assert.ok((await query('SELECT channel FROM booking_policy_acceptances')).rows.every(row=>row.channel==='workspace_client_agreement'));
});


test('Reception shows one complete couples card; organiser and guest response permissions stay distinct',async t=>{
  const {db,result,query}=await created(t);
  const routing=require('../src/services/workspaceBookingRequestRouting');
  const requests=await routing.listUnresolvedBookingRequests({db,principal:OWNER,now:NOW});
  assert.equal(requests.length,1);assert.equal(requests[0].members.length,2);
  assert.equal(requests[0].groupTotal,'1080.01');assert.match(requests[0].clientName,/Synthetic Organiser & Synthetic Guest/);
  const context=createMyShilohClientContextService({db,now:()=>NOW});
  const organiser=(await context.loadActiveBookingRequests(55))[0];
  assert.equal(organiser.practitioners.length,2);assert.equal(organiser.totalPrice,'1080.01');assert.equal(organiser.canRespondToProposal,true);
  const guestId=(await query('SELECT crm_v2_client_id FROM appointments WHERE id=$1',[result.appointmentIds[1]])).rows[0].crm_v2_client_id;
  const guest=(await context.loadActiveBookingRequests(guestId))[0];assert.equal(guest.canRespondToProposal,false);
});


test('a changed guest identity or parent window blocks confirmation of the whole pair',async t=>{
  const {inputAction,query,result,snapshot}=await created(t);
  await query(`UPDATE crm_v2_clients SET status='archived' WHERE id=(SELECT crm_v2_client_id FROM appointments WHERE id=$1)`,[result.appointmentIds[1]]);
  let before=await snapshot();await assert.rejects(approval.acceptRequestedAppointment(inputAction),{code:'BOOKING_COUPLES_CHANGED'});assert.deepEqual(await snapshot(),before);
  await query(`UPDATE crm_v2_clients SET status='active' WHERE id=(SELECT crm_v2_client_id FROM appointments WHERE id=$1)`,[result.appointmentIds[1]]);
  await query(`UPDATE appointment_groups SET starts_at=starts_at+INTERVAL '15 minutes'`);
  before=await snapshot();await assert.rejects(approval.acceptRequestedAppointment(inputAction),{code:'BOOKING_COUPLES_CHANGED'});assert.deepEqual(await snapshot(),before);
});

test('paired practitioner changes can swap assignments; a client overlap releases both proposed holds',async t=>{
  const {inputAction,db,result,query}=await created(t);const start='2030-11-03T08:00:00Z';
  const proposed=await approval.proposeAlternative({...inputAction,startsAt:start,staffIds:[12,11],sendProposal:async()=>{}});
  assert.deepEqual((await query('SELECT proposed_staff_id FROM appointment_booking_approvals ORDER BY appointment_id')).rows.map(row=>Number(row.proposed_staff_id)),[12,11]);
  await query(`INSERT INTO appointments(crm_v2_client_id,location_id,starts_at,ends_at,status,title,total_price,currency,source)
    SELECT crm_v2_client_id,location_id,'2030-11-03T08:00Z','2030-11-03T09:00Z','scheduled','Another visit',100,'ZAR','test' FROM appointments WHERE id=$1`,[result.appointmentIds[1]]);
  const response=await approval.acceptProposedAlternative({dbPool:db,appointmentId:result.appointmentIds[0],proposalVersion:proposed.proposalVersion,crmV2ClientId:55,now:NOW,validateWindow:inputAction.validateWindow,sendConfirmation:async()=>{}});
  assert.equal(response.status,'pending');assert.match(response.reply,/no longer available/);
  assert.ok((await query('SELECT status,proposed_starts_at FROM appointment_booking_approvals')).rows.every(row=>row.status==='pending'&&row.proposed_starts_at===null));
  assert.ok((await query('SELECT starts_at FROM appointments WHERE id=ANY($1::bigint[])',[result.appointmentIds])).rows.every(row=>row.starts_at.toISOString()===START));
});
