const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_NAME,
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  TEMPLATE_BODY,
  TEMPLATE_BUTTONS,
  buildWorkspaceBookingRequestAlertTemplateDefinition,
  providerContractMatches,
} = require('../src/services/workspaceBookingRequestAlertTemplateProvisioning');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
const { getMetaTemplateBindingSpec, configuredMetaTemplateName } = require('../src/services/metaTemplateAdapter');

test('Workspace booking request alert freezes the approved provider submission contract', () => {
  assert.equal(TEMPLATE_NAME, 'shiloh_workspace_booking_request_alert_v1');
  assert.equal(TEMPLATE_LANGUAGE, 'en');
  assert.equal(TEMPLATE_CATEGORY, 'UTILITY');
  assert.equal(TEMPLATE_BODY, 'Hi {{1}}, a new booking request is waiting in Shiloh Workspace. 🌿\n\n{{2}} request(s) currently need attention.\n\nOpen Workspace to review and respond.');
  assert.deepEqual([...TEMPLATE_BUTTONS], ['Open Workspace']);
  const definition = buildWorkspaceBookingRequestAlertTemplateDefinition();
  assert.equal(definition.components[0].type, 'BODY');
  assert.deepEqual(definition.components[0].example.body_text, [['Christel', '3']]);
  assert.deepEqual(definition.components[1].buttons, [{ type: 'QUICK_REPLY', text: 'Open Workspace' }]);
  assert.equal(providerContractMatches(definition), true);
});

test('Workspace booking request alert is retained as historical evidence without provider sending authority', () => {
  const contract = getShilohMessageContract('workspace_booking_request_alert');
  assert.equal(contract?.lifecycle, 'retired');
  assert.equal(contract?.sendable, false);
  const binding = getMetaTemplateBindingSpec('workspace_booking_request_alert');
  assert.equal(binding?.templateName, TEMPLATE_NAME);
  assert.equal(binding?.env, null);
  assert.equal(configuredMetaTemplateName('workspace_booking_request_alert', {}), TEMPLATE_NAME);
});

test('provider comparison rejects drift in category, body, or button contract', () => {
  const exact = buildWorkspaceBookingRequestAlertTemplateDefinition();
  assert.equal(providerContractMatches({ ...exact, category: 'MARKETING' }), false);
  assert.equal(providerContractMatches({ ...exact, components: [{ type: 'BODY', text: 'different' }, exact.components[1]] }), false);
  assert.equal(providerContractMatches({ ...exact, components: [exact.components[0], { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Approve' }] }] }), false);
});
