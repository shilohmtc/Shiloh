'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, START, NOW, OWNER, GUEST } = require('./helpers/couplesRequestFixture');
const { normalizeGuests, createMyShilohMultipleBookingService } = require('../src/services/myShilohMultipleBooking');
const approval = require('../src/services/clientBookingApproval');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');

const guests = [GUEST,{name:'Synthetic Family Member',mobile:'0823345678',consent:true}];
const at = hours => new Date(new Date(START).getTime()+hours*3600000).toISOString();
const slots = [0,1,2,3].map(index=>({startsAt:at(index),endsAt:at(index+1),time:`${10+index}:00`,endTime:`${11+index}:00`}));

test('an incomplete family alternative cannot offer acceptance or invent a guest’s proposed time',()=>{
  const familyAppointments=[0,1,2].map(index=>({name:'Synthetic guest',service:'Massage',practitioner:'A',startsAt:at(index),endsAt:at(index+1),
    proposedStartsAt:index===2?null:at(index+1),proposedEndsAt:at(index+2),proposedPractitioner:'B'}));
  const model=buildClientExperience({generatedAt:NOW.toISOString(),client:{id:55,name:'Synthetic organiser'},nextAppointment:null,forms:[],payment:null,
    activeRequests:[{id:801,startsAt:START,endsAt:at(3),services:['Massage'],practitioners:['A'],bookingRequestStatus:'awaiting_client_confirmation',
      proposedStartsAt:at(1),proposalVersion:1,proposalExpiresAt:'2030-10-02T08:00:00Z',canRespondToProposal:true,familyAppointments}]});
  assert.equal(model.bookings.upcoming[0].proposal,null);
  assert.equal(model.bookings.upcoming[0].status,'Requested');
  assert.deepEqual(model.bookings.upcoming[0].familyAppointments.map(person=>person.time),['10:00','11:00','12:00']);
});

test('family identities require consent and one distinct guest per appointment',()=>{
  assert.equal(normalizeGuests(guests,null,3).length,2);
  for (const [list,guest,count] of [[guests,null,2],[[GUEST,GUEST],null,3],[guests,GUEST,3],[[...guests,{...GUEST,consent:false}],null,4]]) {
    assert.throws(()=>normalizeGuests(list,guest,count),{code:'BOOKING_GUEST_INVALID'});
  }
});

test('family availability intersects everyone or builds an ordered itinerary without overlapping a reused therapist',async()=>{
  const service=createMyShilohMultipleBookingService({couples:true,booking:{slots:async({staffId})=>({slots:staffId===12?slots.slice(1):slots})}});
  const together=await service.availability({serviceIds:[2,2,2],staffIds:[11,12,13],date:'2030-11-02'});
  assert.equal(together.slots.length,3);assert.deepEqual(together.slots[0].appointmentStartsAt,[at(1),at(1),at(1)]);
  await assert.rejects(service.availability({serviceIds:[2,2,2],staffIds:[11,12,11]}),{code:'BOOKING_COUPLES_SELECTION'});
  const turns=await service.availability({serviceIds:[2,2,2],staffIds:[11,11,12],date:'2030-11-02',timing:'in_turn'});
  assert.deepEqual(turns.slots[0].appointmentStartsAt,[at(0),at(1),at(2)]);
  assert.deepEqual(turns.slots[0].endTimes,['11:00','12:00','13:00']);
  await assert.rejects(service.availability({serviceIds:[2,2],staffIds:[11,12],timing:'invented'}),{code:'BOOKING_COUPLES_SELECTION'});
});

for(const timing of ['together','in_turn']) test(`three-person ${timing} request, rollback, replay, approval and alternatives preserve every guest`,async t=>{
  const {db,query,booking,service,snapshot,state}=await setup(t);
  await query("INSERT INTO staff VALUES(13,'Practitioner C','active','practitioner',true,'employee'); INSERT INTO staff_services VALUES(13,2)");
  booking.slots=async()=>({slots});
  const treatments=[11,12,timing==='together'?13:11].map((staffId,index)=>({serviceId:2,staffId,startsAt:timing==='together'?START:at(index)}));
  const data={crmV2ClientId:55,guests,treatments,timing};
  const quote=await service.review(data);assert.equal(quote.total,'1800.00');assert.equal(quote.deposit,'900.00');
  const input={...data,quoteHash:quote.quoteHash,requestId:'family_request_1234567',policyAccepted:true,specialOccasion:false};
  const before=await snapshot();state.failApproval=true;
  await assert.rejects(service.createRequest(input),{code:'BOOKING_CART_APPROVAL_FAILED'});
  assert.deepEqual(await snapshot(),before);assert.equal(state.alerts.length,0);state.failApproval=false;
  const result=await service.createRequest(input);const retry=await service.createRequest(input);
  assert.equal(result.appointmentIds.length,3);assert.deepEqual(result.appointmentIds,retry.appointmentIds);assert.equal(retry.replay,true);
  assert.equal((await snapshot()).clients.length,3);assert.equal((await snapshot()).groups[0].group_type,'group_booking');
  assert.equal(new Set((await snapshot()).appointments.map(row=>row.crm_v2_client_id)).size,3);
  await assert.rejects(service.createRequest({...input,timing:timing==='together'?'in_turn':'together'}));
  const context=createMyShilohClientContextService({db});
  const requests=await context.loadActiveBookingRequests(55);assert.equal(requests[0].familyAppointments.length,3);
  await query("UPDATE appointment_groups SET source='shiloh_calendar_group' WHERE id=$1",[result.groupId]);
  assert.deepEqual((await context.loadActiveBookingRequests(55))[0].familyAppointments,[],'a staff-created group does not grant first-guest access to everyone’s details');
  await query("UPDATE appointment_groups SET source='shiloh_my_shiloh_couples' WHERE id=$1",[result.groupId]);
  const otherClient=(await snapshot()).clients.find(row=>row.id!==55);
  const guestRequests=await context.loadActiveBookingRequests(otherClient.id);assert.deepEqual(guestRequests[0].familyAppointments,[]);assert.equal(guestRequests[0].canRespondToProposal,false);
  const current=(await query('SELECT requested_revision FROM appointment_booking_approvals WHERE appointment_id=$1',[result.appointmentIds[0]])).rows[0];
  const action={dbPool:db,principal:OWNER,appointmentId:result.appointmentIds[0],expectedRevision:current.requested_revision,now:NOW,
    validateWindow:async()=>({ok:true,canonical:{display_name:'Synthetic practitioner'}}),sendConfirmation:async()=>{},depositPreflight:async()=>{}};
  let preflights=0;const preApproval=await snapshot();
  await assert.rejects(approval.acceptRequestedAppointment({...action,depositPreflight:async()=>{if(++preflights===3)throw Error('Third payment check failed');}}),/Third payment/);
  assert.deepEqual(await snapshot(),preApproval);
  const shifted='2030-11-03T08:00:00Z';
  let checks=0;
  await assert.rejects(approval.proposeAlternative({...action,startsAt:shifted,validateWindow:async()=>({ok:++checks<3}),sendProposal:async()=>{}}),{code:'BOOKING_REQUEST_ALTERNATIVE_UNAVAILABLE'});
  assert.deepEqual(await snapshot(),preApproval);
  const proposal=await approval.proposeAlternative({...action,startsAt:shifted,sendProposal:async()=>{}});
  const response={dbPool:db,appointmentId:result.appointmentIds[0],crmV2ClientId:55,proposalVersion:proposal.proposalVersion,now:NOW,
    validateWindow:action.validateWindow,sendConfirmation:async()=>{},depositPreflight:async()=>{}};
  await assert.rejects(approval.acceptProposedAlternative({...response,crmV2ClientId:otherClient.id}),{code:'BOOKING_PROPOSAL_IDENTITY'});
  await approval.acceptProposedAlternative(response);
  const after=await snapshot();assert.ok(after.approvals.every(row=>row.status==='approved'));
  const moved=after.appointments.map(row=>new Date(row.starts_at).getTime());
  assert.deepEqual(moved.map(value=>value-moved[0]),treatments.map(item=>new Date(item.startsAt)-new Date(START)));
  assert.equal(after.groups[0].starts_at.toISOString(),new Date(shifted).toISOString());
  assert.equal((await context.loadNextAppointment(55)).familyAppointments.length,3);
  assert.deepEqual((await context.loadNextAppointment(otherClient.id)).familyAppointments,[]);
});

test('named Couples Massage cannot be stretched into a family price or taken sequentially',async t=>{
  const {service}=await setup(t);
  await assert.rejects(service.review({crmV2ClientId:55,guests,treatments:[11,12,13].map(staffId=>({serviceId:1,staffId,startsAt:START}))}),{code:'BOOKING_COUPLES_NAMED_PAIR'});
  await assert.rejects(service.review({crmV2ClientId:55,guest:GUEST,timing:'in_turn',treatments:[11,12].map((staffId,index)=>({serviceId:1,staffId,startsAt:at(index*2)}))}),{code:'BOOKING_COUPLES_NAMED_PAIR'});
});
