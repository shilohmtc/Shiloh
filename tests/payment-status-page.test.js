const test=require('node:test');
const assert=require('node:assert/strict');
const {renderPaymentStatusPage}=require('../src/presentation/paymentStatusUx');

test('public payment status page is safe for a client without a Workspace session',()=>{const html=renderPaymentStatusPage({requestKey:'request_123',request:{amount:'20.00',state:'paid'}});assert.match(html,/Payment received/);assert.match(html,/do not need to pay again/);assert.doesNotMatch(html,/calendar\/payments\/appointments/);});

test('failed link offers a prefilled human WhatsApp request, without a payment token or automatic charge', () => {
  const html = renderPaymentStatusPage({ requestKey:'secret_request_123', request:{amount:'295.00',state:'cancelled',appointment_id:779,appointment_status:'scheduled'}, whatsappNumber:'+27 82 000 1234' });
  assert.match(html, /Request a new payment link on WhatsApp/);
  assert.match(html, /https:\/\/wa\.me\/27820001234\?text=/);
  assert.match(html, /booking%20%23779/);
  assert.doesNotMatch(html.match(/href="(https:\/\/wa\.me\/[^\"]+)"/)?.[1] || '', /secret_request_123/);
  assert.match(html, /does not create a payment or a new booking/);
});

test('paid, pending and cancelled bookings cannot request another link from status', () => {
  for (const state of ['paid', 'pending']) {
    assert.doesNotMatch(renderPaymentStatusPage({request:{amount:'295.00',state,appointment_id:779,appointment_status:'scheduled'},whatsappNumber:'27820001234'}),/Request a new payment link on WhatsApp/);
  }
  assert.doesNotMatch(renderPaymentStatusPage({request:{amount:'295.00',state:'failed',appointment_id:779,appointment_status:'cancelled'},whatsappNumber:'27820001234'}),/Request a new payment link on WhatsApp/);
});
