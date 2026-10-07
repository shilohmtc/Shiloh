'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMyShilohMultipleBookingService, assertClientWindows, selections, clientGroupApprovalGate } = require('../src/services/myShilohMultipleBooking');
const { createBookingPaymentService } = require('../src/services/bookingPayments');

const treatments = [
  { serviceId:1, staffId:11, startsAt:'2026-11-02T08:00:00.000Z' },
  { serviceId:2, staffId:12, startsAt:'2026-11-03T10:00:00.000Z' },
];
function fixture() {
  const calls = [], alerts = [], approvals = [];
  const control = { conflict:false, price:'650.00', replay:null, failApproval:false, ownConflict:false };
  let nextId = 100;
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes('pg_advisory_xact_lock')) return { rows:[],rowCount:0 };
      if (sql.includes('FROM crm_v2_clients c WHERE id=$1 FOR UPDATE')) return { rows:[{ id:55,name:'Naledi',normalized_mobile:'27821234567',status:'active' }],rowCount:1 };
      if (sql.includes("action='client.multiple_booking_created'")) return { rows:control.replay ? [{ metadata:control.replay }] : [],rowCount:control.replay ? 1 : 0 };
      if (sql.includes('FROM services s JOIN staff_services')) {
        assert.match(sql, /client_bookable=TRUE/);
        assert.match(sql, /tenant_practitioner/);
        assert.match(sql, /s.external_source IS DISTINCT FROM 'shiloh_special'/);
        return { rows:[{ id:values[0],name:values[0] === 1 ? 'Massage' : 'Pedicure',price:control.price,duration_minutes:60,
          staff_id:values[1],staff_name:values[1] === 11 ? 'Christel' : 'Abigail' }],rowCount:1 };
      }
      if (sql.includes('SELECT id FROM locations')) return { rows:[{ id:1 }],rowCount:1 };
      if (sql.includes('SELECT id FROM appointments WHERE crm_v2_client_id')) return { rows:control.ownConflict ? [{ id:44 }] : [],rowCount:control.ownConflict ? 1 : 0 };
      if (sql.includes('INSERT INTO appointment_groups')) return { rows:[{ id:77 }],rowCount:1 };
      if (sql.includes('INSERT INTO appointments')) return { rows:[{ id:nextId++ }],rowCount:1 };
      if (sql.includes("VALUES('client.multiple_booking_created'")) { control.replay = JSON.parse(values[1]); return { rows:[],rowCount:1 }; }
      if (sql.trim().startsWith('INSERT')) return { rows:[],rowCount:1 };
      throw new Error('Unexpected query: ' + sql);
    },
    async connect() { return { query:db.query, release() { calls.push({ sql:'RELEASE' }); } }; },
  };
  const service = createMyShilohMultipleBookingService({
    db, deposits:{ loadPolicy:async () => ({ rateBasisPoints:5000,exemptStaffId:12 }) },
    booking:{ slots:async ({ staffId }) => ({ slots:[{ startsAt:treatments.find(item => item.staffId === staffId).startsAt }] }) },
    ensureApproval:async () => {}, stageApproval:async (_db, input, options) => {
      approvals.push(input); assert.equal(options.schemaReady,true); return control.failApproval && approvals.length === 2 ? null : {};
    },
    alert:async input => { assert.ok(calls.some(item => item.sql === 'COMMIT')); alerts.push(input); },
    locationProvider:async () => ({ id:1 }), checkClinic:async () => ({ covered:true }),
    checkSchedule:async () => ({ covered:true }), conflicts:async ({ staffId }) => control.conflict && staffId === 12 ? [{}] : [],
    now:() => new Date('2026-10-01T10:00:00Z'),
  });
  return { service,control,calls,alerts,approvals };
}
async function request(f) {
  const review = await f.service.review({ crmV2ClientId:55,treatments });
  return { crmV2ClientId:55,treatments,quoteHash:review.quoteHash,requestId:'request_1234567890',policyAccepted:true,specialOccasion:false };
}

test('review totals use canonical prices and per-member deposit exemptions across dates', async () => {
  const f = fixture(); const quote = await f.service.review({ crmV2ClientId:55,treatments });
  assert.equal(quote.total,'1300.00'); assert.equal(quote.deposit,'325.00');
  assert.deepEqual(quote.treatments.map(item => item.deposit), ['325.00','0.00']);
  assert.equal(f.calls.some(item => item.sql.includes('INSERT')), false);
});
test('client cannot submit prices, another identity or overlapping appointments', () => {
  assert.throws(() => selections([{ ...treatments[0],price:1 },treatments[1]]), { code:'BOOKING_CART_SELECTION' });
  assert.throws(() => selections(treatments.slice(0,1)), { code:'BOOKING_CART_COUNT' });
  assert.throws(() => assertClientWindows([
    { startsAt:'2026-11-02T08:00:00Z',endsAt:'2026-11-02T09:00:00Z',staffId:11 },
    { startsAt:'2026-11-02T08:30:00Z',endsAt:'2026-11-02T09:30:00Z',staffId:12 },
  ]), { code:'BOOKING_CART_OVERLAP' });
});
test('every slot is checked before any appointment write; conflict rolls back the whole request', async () => {
  const f = fixture(); const input = await request(f); f.control.conflict = true;
  await assert.rejects(f.service.createRequest(input), { code:'BOOKING_CART_CONFLICT' });
  assert.ok(f.calls.some(item => item.sql === 'ROLLBACK'));
  assert.equal(f.calls.some(item => item.sql.includes('INSERT')), false);
  assert.equal(f.alerts.length,0);
});
test('a client cannot overlap one of their existing appointments with a different practitioner', async () => {
  const f = fixture(); const input = await request(f); f.control.ownConflict = true;
  await assert.rejects(f.service.createRequest(input), { code:'BOOKING_CART_CONFLICT' });
});
test('changed canonical prices require a fresh review before any write', async () => {
  const f = fixture(); const input = await request(f); f.control.price = '700.00';
  await assert.rejects(f.service.createRequest(input), { code:'BOOKING_CART_QUOTE_CHANGED' });
  assert.equal(f.calls.some(item => item.sql.includes('INSERT')), false);
});
test('one transaction creates independent held appointments, policy acceptances, approvals and group allocations', async () => {
  const f = fixture(); const result = await f.service.createRequest(await request(f));
  assert.deepEqual(result.appointmentIds,[100,101]); assert.equal(result.groupId,77);
  assert.equal(result.status,'pending_resolution'); assert.equal(result.deposit,'325.00');
  assert.equal(f.calls.filter(item => item.sql.includes('INSERT INTO booking_policy_acceptances')).length,2);
  assert.equal(f.calls.filter(item => item.sql.includes('INSERT INTO appointment_group_members')).length,2);
  assert.deepEqual(f.calls.filter(item => item.sql.includes('pg_advisory_xact_lock($1')).map(item => item.values[0]),[11,12]);
  assert.equal(f.approvals.length,2); assert.equal(f.alerts.length,2);
});
test('failed approval setup rolls back and does not dispatch staff alerts', async () => {
  const f = fixture(); const input = await request(f); f.control.failApproval = true;
  await assert.rejects(f.service.createRequest(input), { code:'BOOKING_CART_APPROVAL_FAILED' });
  assert.ok(f.calls.some(item => item.sql === 'ROLLBACK')); assert.equal(f.alerts.length,0);
});
test('a repeated request returns existing appointment IDs and rejects a changed payload', async () => {
  const f = fixture(); const input = await request(f);
  const created = await f.service.createRequest(input); const writes = f.calls.filter(item => item.sql.includes('INSERT')).length;
  const replay = await f.service.createRequest(input);
  assert.deepEqual(replay.appointmentIds,created.appointmentIds); assert.equal(replay.replay,true);
  assert.equal(f.calls.filter(item => item.sql.includes('INSERT')).length,writes);
  await assert.rejects(f.service.createRequest({ ...input,specialOccasion:true,occasionNote:'Birthday' }), { code:'BOOKING_CART_REQUEST_CHANGED' });
});
test('group payment waits for all approvals and refuses cancelled or missing members', async () => {
  for (const states of [['approved','pending'],['approved','approved'],['approved',null]]) {
    const db = { query:async () => ({ rows:states.map((status,index) => ({ appointment_id:100+index,status:'scheduled',approval_status:status })) }) };
    assert.equal((await clientGroupApprovalGate(db,77)).ready, states.every(state => state === 'approved'));
  }
  assert.equal((await clientGroupApprovalGate({ query:async () => ({ rows:[{ appointment_id:100,status:'scheduled',approval_status:'approved' },{ appointment_id:101,status:'cancelled',approval_status:'approved' }] }) },77)).ready,false);
});
test('pending group creates no provider link; approved group issues one combined deposit request', async () => {
  let approved = false, providerCalls = 0;
  const position = { applicable:true,scope:{ groupId:77,groupType:'multi_service_booking',groupSource:'shiloh_my_shiloh_multi',members:[
    { appointmentId:100,clientName:'Naledi',clientMobile:'27821234567',crmV2ClientId:55 },
    { appointmentId:101,clientName:'Naledi',clientMobile:'27821234567',crmV2ClientId:55 },
  ] },requirement:{ id:1,state:'awaiting',required_amount:'650.00',payment_account_id:9 },members:[
    { appointment_id:100,required_amount:'325.00' },{ appointment_id:101,required_amount:'325.00' },
  ] };
  let row;
  const db = { async query(sql) {
    if (sql.includes('FROM appointment_group_members')) return { rows:[100,101].map(id => ({ appointment_id:id,status:'scheduled',approval_status:approved ? 'approved' : 'pending' })) };
    if (sql.includes('SELECT * FROM payment_requests')) return { rows:row ? [row] : [] };
    if (sql.includes('INSERT INTO payment_requests')) { row = { id:3,request_key:'dep_test_combined',amount:'650.00',state:'created' }; return { rows:[row] }; }
    if (sql.includes('UPDATE payment_requests')) { row = { ...row,provider_payment_url:'https://pay.ozow.com/combined',state:'link_issued',deposit_notification_sent_at:new Date() }; return { rows:[row] }; }
    throw new Error(sql);
  } };
  const service = createBookingPaymentService({ db,deposits:{ ensureRequirement:async () => position },
    ozow:{ configured:() => true,createPaymentLink:async input => { providerCalls++; assert.equal(input.amount,'650.00'); return { providerRequestId:'combined',paymentUrl:'https://pay.ozow.com/combined' }; } },notifyClient:null });
  assert.equal((await service.ensureDepositRequest({ appointmentId:100 })).status,'awaiting_group_approval');
  assert.equal(providerCalls,0);
  approved = true;
  const result = await service.ensureDepositRequest({ appointmentId:100 });
  assert.equal(result.requests.length,1); assert.equal(providerCalls,1);
  await service.ensureDepositRequest({ appointmentId:100 }); assert.equal(providerCalls,1);
});

test('multiple-booking routes enforce session, origin, CSRF and server-owned identity', async () => {
  const express = require('express');
  const { createMyShilohRouter } = require('../src/routes/myShiloh');
  const received = [];
  const app = express(); app.use(express.json());
  app.use(createMyShilohRouter({ env:{ NODE_ENV:'test' },sessionService:{
    validateSessionToken:async token => token === 'signed-in' ? { ok:true,crmV2ClientId:55,sessionId:1 } : { ok:false },
    validateCsrfToken:(_session,token) => token === 'valid-csrf',
  },multipleBookingService:{ review:async input => { received.push(input); return { total:'1300.00' }; },createRequest:async input => { received.push(input); return { status:'pending_resolution' }; } } }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'content-type':'application/json',origin,cookie:'shiloh_client_session=signed-in','x-shiloh-csrf-token':'valid-csrf' };
  const send = (action,body,overrides={}) => fetch(origin+'/my-shiloh/api/booking/multiple/'+action,{ method:'POST',headers:{ ...headers,...overrides },body:JSON.stringify(body) });
  try {
    assert.equal((await send('review',{ treatments },{ cookie:'' })).status,401);
    assert.equal((await send('review',{ treatments },{ origin:'https://untrusted.example' })).status,403);
    assert.equal((await send('confirm',{ treatments },{ 'x-shiloh-csrf-token':'' })).status,403);
    assert.equal((await send('review',{ treatments,crmV2ClientId:99 })).status,422);
    assert.equal(received.length,0);
    const review = await send('review',{ treatments }); assert.equal(review.status,200); assert.match(review.headers.get('cache-control'),/no-store/);
    assert.equal(received[0].crmV2ClientId,55);
    assert.equal((await send('confirm',{ treatments,quoteHash:'a'.repeat(64),requestId:'request_1234567890',policyAccepted:true,specialOccasion:false })).status,201);
    assert.equal(received[1].crmV2ClientId,55);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('group confirmation waits for all approvals and dispatches each separate appointment after approval', async () => {
  const { sendCustomerBookingConfirmationForAppointment } = require('../src/services/customerBookingConfirmation');
  const selectedIds = [];
  let ready = false;
  const db = { async query(sql, values = []) {
    if (sql.includes('linked.group_id,linked.group_source')) {
      selectedIds.push(Number(values[0]));
      return { rows:[{ id:values[0],source:'shiloh_client_whatsapp',group_id:77,group_source:'shiloh_my_shiloh_multi' }] };
    }
    if (sql.includes('FROM appointment_group_members gm JOIN appointments')) return { rows:[100,101].map(id => ({ appointment_id:id,status:'scheduled',approval_status:ready ? 'approved' : id === 100 ? 'approved' : 'pending' })) };
    if (sql.includes('to_regclass')) return { rows:[{ table_name:'appointment_booking_approvals' }] };
    if (sql.includes('SELECT status FROM appointment_booking_approvals')) return { rows:[{ status:'approved' }] };
    if (sql.includes("action='customer.booking_confirmation_sent'")) return { rows:[{}],rowCount:1 };
    throw new Error(sql);
  } };
  const pending = await sendCustomerBookingConfirmationForAppointment(100,{ db });
  assert.equal(pending.reason,'practitioner_approval_required'); assert.deepEqual(selectedIds,[100]);
  selectedIds.length = 0; ready = true;
  const result = await sendCustomerBookingConfirmationForAppointment(101,{ db });
  assert.equal(result.confirmations.length,2); assert.deepEqual(selectedIds,[101,100,101]);
});
