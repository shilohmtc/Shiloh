const test = require('node:test');
const assert = require('node:assert/strict');
const { consultationRecovery } = require('../src/services/bookingRecovery');
const { renderBookingRecovery } = require('../src/presentation/calendarPaymentsUx');

test('consultation recovery reports only link availability, never the private token', async () => {
  const db = { query: async (_sql, values) => {
    assert.deepEqual(values, [779]);
    return { rows: [{ status:'sent',access_expires_at:new Date(Date.now()+3600000),has_access_token:true }] };
  } };
  const result = await consultationRecovery(db, 779);
  assert.deepEqual(result, [{ status:'sent',linkAvailable:true }]);
  assert.doesNotMatch(JSON.stringify(result),/private/);
});

test('Reception recovery keeps the booking, shows failed request and form next step without recording payment', () => {
  const html = renderBookingRecovery({
    subject:{final:false},authority:{canCollect:true},
    payment:{outstanding:'590.00',requests:[{state:'cancelled',amount:'295.00'}]},
    consultationRecovery:[{status:'sent',linkAvailable:false}],
  });
  assert.match(html,/My Shiloh to get a fresh form link/);
  assert.match(html,/Latest payment request: cancelled/);
  assert.match(html,/Create a secure payment link below/);
  assert.doesNotMatch(html,/Record deposit received/);
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
