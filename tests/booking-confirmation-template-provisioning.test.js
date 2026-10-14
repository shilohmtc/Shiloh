const test = require('node:test');
const assert = require('node:assert/strict');

const provisioning = require('../src/services/bookingConfirmationTemplateProvisioning');

test('booking confirmation template is a client-safe utility template with the existing seven parameters', () => {
  assert.equal(provisioning.TEMPLATE_NAME, 'shiloh_booking_confirmation_v1');
  assert.equal(provisioning.TEMPLATE_LANGUAGE, 'en');
  assert.equal(provisioning.TEMPLATE_CATEGORY, 'UTILITY');

  const definition = provisioning.buildBookingConfirmationTemplateDefinition();
  assert.equal(definition.name, 'shiloh_booking_confirmation_v1');
  assert.equal(definition.category, 'UTILITY');
  const body = definition.components.find((component) => component.type === 'BODY');
  assert.ok(body);
  for (let i = 1; i <= 7; i += 1) assert.match(body.text, new RegExp(`\\{\\{${i}\\}\\}`));
  assert.equal(body.example.body_text[0].length, 7);
  assert.doesNotMatch(body.text, /canonical CRM|synchroniz|provider|revalidation/i);
  assert.match(body.text, /RESCHEDULE/);
  assert.match(body.text, /CANCEL/);
});

test('historical booking confirmation status remains available for inspection', () => {
  assert.equal(typeof provisioning.getBookingConfirmationTemplateStatus, 'function');
});
