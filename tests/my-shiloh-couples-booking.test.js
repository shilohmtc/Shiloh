'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGuest,assertPair,createMyShilohMultipleBookingService } = require('../src/services/myShilohMultipleBooking');
const { createBookingPaymentService } = require('../src/services/bookingPayments');
const pair = [11,12].map(staffId => ({ serviceId:1,staffId,startsAt:'2026-11-02T08:00:00.000Z' }));
const guest = { name:'Guest Person',mobile:'082 234 5678',consent:true };
test('guest authority normalizes only consented booking details and denies identity/profile injection', () => {
  assert.deepEqual(normalizeGuest(guest),{ name:'Guest Person',mobile:'27822345678',consent:true });
  for (const input of [null,{ ...guest,consent:false },{ ...guest,mobile:'123' },{ ...guest,crmV2ClientId:99 },{ ...guest,marketingConsent:true },{ ...guest,name:'<script>' }]) assert.throws(() => normalizeGuest(input),{ code:'BOOKING_GUEST_INVALID' });
  assert.doesNotThrow(() => assertPair(pair));
  for (const input of [pair.slice(0,1),[pair[0],pair[0]],[pair[0],{ ...pair[1],startsAt:'2026-11-02T09:00:00.000Z' }]]) assert.throws(() => assertPair(input),{ code:'BOOKING_COUPLES_SELECTION' });
});
test('shared availability intersects both canonical duration checks and does not supply guest entitlements', async () => {
  const calls = [];
  const service = createMyShilohMultipleBookingService({ couples:true,booking:{ slots:async input => {
    calls.push(input); return { slots:input.staffId === 11 ? [{ startsAt:pair[0].startsAt,time:'10:00',endTime:'11:00' },{ startsAt:'2026-11-02T09:00:00Z' }] : [{ startsAt:'2026-11-02T08:00:00Z',endTime:'11:30' }] };
  } } });
  const available = await service.availability({ serviceIds:[1,2],staffIds:[11,12],date:'2026-11-02' });
  assert.equal(available.slots.length,1); assert.equal(available.slots[0].guestEndTime,'11:30');
  assert.deepEqual(calls,[{ serviceId:1,staffId:11,date:'2026-11-02' },{ serviceId:2,staffId:12,date:'2026-11-02' }]);
  await assert.rejects(service.availability({ serviceIds:[1,1],staffIds:[11,11] }),{ code:'BOOKING_COUPLES_SELECTION' });
});
test('couples endpoints preserve session, origin, CSRF, server identity and unknown-key boundaries', async () => {
  const express = require('express'); const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const received = []; const app = express(); app.use(express.json());
  const action = async input => { received.push(input); return { total:'1180.00' }; };
  app.use(createMyShilohRouter({ env:{ NODE_ENV:'test' },sessionService:{
    validateSessionToken:async token => token === 'signed-in' ? { ok:true,crmV2ClientId:55,sessionId:1 } : { ok:false },validateCsrfToken:(_s,t) => t === 'csrf',
  },couplesBookingService:{ availability:action,review:action,createRequest:action } }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'content-type':'application/json',origin,cookie:'shiloh_client_session=signed-in','x-shiloh-csrf-token':'csrf' };
  const send = (action,body,extra={}) => fetch(origin+'/my-shiloh/api/booking/couples/'+action,{ method:'POST',headers:{ ...headers,...extra },body:JSON.stringify(body) });
  try {
    assert.equal((await send('review',{ guest,treatments:pair },{ cookie:'' })).status,401);
    assert.equal((await send('availability',{}, { origin:'https://evil.example' })).status,403);
    assert.equal((await send('confirm',{}, { 'x-shiloh-csrf-token':'' })).status,403);
    for (const action of ['availability','review','confirm']) assert.equal((await send(action,{ crmV2ClientId:99 })).status,422);
    assert.equal(received.length,0);
    const review = await send('review',{ guest,treatments:pair }); assert.equal(review.status,200); assert.match(review.headers.get('cache-control'),/no-store/);
    assert.equal(received[0].crmV2ClientId,55); assert.deepEqual(received[0].guest,guest);
    assert.equal((await send('confirm',{ guest,treatments:pair,quoteHash:'a'.repeat(64),requestId:'request_1234567890',policyAccepted:true,specialOccasion:false })).status,201);
    assert.equal(received[1].crmV2ClientId,55);
  } finally { await new Promise(r => server.close(r)); }
});
for (const primaryExempt of [false,true]) test(`one combined deposit belongs to organiser even with primary exemption=${primaryExempt}`, async () => {
  let approved=false,row=null,providerCalls=0;
  const position={ applicable:true,scope:{ groupId:77,groupType:'couples_massage',groupSource:'shiloh_my_shiloh_couples',members:[
    { appointmentId:100,clientName:'Organiser',clientMobile:'27821234567',crmV2ClientId:55 },{ appointmentId:101,clientName:'Guest',clientMobile:'27822345678',crmV2ClientId:56 },
  ] },requirement:{ id:1,state:'awaiting',required_amount:primaryExempt ? '295.00' : '590.00',payment_account_id:9 },members:[
    { appointment_id:100,required_amount:primaryExempt ? '0.00' : '295.00' },{ appointment_id:101,required_amount:'295.00' },
  ] };
  const db={ async query(sql,values) {
    if(sql.includes('FROM appointment_group_members')) return { rows:[100,101].map(id => ({ appointment_id:id,status:'scheduled',approval_status:approved ? 'approved' : 'pending' })) };
    if(sql.includes('SELECT * FROM payment_requests'))return { rows:row ? [row] : [] };
    if(sql.includes('INSERT INTO payment_requests')) { assert.equal(values[3],'Organiser'); assert.equal(values[4],'27821234567'); assert.equal(values[5],55); assert.equal(values[7],100); row={ id:3,request_key:'dep_test',amount:values[2],state:'created' }; return { rows:[row] }; }
    if(sql.includes('UPDATE payment_requests')) { row={ ...row,provider_payment_url:'https://pay.ozow.com/test',state:'link_issued',deposit_notification_sent_at:new Date() }; return { rows:[row] }; }
    throw new Error(sql);
  } };
  const service=createBookingPaymentService({ db,deposits:{ ensureRequirement:async () => position },ozow:{ configured:() => true,createPaymentLink:async input => { providerCalls++; assert.equal(input.amount,position.requirement.required_amount); return { providerRequestId:'test',paymentUrl:'https://pay.ozow.com/test' }; } },notifyClient:null });
  assert.equal((await service.ensureDepositRequest({ appointmentId:100 })).status,'awaiting_group_approval'); assert.equal(providerCalls,0);
  approved=true;
  assert.equal((await service.ensureDepositRequest({ appointmentId:101 })).status,'deposit_waiting_on_group');
  assert.equal((await service.ensureDepositRequest({ appointmentId:100 })).requests.length,1);
  await service.ensureDepositRequest({ appointmentId:100 }); assert.equal(providerCalls,1);
});
