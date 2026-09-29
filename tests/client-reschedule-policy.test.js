const test = require('node:test');
const assert = require('node:assert/strict');
const { clientRescheduleRequestsEnabled } = require('../src/config/clientReschedulePolicy');

test('client reschedule policy preserves the old decision until the new key is configured', () => {
  assert.equal(clientRescheduleRequestsEnabled({}), false);
  assert.equal(clientRescheduleRequestsEnabled({ WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true' }), true);
  assert.equal(clientRescheduleRequestsEnabled({ WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'false' }), false);
});

test('Shiloh request policy overrides the legacy WhatsApp delivery flag in either direction', () => {
  assert.equal(clientRescheduleRequestsEnabled({
    SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED: 'true',
    WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'false',
  }), true);
  assert.equal(clientRescheduleRequestsEnabled({
    SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED: 'false',
    WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true',
  }), false);
  assert.equal(clientRescheduleRequestsEnabled({
    SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED: '',
    WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true',
  }), false);
});
