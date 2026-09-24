'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  cancelOutstandingPaymentRequestsForAppointment,
} = require('../src/services/bookingPaymentSafety');
const { createBookingPaymentService } = require('../src/services/bookingPayments');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cancelling a booking invalidates open Shiloh payment requests in the same transaction', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      if (text.startsWith('UPDATE payment_requests pr')) {
        return {
          rowCount: 2,
          rows: [
            { id: 7, request_key: 'dep_old', purpose: 'deposit', amount: '125.00', payer_crm_v2_client_id: 49 },
            { id: 8, request_key: 'balance_old', purpose: 'balance', amount: '125.00', payer_crm_v2_client_id: 49 },
          ],
        };
      }
      if (text.startsWith('INSERT INTO crm_audit_events')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const result = await cancelOutstandingPaymentRequestsForAppointment(db, {
    appointmentId: 759,
    actorAdminId: 3,
    reason: 'appointment_cancelled',
  });
  assert.equal(result.cancelled, 2);
  const update = calls[0];
  assert.match(update.text, /state='cancelled'/);
  assert.match(update.text, /pr\.state IN \('created','link_issued','pending'\)/);
  assert.match(update.text, /bpa\.appointment_id=\$1/);
  assert.match(update.text, /pr\.deposit_member_appointment_id=\$1/);
  assert.deepEqual(update.params, [759]);
  const audit = calls[1];
  assert.equal(audit.params[0], 3);
  assert.equal(audit.params[1], 759);
  assert.match(audit.params[2], /providerLinksNoLongerUsableThroughShiloh/);
  assert.match(audit.params[2], /automaticRefundIssued/);
});

test('all canonical appointment cancellation paths invoke payment-link invalidation', () => {
  const admin = read('src/services/adminAppointmentCancellation.js');
  const client = read('src/services/clientAppointmentCancellation.js');
  assert.match(admin, /cancelOutstandingPaymentRequestsForAppointment/);
  assert.match(client, /cancelOutstandingPaymentRequestsForAppointment/);
  assert.match(admin, /paymentRequestsCancelled/);
  assert.match(client, /paymentRequestsCancelled/);
});

test('Calendar cancellation queues the existing cancellation notification after the save', () => {
  const route = read('src/routes/calendarOperationalMutations.js');
  const cancelRoute = route.match(/router\.post\('\/appointments\/:appointmentId\/cancel'[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.ok(cancelRoute.indexOf('mutationService.cancel') >= 0);
  assert.ok(cancelRoute.indexOf('queueCustomerChangeNotification') > cancelRoute.indexOf('mutationService.cancel'));
  assert.match(cancelRoute, /'cancellation'/);
  const change = read('src/services/customerChangeNotification.js');
  assert.match(change, /cancellation: Object\.freeze\(\['calendar\.appointment_cancelled'\]\)/);
  const independent = read('src/services/sh05ChannelIndependence.js');
  assert.match(independent, /earlier unpaid deposit or payment link/);
  assert.match(independent, /no longer valid/);
});

test('My Shiloh notification insert casts shared timestamp parameters explicitly', () => {
  const push = read('src/services/myShilohPush.js');
  assert.match(push, /\$7::timestamptz,\$7::timestamptz \+ \(\$8::integer \* INTERVAL '1 day'\)/);
});

test('verified Ozow payment after cancellation is recorded as payment truth but does not reconfirm the booking', async () => {
  const queries = [];
  let depositSyncCalls = 0;
  let normalWhatsAppCalls = 0;
  let push = null;
  const request = {
    id: 8,
    request_key: 'dep_760_late',
    state: 'cancelled',
    amount: '125.00',
    currency: 'ZAR',
    payment_account_id: 10,
    payer_name: 'Jean-Pierre Botha',
    payer_mobile: '27716742646',
    payer_crm_v2_client_id: 49,
    gift_voucher_order_id: null,
    appointment_id: 760,
    appointment_status: 'cancelled',
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.includes('FROM payment_provider_events')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM payment_requests pr') && text.includes('FOR UPDATE OF pr')) return { rows: [request], rowCount: 1 };
      if (text.startsWith('INSERT INTO payment_ledger_entries')) return { rows: [], rowCount: 1 };
      if (text.startsWith("UPDATE payment_requests SET state='paid'")) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT bpa.canonical_amount_due')) return { rows: [{ canonical_amount_due: '250.00', net_paid: '125.00' }], rowCount: 1 };
      if (text.includes("'payment.received_after_booking_cancelled'")) return { rows: [], rowCount: 1 };
      if (text.startsWith('INSERT INTO payment_provider_events')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    },
    release() {},
  };
  const db = {
    async connect() { return client; },
    async query() { throw new Error('No direct db query expected in late-cancelled payment proof'); },
  };
  const service = createBookingPaymentService({
    db,
    ozow: {
      verifyNotification: () => true,
      configured: () => true,
    },
    rewards: { async syncEligibleEarnings() {} },
    deposits: {
      async getPosition() { depositSyncCalls += 1; return null; },
    },
    sendTemplate: async () => { normalWhatsAppCalls += 1; },
    notifyClient: async input => { push = input; return { queued: true }; },
  });
  const result = await service.handleOzowNotification({
    TransactionId: 'ozow_late_760',
    TransactionReference: 'dep_760_late',
    Status: 'Complete',
    Amount: '125.00',
    CurrencyCode: 'ZAR',
  });
  assert.equal(result.status, 'paid_review_required');
  assert.equal(depositSyncCalls, 0);
  assert.equal(normalWhatsAppCalls, 0);
  assert.equal(push.title, 'Payment needs review');
  assert.match(push.body, /booking stays cancelled/i);
  assert.match(push.body, /No automatic refund has been issued/i);
  assert.ok(queries.some(call => call.text.includes("'payment.received_after_booking_cancelled'")));
  assert.ok(queries.some(call => call.text.startsWith('INSERT INTO payment_ledger_entries')));
});


test('cancelled booking payment UI disables collection, hides stale copy links and exposes review-only refund control', () => {
  const ux = read('src/presentation/calendarPaymentsUx.js');
  assert.match(ux, /bookingCancelled = subject\.final === true/);
  assert.match(ux, /data-payment-review/);
  assert.match(ux, /No refund has been issued automatically/);
  assert.match(ux, /Payment collection is disabled because this booking is cancelled/);
  assert.match(ux, /No further deposit should be collected/);
  assert.match(ux, /bookingCancelled \? 'Cancelled booking'/);
  assert.match(ux, /!bookingCancelled && item\.provider_payment_url/);
  assert.match(ux, /data-refund-form/);
  assert.match(ux, /paymentReview \|\| bookingCancelled/);
});
