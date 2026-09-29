const test = require('node:test');
const assert = require('node:assert/strict');
const { clientRescheduleRequestsEnabled } = require('../src/config/clientReschedulePolicy');

test('client reschedule requests require the Shiloh policy key', () => {
  assert.equal(clientRescheduleRequestsEnabled({}), false);
  assert.equal(clientRescheduleRequestsEnabled({ SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED: 'true' }), true);
  assert.equal(clientRescheduleRequestsEnabled({ SHILOH_CLIENT_RESCHEDULE_REQUESTS_ENABLED: 'false' }), false);
});

test('legacy WhatsApp flag cannot enable clinic requests or retired Meta delivery', () => {
  const { assertDeliveryFeatureGate } = require('../src/services/metaTemplateContracts');
  assert.equal(clientRescheduleRequestsEnabled({ WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true' }), false);
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
  assert.throws(() => assertDeliveryFeatureGate('reschedule_approval_request', {
    WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true',
  }), /delivery gate is disabled/);
  assert.throws(() => assertDeliveryFeatureGate('reschedule_declined', {
    WHATSAPP_RESCHEDULE_APPROVAL_ENABLED: 'true',
  }), /delivery gate is disabled/);
});
