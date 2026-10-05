const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderMyShilohBookingPage } = require('../src/presentation/myShilohBooking');
const visit = (id, service) => ({ id, status: 'confirmed', startsAt: '2026-10-06T08:45:00Z', services: [service], practitioners: ['Christel'] });
const deposit = { accountId: 20, state: 'unpaid', depositState: 'awaiting', depositOutstanding: '295.00', activePaymentPath: '/pay/SWEDISH123' };
function context() {
  const first = visit(1, 'Toe Gel Only');
  return { client: { name: 'Jean-Pierre' }, nextAppointment: first, upcomingAppointments: [first, visit(2, 'Full Body Swedish')], payment: { state: 'paid' }, forms: [{ actionRequired: true, title: 'Form' }], appointmentPayments: [{ appointmentId: 1, payment: { state: 'paid' } }, { appointmentId: 2, payment: deposit }] };
}
test('later Swedish deposit stays visible alongside an earlier paid visit, forms and a pending request', () => {
  const data = context();
  data.activeRequests = [{ ...visit(3, 'Another visit'), bookingRequestStatus: 'pending' }];
  const experience = buildClientExperience(data);
  assert.equal(experience.home.payments.length, 1);
  assert.equal(experience.home.payments[0].service, 'Full Body Swedish');
  assert.equal(experience.home.payments[0].label, 'R295 deposit required');
  assert.equal(experience.home.payments[0].href, '/pay/SWEDISH123');
  assert.equal(experience.home.facts.find(item => item.key === 'payment').value, 'R295 deposit required');
  const booking = experience.bookings.upcoming.find(item => item.id === 2);
  assert.equal(booking.paymentPath, '/pay/SWEDISH123');
  assert.equal(booking.nextAction, 'R295 deposit required');
});
test('shared payment account appears once and missing links keep the deposit visible', () => {
  const data = context();
  data.upcomingAppointments.push(visit(4, 'Another treatment'));
  data.appointmentPayments[1].payment = { ...deposit, activePaymentPath: null };
  data.appointmentPayments.push({ appointmentId: 4, payment: { ...deposit, activePaymentPath: null } });
  const experience = buildClientExperience(data);
  assert.equal(experience.home.payments.length, 1);
  assert.equal(experience.home.payments[0].href, '#shiloh');
  assert.equal(experience.bookings.upcoming.find(item => item.id === 4).paymentHelpNeeded, true);
});
test('Home is focused and choosing help lives inside Shiloh', () => {
  const html = renderMyShilohPage({ client: { id: 1, firstName: 'Jean-Pierre' } });
  const home = html.split('id="home"')[1].split('id="bookings"')[0];
  assert.doesNotMatch(home, /Discover|Need help choosing/);
  assert.match(home, /data-client-home-payments/);
  assert.match(html.split('id="shiloh"')[1], /Need help choosing/);
  const booking = renderMyShilohBookingPage({ clientFirstName: 'Jean-Pierre' });
  assert.match(booking, /<h1>Book an appointment\.<\/h1>/);
});

test('client context loads later payment accounts with the same signed-in payer scope', async () => {
  const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
  const rows = [1, 2].map(id => ({ id, crm_v2_client_id: 55, starts_at: '2026-10-06T08:45:00Z', ends_at: '2026-10-06T09:45:00Z', status: 'confirmed', total_price: '590', services: [{ name: id === 1 ? 'Toe Gel Only' : 'Full Body Swedish' }], practitioners: [{ name: 'Christel' }] }));
  const calls = [];
  const db = { async query(sql, values) {
    if (sql.includes('myShilohClientContext:client')) return { rows: [{ id: 55, name: 'Jean-Pierre Botha' }] };
    if (sql.includes('myShilohClientContext:next-appointment')) return { rows: [rows[0]] };
    if (sql.includes('myShilohClientContext:upcoming-appointments')) return { rows };
    if (sql.includes('myShilohClientContext:payment-position')) {
      calls.push(values[0]);
      return { rows: [{ id: values[0] + 10, canonical_amount_due: '590', paid: values[0] === 1 ? '590' : '0', refunded: '0', deposit_state: values[0] === 1 ? 'satisfied' : 'awaiting', deposit_required_amount: '295' }] };
    }
    if (sql.includes('myShilohClientContext:active-payment-request')) {
      assert.match(sql, /payer_crm_v2_client_id=\$2/);
      assert.equal(values[1], 55);
      return { rows: values[0] === 12 ? [{ request_key: 'SWEDISH123', purpose: 'deposit' }] : [] };
    }
    return { rows: [] };
  } };
  const service = createMyShilohClientContextService({ db, now: () => new Date('2026-10-05T18:00:00Z') });
  const data = await service.getContext({ crmV2ClientId: 55 });
  assert.deepEqual(calls.sort(), [1, 2]);
  assert.equal(data.appointmentPayments.length, 2);
  assert.equal(buildClientExperience(data).home.payments[0].href, '/pay/SWEDISH123');
});
