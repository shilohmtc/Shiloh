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
} = require('../src/services/metaTemplateAdapter');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
const { assertTemplateSendAllowed } = require('../src/services/metaTemplateContracts');

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

test('historical payment contracts cannot be registered or sent', async () => {
  for (const [contractId, templateName] of EXPECTED) {
    const contract = getShilohMessageContract(contractId);
    const binding = META_TEMPLATE_BINDINGS.find((item) => item.contractId === contractId);
    assert.equal(contract.lifecycle, 'retired');
    assert.equal(contract.sendable, false);
    assert.equal(binding.templateName, templateName);
    assert.equal(binding.env, null);
    assert.equal(DEFINITIONS[contractId].env, null);
    assert.throws(() => buildMetaTemplateRegistrationPayload(contractId), /Retired Shiloh message contract cannot be registered/);
    await assert.rejects(() => assertTemplateSendAllowed(templateName), /not an approved Shiloh send contract/);
  }
});

test('payment pack contains no promotional or review-request language', () => {
  const serialized = JSON.stringify(EXPECTED.map(([key]) => buildPaymentTemplateDefinition(key)));
  assert.doesNotMatch(serialized, /special|discount|promotion|review us|rate us|limited time/i);
});

test('release startup and tooling do not provision retired Meta deposit templates', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.doesNotMatch(pkg.scripts.start, /provision-payment-deposit-template-v2\.js/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'services', 'paymentDepositTemplateProvisioning.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'scripts', 'provision-payment-deposit-template-v2.js')), false);
});
