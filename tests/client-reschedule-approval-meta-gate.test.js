const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const approvalService = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApproval.js'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const { buildDefinition } = require('../src/services/clientLifecycleTemplateProvisioning');

test('legacy provider definitions remain frozen while new requests use Reception', () => {
  const requestDefinition = buildDefinition('reschedule_approval_request');
  const declinedDefinition = buildDefinition('reschedule_declined');
  assert.match(approvalService, /'pending','reception'/);
  assert.doesNotMatch(approvalService, /sendApprovalRequest\(/);
  assert.match(approvalService, /context\.decision_owner !== 'practitioner'/);
  assert.doesNotMatch(approvalService, /sendWhatsAppTemplate|WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE/);
  assert.match(approvalService, /status_available_in_app_phone_alert_retired/);
  assert.deepEqual(requestDefinition.components[1].buttons.map((button) => button.text), ['Approve', 'Decline']);
  assert.deepEqual(declinedDefinition.components[1].buttons.map((button) => button.text), ['Choose another time']);
});

test('retired reschedule provider bootstrap is absent from ordinary startup', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'bootstrap', 'clientRescheduleApprovalTemplateProvisioningBootstrap.js')), false);
  assert.doesNotMatch(pkg, /clientRescheduleApprovalTemplateProvisioningBootstrap\.js/);
});
