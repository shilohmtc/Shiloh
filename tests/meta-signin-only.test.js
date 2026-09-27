const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { metaSignInOnly } = require('../src/services/metaSignInOnly');
const {
  sendWhatsAppMessage, sendWhatsAppSignInMessage, sendWhatsAppTemplate,
  sendWhatsAppReplyButtons, sendWhatsAppCtaUrl, sendWhatsAppList,
} = require('../src/services/whatsapp');
const { paymentNotificationsEnabled } = require('../src/services/paymentWhatsAppNotifications');
const { deliverClaimedReminder, deliverClaimedFollowup } = require('../src/services/appointmentLifecycle');

test('sign-in-only pauses all generic Meta sends before a provider request while preserving verified sign-in replies', async () => {
  const original = axios.post;
  const previous = process.env.SHILOH_META_SIGNIN_ONLY_ENABLED;
  const previousPhone = process.env.PHONE_NUMBER_ID;
  let sends = 0;
  process.env.SHILOH_META_SIGNIN_ONLY_ENABLED = 'true';
  process.env.PHONE_NUMBER_ID = 'test-phone';
  axios.post = async (_url, payload) => {
    sends += 1;
    assert.equal(payload.type, 'text');
    return { data: { messages: [{ id: 'wamid.signin' }] } };
  };
  try {
    for (const send of [
      () => sendWhatsAppMessage('27820000000', 'ordinary reply'),
      () => sendWhatsAppTemplate('27820000000', 'shiloh_booking_update_v1'),
      () => sendWhatsAppReplyButtons('27820000000', 'Options', [{ id: 'one', title: 'One' }]),
      () => sendWhatsAppCtaUrl('27820000000', 'Pay', 'Open', 'https://example.com'),
      () => sendWhatsAppList('27820000000', 'Choose', 'Open', [{ id: 'one', title: 'One' }]),
    ]) await assert.rejects(send(), { code: 'META_SIGNIN_ONLY' });
    assert.equal(sends, 0);
    const result = await sendWhatsAppSignInMessage('27820000000', 'Your sign-in is verified');
    assert.equal(result.messages[0].id, 'wamid.signin');
    assert.equal(sends, 1);
  } finally {
    axios.post = original;
    if (previous === undefined) delete process.env.SHILOH_META_SIGNIN_ONLY_ENABLED;
    else process.env.SHILOH_META_SIGNIN_ONLY_ENABLED = previous;
    if (previousPhone === undefined) delete process.env.PHONE_NUMBER_ID;
    else process.env.PHONE_NUMBER_ID = previousPhone;
  }
});

test('pause remains opt-in and does not claim reminder or follow-up delivery without an accepted app wake', async () => {
  assert.equal(metaSignInOnly({}), false);
  assert.equal(paymentNotificationsEnabled({ WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true', SHILOH_META_SIGNIN_ONLY_ENABLED: 'true' }), false);
  const appointment = { id: 1, appointment_id: 2, crm_v2_client_id: 3, phone: '27820000000',
    client_name_snapshot: 'Client', service_text: 'Toe Gel Only', appointment_at: '2026-09-30T06:00:00Z' };
  const env = { SHILOH_META_SIGNIN_ONLY_ENABLED: 'true' };
  let sends = 0;
  await assert.rejects(deliverClaimedReminder(appointment, 'shiloh_appointment_reminder_actions_v1', null,
    { env, notifyClient: async () => ({ queued: true, accepted: 0 }), send: async () => { sends += 1; } }),
  /No confirmed reminder delivery channel/);
  const followup = await deliverClaimedFollowup(appointment, 'shiloh_appointment_followup_v2', null,
    { env, send: async () => { sends += 1; } });
  assert.deepEqual(followup, { sent: false, reason: 'meta_signin_only' });
  assert.equal(sends, 0);
});
