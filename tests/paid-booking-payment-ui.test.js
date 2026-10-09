'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCalendarPaymentPage } = require('../src/presentation/calendarPaymentsUx');
const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');

test('settled balance leads with history and retains requests without collection actions', () => {
  const model = paymentFixture(), before = JSON.stringify(model);
  const html = renderCalendarPaymentPage({ model });
  assert.match(html, /Paid in full/);
  assert.match(html, /No balance outstanding/);
  assert.match(html, /Earlier request · no collection needed/);
  assert.match(html, /Payment · card machine/);
  assert.equal((html.match(/class="payment-card deposit-policy"/g) || []).length, 0);
  assert.match(html, /Deposit paid/);
  assert.doesNotMatch(html, /Deposit required|Still needed/);
  assert.ok(html.indexOf('data-payment-history') < html.indexOf('<h2>Payment requests</h2>'));
  assert.doesNotMatch(html, /data-ozow-form|data-rewards-form|data-copy-link|data-request-guidance|Reception help|Link ready/);
  assert.match(html, /data-manual-form/);
  assert.match(html, /disabled>Record payment/);
  assert.equal(JSON.stringify(model), before);
});

test('satisfied deposit request is historical while remaining treatment payment stays collectable', () => {
  const model = paymentFixture({ paid: false });
  const html = renderCalendarPaymentPage({ model });
  assert.doesNotMatch(html, /data-copy-link/);
  assert.match(html, /data-ozow-form/);
  assert.match(html, /data-rewards-form/);
  assert.match(html, /data-booking-noncash="client-credit"/);
  assert.match(html, /SV-SYNTHETIC01/);
  assert.match(html, /SV-SYNTHETIC02/);
  const awaiting = renderCalendarPaymentPage({ model: paymentFixture({ paid: false, awaitingDeposit: true }) });
  assert.match(awaiting, /data-copy-link/);
  assert.match(awaiting, /New deposit payment link/);
});

test('paid cancellation preserves refund and payment evidence with no collection', () => {
  const html = renderCalendarPaymentPage({ model: paymentFixture({ final: true }) });
  assert.match(html, /data-refund-form/);
  assert.match(html, /data-payment-history/);
  assert.doesNotMatch(html, /data-manual-form|data-ozow-form|data-copy-link/);
});
