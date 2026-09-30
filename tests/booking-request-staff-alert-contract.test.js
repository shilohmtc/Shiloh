const test = require('node:test');
const assert = require('node:assert/strict');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
const { configuredMetaTemplateName, buildMetaTemplateRegistrationPayload } = require('../src/services/metaTemplateAdapter');
const alerts = require('../src/services/bookingRequestStaffAlerts');

function dbWith(status = 'pending') {
  return { async query(sql) {
    if (sql.includes('FROM appointment_booking_approvals aba')) return { rows: [{ appointment_id: 501, status, team_id: 11 }] };
    if (sql.includes('FROM staff_admin_accounts a')) {
      // A valid coordinator needs no historical WhatsApp phone to receive app alerts.
      assert.doesNotMatch(sql, /normalized_whatsapp/);
      assert.match(sql, /receive_alerts=TRUE/);
      assert.match(sql, /brcs.team_id=\$1/);
      assert.match(sql, /a.business_role='owner'/);
      return { rows: [{ admin_id: 100 }, { admin_id: 101 }] };
    }
    throw new Error('Unexpected database mutation');
  } };
}

test('booking requests use scoped Workspace alerts and report queue/push acceptance separately', async () => {
  const calls = [];
  const result = await alerts.dispatchBookingRequestAlerts({ db: dbWith(), appointmentId: 501,
    queueAlert: async (...args) => { calls.push(args); return { queued: 2, accepted: 1, failed: 1 }; } });
  assert.deepEqual(calls, [['booking_request:501', { adminIds: [100, 101] }]]);
  assert.equal(result.queued, 2);
  assert.equal(result.accepted, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.recipients, 2);
  assert.equal(Object.hasOwn(result, 'sent'), false);
});

test('resolved and missing requests cannot produce a staff wake', async () => {
  for (const status of ['confirmed', 'declined', 'cancelled']) {
    const result = await alerts.dispatchBookingRequestAlerts({ db: dbWith(status), appointmentId: 501,
      queueAlert: async () => { throw new Error('No alert allowed'); } });
    assert.equal(result.skipped, true);
  }
  const result = await alerts.dispatchBookingRequestAlerts({ db: {query: async () => ({rows: []})}, appointmentId: 999,
    queueAlert: async () => { throw new Error('No alert allowed'); } });
  assert.equal(result.skipped, true);
});

test('historical staff Meta alert cannot be reactivated by a stale environment selector', () => {
  const contract = getShilohMessageContract('workspace_booking_request_alert');
  assert.equal(contract.lifecycle, 'retired');
  assert.equal(contract.sendable, false);
  assert.equal(configuredMetaTemplateName(contract.id, { WHATSAPP_WORKSPACE_BOOKING_REQUEST_ALERT_TEMPLATE: 'wrong_template' }), 'shiloh_workspace_booking_request_alert_v1');
  assert.throws(() => buildMetaTemplateRegistrationPayload(contract.id), /retired/i);
});
