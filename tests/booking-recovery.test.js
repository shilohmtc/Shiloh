const test = require('node:test');
const assert = require('node:assert/strict');
const { consultationRecovery } = require('../src/services/bookingRecovery');
const { renderBookingRecovery, renderCalendarPaymentPage } = require('../src/presentation/calendarPaymentsUx');

test('consultation recovery reports only link availability, never the private token', async () => {
  const db = { query: async (_sql, values) => {
    assert.deepEqual(values, [779]);
    return { rows: [{ status:'sent',access_expires_at:new Date(Date.now()+3600000),has_access_token:true }] };
  } };
  const result = await consultationRecovery(db, 779);
  assert.deepEqual(result, [{ status:'sent',linkAvailable:true }]);
  assert.doesNotMatch(JSON.stringify(result),/private/);
});

test('Reception recovery keeps the booking and gives a cancelled deposit one collection path', () => {
  const html = renderBookingRecovery({
    subject:{final:false},authority:{canCollect:true},
    payment:{outstanding:'490.00',requests:[{state:'cancelled',purpose:'deposit',amount:'295.00'}]},
    deposit:{requirement:{state:'awaiting',required_amount:'295.00'}},
    consultationRecovery:[{status:'sent',linkAvailable:false}],
  });
  assert.match(html,/My Shiloh to get a fresh form link/);
  assert.match(html,/previous deposit link was cancelled and cannot be used/);
  assert.doesNotMatch(html,/Create a secure payment link below/);
  assert.doesNotMatch(html,/data-retry-deposit/);
  assert.doesNotMatch(html,/Record deposit received/);
});

test('cancelled deposit screen has one link form and no cancellation policy paragraph', () => {
  const html = renderCalendarPaymentPage({ model: {
    subject:{appointmentId:779,clientName:'Test Client',clientMobile:'0712345678'},
    payment:{state:'unpaid',amountDue:'590.00',netPaid:'0.00',rewardsApplied:'0.00',outstanding:'490.00',requests:[{state:'cancelled',purpose:'deposit',amount:'295.00'}],entries:[]},
    deposit:{applicable:true,requirement:{state:'awaiting',required_amount:'295.00',net_paid:'0.00',rate_basis_points:5000},policy:{rateBasisPoints:5000},events:[]},
    authority:{canCollect:true,canRefund:false,ozowConfigured:true},
  } });
  assert.match(html,/New deposit payment link/);
  assert.match(html,/name="amount" inputmode="decimal" value="295\.00"/);
  assert.equal((html.match(/Create deposit payment link/g)||[]).length,1);
  assert.doesNotMatch(html,/48\+ hours notice|24–48 hours|no-show: 100%/);
  assert.doesNotMatch(html,/Create a secure payment link below/);
  assert.match(html,/Deposit · .*Ozow/);
});

test('Reception can retry an awaiting deposit link without starting a separate balance request', () => {
  const model = {
    subject: { final:false },
    authority: { canCollect:true, ozowConfigured:true },
    deposit: { requirement: { state:'awaiting', required_amount:'295.00' } },
    payment: { outstanding:'590.00', requests:[{ state:'created', purpose:'deposit', amount:'295.00' }] },
  };
  assert.match(renderBookingRecovery(model), /data-retry-deposit>Prepare deposit link/);
  assert.doesNotMatch(renderBookingRecovery({ ...model, authority:{ canCollect:false, ozowConfigured:true } }), /data-retry-deposit/);
  assert.doesNotMatch(renderBookingRecovery({ ...model, payment:{ ...model.payment, requests:[{ state:'link_issued', provider_payment_url:'https:\/\/pay.ozow.com\/link' }] } }), /data-retry-deposit/);
});
