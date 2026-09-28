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
  assert.match(html,/<details class="payment-card recovery" aria-label="Reception help" open>/);
  assert.match(html,/Previous link cancelled · review next step/);
  assert.doesNotMatch(html,/WhatsApp message to the payer/);
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
  assert.doesNotMatch(html,/One person can pay the full balance/);
  assert.match(html,/<details class="payment-card manual-payment"><summary>Record payment received outside Ozow<\/summary>/);
  assert.match(html,/Never record an unresolved Ozow payment here/);
  assert.match(html,/name="receivedOutsideOzowConfirmed" required/);
});

test('welcome voucher reduces the balance without claiming cash has been paid', () => {
  const html = renderCalendarPaymentPage({ model: {
    subject:{appointmentId:779},
    payment:{state:'partially_paid',amountDue:'590.00',netPaid:'0.00',rewardsApplied:'0.00',welcomeVoucherApplied:'100.00',outstanding:'490.00',requests:[],entries:[]},
    authority:{canCollect:false,canRefund:false,ozowConfigured:false},
  } });
  assert.match(html,/Credit applied · payment due/);
  assert.match(html,/Welcome voucher used<\/small><strong>R\s?100[,.]00/);
  assert.match(html,/Net received<\/small><strong>R\s?0[,.]00/);
  assert.match(html,/Outstanding<\/small><strong>R\s?490[,.]00/);
  assert.doesNotMatch(html,/Partially paid/);
});

test('active payment link keeps reception help and manual settlement compact', () => {
  const html = renderCalendarPaymentPage({ model: {
    subject:{appointmentId:779},
    payment:{state:'unpaid',amountDue:'590.00',netPaid:'0.00',rewardsApplied:'0.00',outstanding:'590.00',requests:[{state:'link_issued',amount:'295.00',provider_payment_url:'https://pay.ozow.com/link',request_key:'active_779'}],entries:[]},
    authority:{canCollect:true,canRefund:false,ozowConfigured:true},
  } });
  assert.match(html,/<details class="payment-card recovery" aria-label="Reception help" ><summary>/);
  assert.match(html,/1 payment link ready · check payer/);
  assert.match(html,/<details class="payment-card manual-payment"><summary>Record payment received outside Ozow<\/summary>/);
});

test('failed Ozow attempt warns against requesting payment again after a bank debit', () => {
  const html = renderBookingRecovery({
    subject:{final:false},authority:{canCollect:true},
    payment:{outstanding:'490.00',requests:[{state:'failed',amount:'295.00'}]},
  });
  assert.match(html,/Payment link failed · review next step/);
  assert.match(html,/bank shows a debit, reconcile it with Ozow before requesting another payment/);
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
