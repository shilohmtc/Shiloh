'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookingPaymentService } = require('../src/services/bookingPayments');

function fixture({ accepted = 1, active = true, flag = true, metaFails = false, recordFails = false } = {}) {
  const request = {
    id: 92, request_key: 'payment_92_key', state: 'link_issued', amount: '125.00',
    currency: 'ZAR', payment_account_id: 19, payer_name: 'Customer',
    payer_mobile: '27820000000', payer_crm_v2_client_id: 77,
    gift_voucher_order_id: null, appointment_id: null, appointment_status: 'confirmed',
    receipt_notice_state: 'pending', receipt_notice_channel: null,
  };
  const calls = { push: 0, meta: 0, claims: 0 };
  const client = {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
      if (text.includes('FROM payment_provider_events')) return { rows: [] };
      if (text.includes('FROM payment_requests pr') && text.includes('FOR UPDATE OF pr')) return { rows: [request] };
      if (text.startsWith('INSERT INTO payment_ledger_entries')) return { rows: [] };
      if (text.startsWith("UPDATE payment_requests SET state='paid'")) { request.state = 'paid'; return { rows: [] }; }
      if (text.includes('SELECT bpa.canonical_amount_due')) return { rows: [{ canonical_amount_due: '250.00', net_paid: '125.00' }] };
      if (text.startsWith('INSERT INTO payment_provider_events')) return { rows: [] };
      throw new Error(`Unexpected transactional SQL: ${text}`);
    },
    release() {},
  };
  const db = {
    async connect() { return client; },
    async query(sql) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.includes('FROM crm_v2_clients') && text.includes('normalized_mobile')) {
        return { rowCount: active ? 1 : 0, rows: active ? [{ '?column?': 1 }] : [] };
      }
      if (text.startsWith("UPDATE payment_requests SET receipt_notice_state='sending'")) {
        calls.claims++;
        if (request.receipt_notice_state !== 'pending') return { rowCount: 0, rows: [] };
        request.receipt_notice_state = 'sending'; return { rowCount: 1, rows: [{ id: request.id }] };
      }
      if (text.includes("receipt_notice_state='sent'")) {
        if (recordFails) throw new Error('receipt evidence unavailable');
        request.receipt_notice_state = 'sent';
        request.receipt_notice_channel = text.includes("'my_shiloh'") ? 'my_shiloh' : 'whatsapp';
        return { rowCount: 1, rows: [{ id: request.id }] };
      }
      if (text.includes("receipt_notice_state='pending'")) {
        request.receipt_notice_state = 'pending'; return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected receipt SQL: ${text}`);
    },
  };
  const service = createBookingPaymentService({
    db,
    ozow: { verifyNotification: () => true },
    rewards: { async syncEligibleEarnings() {} },
    notifyClient: async () => { calls.push++; return { queued: true, accepted }; },
    sendTemplate: async () => {
      calls.meta++;
      if (metaFails) throw new Error('Meta provider outcome uncertain');
      return { messages: [{ id: 'wa-1' }] };
    },
    env: { SHILOH_PAYMENT_RECEIPT_APP_ONLY_ENABLED: flag ? 'true' : 'false',
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true', WHATSAPP_PAYMENT_RECEIVED_TEMPLATE: 'shiloh_payment_received_v1' },
  });
  const payload = { TransactionId: 'ozow_92', TransactionReference: 'payment_92_key',
    Status: 'Complete', Amount: '125.00', CurrencyCode: 'ZAR' };
  return { service, payload, calls, request };
}

test('accepted app wake records receipt once and skips general Meta receipt', async () => {
  const { service, payload, calls, request } = fixture();
  assert.equal((await service.handleOzowNotification(payload)).status, 'paid');
  assert.equal(request.receipt_notice_channel, 'my_shiloh');
  assert.equal(calls.push, 1);
  assert.equal(calls.meta, 0);
});

test('unaccepted app wake falls back to approved Meta receipt and records channel', async () => {
  const { service, payload, calls, request } = fixture({ accepted: 0 });
  await service.handleOzowNotification(payload);
  assert.equal(request.receipt_notice_channel, 'whatsapp');
  assert.equal(calls.push, 2);
  assert.equal(calls.meta, 1);
});

test('inactive payer and disabled switch preserve the original Meta then app behavior', async () => {
  for (const options of [{ active: false }, { flag: false }]) {
    const { service, payload, calls } = fixture(options);
    await service.handleOzowNotification(payload);
    assert.equal(calls.claims, 0);
    assert.equal(calls.meta, 1);
    assert.equal(calls.push, 1);
  }
});

test('failed receipt evidence write leaves the claim and does not send Meta', async () => {
  const { service, payload, calls, request } = fixture({ recordFails: true });
  await assert.rejects(service.handleOzowNotification(payload), /receipt evidence unavailable/);
  assert.equal(request.receipt_notice_state, 'sending');
  assert.equal(calls.push, 1);
  assert.equal(calls.meta, 0);
});

test('ambiguous Meta outcome keeps the receipt claimed for review', async () => {
  const { service, payload, calls, request } = fixture({ accepted: 0, metaFails: true });
  await service.handleOzowNotification(payload);
  assert.equal(request.receipt_notice_state, 'sending');
  assert.equal(calls.meta, 1);
});
