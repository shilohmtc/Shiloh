const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookingPaymentService } = require('../src/services/bookingPayments');

function fixture({ accepted = 1, active = true, flag = true, metaFails = false, recordFails = false } = {}) {
  const row = {
    id: 80, state: 'link_issued', provider_payment_url: 'https://pay.example/link',
    payer_crm_v2_client_id: 12, payer_mobile: '27820000000', payer_name: 'Client',
    amount: '125.00', request_key: 'deposit_key_80', deposit_notification_sent_at: null,
    deposit_notice_state: 'pending', deposit_notice_channel: null,
  };
  const calls = { push: 0, meta: 0, claims: 0 };
  const db = { async query(sql) {
    if (sql.includes('SELECT * FROM payment_requests')) return { rows: [row], rowCount: 1 };
    if (sql.includes('SELECT 1 FROM appointments a JOIN crm_v2_clients')) return { rows: active ? [{ '?column?': 1 }] : [], rowCount: active ? 1 : 0 };
    if (sql.includes("deposit_notice_state='sending'" ) && sql.includes("state='link_issued'")) {
      calls.claims++;
      if (row.deposit_notice_state !== 'pending') return { rows: [], rowCount: 0 };
      row.deposit_notice_state = 'sending'; return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("deposit_notice_state='sent'")) {
      if (recordFails) throw new Error('database unavailable after acceptance');
      row.deposit_notice_state = 'sent';
      row.deposit_notice_channel = sql.includes("'my_shiloh'") ? 'my_shiloh' : 'whatsapp';
      row.deposit_notification_sent_at = new Date(); return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("deposit_notice_state='pending'")) {
      row.deposit_notice_state = 'pending'; return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('deposit_notification_sent_at=NOW()')) {
      row.deposit_notification_sent_at = new Date(); return { rows: [row], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 90)}`);
  } };
  const member = { appointmentId: 22, crmV2ClientId: 12, clientMobile: '27820000000',
    clientName: 'Client', serviceName: 'Toe Gel Only', startsAt: new Date('2026-10-03T06:00:00Z') };
  const position = { applicable: true, requirement: { id: 33, state: 'awaiting', required_amount: 125 },
    members: [{ appointment_id: 22, required_amount: 125 }], scope: { appointmentId: 22, members: [member] } };
  const service = createBookingPaymentService({
    db,
    ozow: { configured: () => true },
    rewards: { syncEligibleEarnings: async () => {} },
    deposits: { ensureRequirement: async () => position },
    notifyClient: async () => { calls.push++; return { queued: true, accepted, notificationId: 99 }; },
    sendTemplate: async () => {
      calls.meta++;
      if (metaFails) throw new Error('provider outcome uncertain');
      return { messages: [{ id: 'wa-1' }] };
    },
    env: { SHILOH_DEPOSIT_NOTICE_APP_ONLY_ENABLED: flag ? 'true' : 'false',
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE: 'shiloh_payment_deposit_request_v1' },
  });
  return { service, row, calls };
}

test('accepted app wake records a deposit notice once without Meta', async () => {
  const { service, row, calls } = fixture();
  await service.ensureDepositRequest({ appointmentId: 22 });
  await service.ensureDepositRequest({ appointmentId: 22 });
  assert.equal(row.deposit_notice_channel, 'my_shiloh');
  assert.ok(row.deposit_notification_sent_at);
  assert.equal(calls.push, 1);
  assert.equal(calls.meta, 0);
});

test('unaccepted app wake uses the WhatsApp template under its claim', async () => {
  const { service, row, calls } = fixture({ accepted: 0 });
  await service.ensureDepositRequest({ appointmentId: 22 });
  assert.equal(row.deposit_notice_channel, 'whatsapp');
  assert.equal(calls.push, 1);
  assert.equal(calls.meta, 1);
});

test('inactive identity and disabled flag preserve existing WhatsApp path', async () => {
  for (const options of [{ active: false }, { flag: false }]) {
    const { service, row, calls } = fixture(options);
    await service.ensureDepositRequest({ appointmentId: 22 });
    assert.equal(calls.claims, 0);
    assert.equal(calls.meta, 1);
    assert.equal(row.deposit_notice_channel, null);
  }
});

test('accepted push with failed evidence write leaves the notice claimed', async () => {
  const { service, row, calls } = fixture({ recordFails: true });
  await assert.rejects(service.ensureDepositRequest({ appointmentId: 22 }), /database unavailable/);
  await service.ensureDepositRequest({ appointmentId: 22 });
  assert.equal(row.deposit_notice_state, 'sending');
  assert.equal(calls.push, 1);
  assert.equal(calls.meta, 0);
});

test('uncertain Meta fallback is not resent automatically', async () => {
  const { service, row, calls } = fixture({ accepted: 0, metaFails: true });
  await service.ensureDepositRequest({ appointmentId: 22 });
  await service.ensureDepositRequest({ appointmentId: 22 });
  assert.equal(row.deposit_notice_state, 'sending');
  assert.equal(calls.meta, 1);
});
