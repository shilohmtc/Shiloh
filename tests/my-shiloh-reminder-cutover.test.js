const test = require('node:test');
const assert = require('node:assert/strict');
const { claimDueReminder, deliverClaimedReminder } = require('../src/services/appointmentLifecycle');

const appointment = {
  id: 21, appointment_id: 780, crm_v2_client_id: 19,
  phone: '27820000000', client_name_snapshot: 'Client', service_text: 'Toe Gel Only',
  appointment_at: '2026-09-30T06:00:00.000Z',
};

test('app-only reminder claims only bookings with an enabled, unrevoked push subscription', async () => {
  let query;
  await claimDueReminder({ async query(sql, params) { query = { sql, params }; return { rows: [] }; } }, { appOnly: true });
  assert.deepEqual(query.params.slice(1), [true]);
  assert.match(query.sql, /s\.crm_v2_client_id=al\.crm_v2_client_id AND s\.enabled=TRUE AND s\.revoked_at IS NULL/);
});

test('accepted app push can deliver reminder without a Meta template when app-only gate is enabled', async () => {
  let whatsappSends = 0;
  const result = await deliverClaimedReminder(appointment, null, null, {
    env: { SHILOH_CLIENT_REMINDER_APP_ONLY_ENABLED: 'true' },
    notifyClient: async () => ({ queued: true, accepted: 1, notificationId: 92 }),
    send: async () => { whatsappSends += 1; },
  });
  assert.equal(result.channel, 'my_shiloh');
  assert.equal(result.notificationId, 92);
  assert.equal(whatsappSends, 0);
});

test('unaccepted app push falls back to Meta template, or leaves claim retryable if no template exists', async () => {
  let whatsappSends = 0;
  const deps = {
    env: { SHILOH_CLIENT_REMINDER_APP_ONLY_ENABLED: 'true' },
    notifyClient: async () => ({ queued: true, accepted: 0 }),
    send: async () => { whatsappSends += 1; return { messages: [{ id: 'wamid.ok' }] }; },
  };
  await deliverClaimedReminder(appointment, 'shiloh_appointment_reminder_actions_v1', null, deps);
  assert.equal(whatsappSends, 1);
  await assert.rejects(deliverClaimedReminder(appointment, null, null, deps), /No confirmed reminder delivery channel/);
  assert.equal(whatsappSends, 1);
});
