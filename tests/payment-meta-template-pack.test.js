const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFINITIONS,
  PAYMENT_URL,
  buildPaymentTemplateDefinition,
} = require('../src/services/paymentTemplateDefinitions');
const {
  META_TEMPLATE_BINDINGS,
  buildMetaTemplateRegistrationPayload,
  configuredMetaTemplateName,
} = require('../src/services/metaTemplateAdapter');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');

const EXPECTED = Object.freeze([
  ['payment_deposit_request', 'shiloh_payment_deposit_request_v1'],
  ['payment_deposit_request_v2', 'shiloh_payment_deposit_request_v2'],
  ['payment_deposit_received', 'shiloh_payment_deposit_received_v1'],
  ['payment_balance_due', 'shiloh_payment_balance_due_v1'],
  ['payment_split_request', 'shiloh_payment_split_request_v1'],
  ['payment_received', 'shiloh_payment_received_v1'],
  ['payment_not_verified', 'shiloh_payment_not_verified_v1'],
  ['payment_refund_update', 'shiloh_payment_refund_update_v1'],
  ['payment_voucher_request', 'shiloh_payment_voucher_request_v1'],
  ['payment_voucher_issued', 'shiloh_payment_voucher_issued_v1'],
]);

test('payment pack defines dedicated English utility templates including deposit policy v2', () => {
  assert.equal(Object.keys(DEFINITIONS).length, 10);
  for (const [contractId, templateName] of EXPECTED) {
    const definition = buildPaymentTemplateDefinition(contractId);
    assert.equal(definition.name, templateName);
    assert.equal(definition.language, 'en');
    assert.equal(definition.category, 'UTILITY');
    assert.equal(definition.components.some((item) => item.type === 'BODY'), true);
    assert.equal(definition.components.some((item) => item.type === 'FOOTER'), true);
  }
});

test('payment actions use only the stable Shiloh payment URL', () => {
  assert.equal(PAYMENT_URL, 'https://app.shilohmtc.co.za/pay/{{1}}');
  for (const [contractId] of EXPECTED) {
    const serialized = JSON.stringify(buildPaymentTemplateDefinition(contractId));
    assert.doesNotMatch(serialized, /ozow\.com|api\.ozow/i);
    const urlButtons = buildPaymentTemplateDefinition(contractId).components
      .flatMap((component) => component.buttons || [])
      .filter((button) => button.type === 'URL');
    for (const button of urlButtons) assert.equal(button.url, PAYMENT_URL);
  }
});

test('payment copy preserves verified financial and booking truth', () => {
  const deposit = JSON.stringify(buildPaymentTemplateDefinition('payment_deposit_request'));
  const depositV2 = JSON.stringify(buildPaymentTemplateDefinition('payment_deposit_request_v2'));
  const received = JSON.stringify(buildPaymentTemplateDefinition('payment_received'));
  const notVerified = JSON.stringify(buildPaymentTemplateDefinition('payment_not_verified'));
  const voucher = JSON.stringify(buildPaymentTemplateDefinition('payment_voucher_request'));
  assert.match(deposit, /awaiting payment/);
  assert.match(deposit, /only after the payment is verified/);
  assert.match(depositV2, /review and accept Shiloh’s Booking Policy & Terms/);
  assert.match(depositV2, /confirmed only after Shiloh verifies the required deposit/);
  assert.match(depositV2, /Review & pay deposit/);
  assert.match(received, /verified your payment/);
  assert.match(notVerified, /could not verify/);
  assert.match(notVerified, /No payment has been recorded by Shiloh/);
  assert.match(voucher, /issued only after Shiloh verifies the payment/);
});

test('payment contracts are registrable and deposit v2 has a safe default binding', () => {
  for (const [contractId, templateName] of EXPECTED) {
    const contract = getShilohMessageContract(contractId);
    const binding = META_TEMPLATE_BINDINGS.find((item) => item.contractId === contractId);
    assert.equal(contract.lifecycle, 'current');
    assert.equal(contract.sendable, true);
    assert.equal(binding.templateName, templateName);
    if (contractId === 'payment_deposit_request_v2') {
      assert.equal(binding.env, null);
      assert.equal(configuredMetaTemplateName(contractId, {}), templateName);
    } else {
      assert.match(binding.env, /^WHATSAPP_PAYMENT_/);
      assert.equal(configuredMetaTemplateName(contractId, {}), null);
    }
    assert.equal(buildMetaTemplateRegistrationPayload(contractId).name, templateName);
  }
});

test('payment pack contains no promotional or review-request language', () => {
  const serialized = JSON.stringify(EXPECTED.map(([key]) => buildPaymentTemplateDefinition(key)));
  assert.doesNotMatch(serialized, /special|discount|promotion|review us|rate us|limited time/i);
});

test('release startup provisions deposit request v2 without changing existing template configuration', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const provisioning = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'paymentDepositTemplateProvisioning.js'), 'utf8');
  assert.match(pkg.scripts.start, /provision-payment-deposit-template-v2\.js/);
  assert.match(provisioning, /shiloh_payment_deposit_request_v2/);
  assert.match(provisioning, /already_exists/);
  assert.match(provisioning, /message_templates/);
});
