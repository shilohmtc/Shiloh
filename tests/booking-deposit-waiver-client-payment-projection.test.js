'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { paymentPosition, buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');

for (const shared of [false, true]) for (const state of ['paid', 'partially_paid', 'unpaid']) {
  test(`waived ${shared ? 'shared' : 'ordinary'} booking retains actual ${state} and existing treatment-payment route`, () => {
    const outstanding = state === 'paid' ? '0.00' : '400.00';
    const payment = { accountId: 80, state, outstanding, depositState: 'waived', depositOutstanding: '0.00', depositRequired: '250.00', activePaymentPurpose: 'balance', activePaymentPath: '/pay/SYNTHETIC_TREATMENT' };
    const before = structuredClone(payment);
    const appointments = (shared ? [201, 203] : [201]).map(id => ({ id, startsAt: '2099-10-15T08:00:00Z', endsAt: '2099-10-15T09:00:00Z', status: 'confirmed', services: ['Synthetic treatment'], practitioners: ['Synthetic practitioner'] }));
    const experience = buildClientExperience({ client: { id: 101, name: 'Synthetic client' }, nextAppointment: appointments[0], upcomingAppointments: appointments, forms: [], payment, appointmentPayments: appointments.map(item => ({ appointmentId: item.id, payment })) });
    const expectedState = state === 'unpaid' ? 'payment_link_available' : state;
    for (const booking of experience.bookings.upcoming) {
      assert.equal(booking.paymentState, expectedState);
      assert.equal(booking.readiness, 'Confirmed');
      assert.match(booking.payment, /Deposit waived/);
      assert.match(booking.payment, state === 'paid' ? /Paid/ : /R400/);
      assert.equal(booking.paymentPath, state === 'paid' ? null : payment.activePaymentPath);
    }
    assert.equal(experience.home.payments.length, state === 'paid' ? 0 : 1);
    if (state !== 'paid') {
      assert.equal(experience.home.payments[0].href, payment.activePaymentPath);
      assert.equal(experience.home.payments[0].actionLabel, 'Open payment');
    }
    assert.deepEqual(experience.home.primaryAction, { kind: 'navigate', label: 'View booking', href: '#bookings' });
    assert.deepEqual(payment, before);
  });
}

test('waived deposit-purpose and unknown-purpose paths stay suppressed without masking outstanding money', () => {
  for (const purpose of ['deposit', '', undefined]) {
    const position = paymentPosition({ depositState: 'waived', state: 'partially_paid', outstanding: '400.00', activePaymentPurpose: purpose, activePaymentPath: '/pay/SYNTHETIC_STALE_DEPOSIT' });
    assert.equal(position.state, 'partially_paid');
    assert.match(position.label, /Deposit waived.*R400 outstanding/);
    assert.equal(position.actionPath, null);
  }
  const unpaid = paymentPosition({ depositState: 'waived', state: 'unpaid', outstanding: '500.00' });
  assert.equal(unpaid.state, 'not_recorded');
  assert.match(unpaid.label, /Deposit waived.*No payment recorded.*R500 outstanding/);
});

test('waived client context selects the existing treatment request rather than a stale deposit, preserving payer privacy and read-only facts', async t => {
  const requests = new PGlite();
  t.after(() => requests.close());
  await requests.exec(`CREATE TABLE payment_requests(id BIGINT,payment_account_id BIGINT,request_key TEXT,purpose TEXT,provider_payment_url TEXT,state TEXT,payer_crm_v2_client_id BIGINT);
    INSERT INTO payment_requests VALUES
      (100,80,'SYNTHETIC_STALE_DEPOSIT','deposit','https://synthetic.invalid/deposit','pending',101),
      (101,80,'SYNTHETIC_TREATMENT','general','https://synthetic.invalid/treatment','pending',101),
      (102,80,'SYNTHETIC_OTHER_PAYER','balance','https://synthetic.invalid/other','pending',102),
      (103,80,'SYNTHETIC_CLOSED','general','https://synthetic.invalid/closed','cancelled',101);`);
  const before = (await requests.query('SELECT * FROM payment_requests ORDER BY id')).rows;
  const appointment = { id: 201, crm_v2_client_id: 101, starts_at: '2099-10-15T08:00Z', ends_at: '2099-10-15T09:00Z', status: 'confirmed', total_price: '500.00', services: [], practitioners: [] };
  const db = { async query(sql, values) {
    if (sql.includes('myShilohClientContext:client')) return { rows: [{ id: 101, name: 'Synthetic client' }] };
    if (sql.includes('myShilohClientContext:next-appointment')) return { rows: [appointment] };
    if (sql.includes('myShilohClientContext:payment-position')) return { rows: [{ id: 80, canonical_amount_due: '500.00', currency: 'ZAR', paid: '100.00', refunded: '0.00', deposit_state: 'waived', deposit_required_amount: '250.00' }] };
    if (sql.includes('myShilohClientContext:active-payment-request')) return requests.query(sql, values);
    if (/myShilohClientContext:(upcoming-appointments|active-booking-request|declined-booking-requests|pending-reschedule-requests|forms-status-only)/.test(sql)) return { rows: [] };
    throw new Error('Unexpected synthetic context query');
  } };
  const context = await createMyShilohClientContextService({ db }).getContext({ crmV2ClientId: 101 });
  assert.equal(context.payment.state, 'partially_paid');
  assert.equal(context.payment.outstanding, '400.00');
  assert.equal(context.payment.depositRequired, '250.00');
  assert.equal(context.payment.depositOutstanding, '0.00');
  assert.equal(context.payment.activePaymentPurpose, 'general');
  assert.equal(context.payment.activePaymentPath, '/pay/SYNTHETIC_TREATMENT');
  assert.equal(paymentPosition(context.payment).actionPath, '/my-shiloh/payment?appointment=201');
  assert.deepEqual((await requests.query('SELECT * FROM payment_requests ORDER BY id')).rows, before);
});
