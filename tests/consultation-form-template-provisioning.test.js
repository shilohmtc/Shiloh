const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TEMPLATE_CATEGORY,
  FORM_URL,
  buildConsultationFormTemplateDefinitions,
  providerContractMatches,
} = require('../src/services/consultationFormTemplateProvisioning');

test('consultation form and reminder are Utility templates with one secure dynamic form button', () => {
  const definitions = buildConsultationFormTemplateDefinitions();
  assert.deepEqual(definitions.map((item) => item.name), [
    'shiloh_consultation_form_v1',
    'shiloh_consultation_form_reminder_v1',
  ]);
  assert.equal(TEMPLATE_CATEGORY, 'UTILITY');
  assert.equal(FORM_URL, 'https://app.shilohmtc.co.za/forms/f/{{1}}');

  for (const definition of definitions) {
    assert.equal(definition.category, 'UTILITY');
    assert.equal(definition.language, 'en');
    const body = definition.components.find((item) => item.type === 'BODY');
    assert.ok(body.text.includes('{{1}}'));
    assert.ok(body.text.includes('{{2}}'));
    assert.ok(body.text.includes('{{3}}'));
    assert.deepEqual(body.example.body_text.length, 1);

    const buttons = definition.components.find((item) => item.type === 'BUTTONS');
    assert.equal(buttons.buttons.length, 1);
    assert.deepEqual(buttons.buttons[0], {
      type: 'URL',
      text: 'Complete form',
      url: 'https://app.shilohmtc.co.za/forms/f/{{1}}',
      example: ['example-consultation-token'],
    });
  }
});

test('provider comparison ignores examples but requires the approved semantic contract', () => {
  const [definition] = buildConsultationFormTemplateDefinitions();
  const provider = JSON.parse(JSON.stringify(definition));
  provider.id = 'provider-template-1';
  provider.status = 'PENDING';
  provider.components.find((item) => item.type === 'BODY').example = { body_text: [['Different', 'Example', 'Values']] };
  assert.equal(providerContractMatches(provider, definition), true);

  provider.components.find((item) => item.type === 'BUTTONS').buttons[0].url = 'https://example.com/{{1}}';
  assert.equal(providerContractMatches(provider, definition), false);
});

test('production start performs idempotent Meta consultation template provisioning before app startup', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.start, /node scripts\/verify-migrations\.js && node scripts\/provision-consultation-form-templates\.js && node /);

  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'provision-consultation-form-templates.js'), 'utf8');
  assert.match(script, /submitConsultationFormTemplates/);
  assert.match(script, /consultation_form_meta_template_provisioning_complete/);
  assert.match(script, /consultation_form_meta_template_provisioning_failed/);
});
