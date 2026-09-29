const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEGACY_TEMPLATE_NAME,
  TEMPLATE_NAME,
  TEMPLATE_LANGUAGE,
  TEMPLATE_CATEGORY,
  buildBirthdayTemplateDefinition,
} = require('../src/services/birthdayTemplateProvisioning');

test('birthday template v2 is brand-correct, stable and non-promotional', () => {
  const definition = buildBirthdayTemplateDefinition();
  assert.equal(LEGACY_TEMPLATE_NAME, 'shiloh_birthday_wish_v1');
  assert.equal(TEMPLATE_NAME, 'shiloh_birthday_wish_v2');
  assert.equal(TEMPLATE_LANGUAGE, 'en');
  assert.equal(TEMPLATE_CATEGORY, 'MARKETING');
  assert.equal(definition.name, TEMPLATE_NAME);
  assert.equal(definition.language, TEMPLATE_LANGUAGE);
  assert.equal(definition.category, TEMPLATE_CATEGORY);
  assert.equal(definition.components.length, 2);

  const body = definition.components.find((component) => component.type === 'BODY');
  const footer = definition.components.find((component) => component.type === 'FOOTER');
  assert.ok(body);
  assert.ok(footer);
  assert.match(body.text, /Happy birthday, \{\{1\}\}!/);
  assert.match(body.text, /Shiloh Massage Therapy and Aesthetic Clinic/);
  assert.doesNotMatch(body.text, /Shiloh Medical & Training Centre/);
  assert.deepEqual(body.example, { body_text: [['Christel']] });
  assert.match(footer.text, /BIRTHDAY OFF/);
  assert.doesNotMatch(body.text, /discount|sale|offer|book now/i);
});

test('retired birthday template provider inspection is not mounted', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/auditRead.js'), 'utf8');
  assert.doesNotMatch(source, /\/birthday-template\/status|\/meta-templates\/status/);
  assert.doesNotMatch(source, /getBirthdayTemplateStatus|inspectMetaTemplateInventory/);
});

test('retired birthday Meta template cannot be submitted or selected for delivery', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/maintenance.js'), 'utf8');
  const provisioner = require('../src/services/birthdayTemplateProvisioning');
  const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
  const { getMetaTemplateBindingSpec, buildMetaTemplateRegistrationPayload } = require('../src/services/metaTemplateAdapter');
  const { assertTemplateSendAllowed } = require('../src/services/metaTemplateContracts');
  assert.doesNotMatch(source, /'birthday-template-status'|'birthday-template-submit'/);
  assert.equal(provisioner.submitBirthdayTemplate, undefined);
  assert.equal(getShilohMessageContract('birthday_v2').sendable, false);
  assert.equal(getMetaTemplateBindingSpec('birthday_v2').env, null);
  assert.throws(() => buildMetaTemplateRegistrationPayload('birthday_v2'), /Retired Shiloh message contract/);
  await assert.rejects(() => assertTemplateSendAllowed(TEMPLATE_NAME), /not an approved Shiloh send contract/);
});
