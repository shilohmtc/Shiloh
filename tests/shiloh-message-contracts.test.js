const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getShilohMessageContracts,
  getShilohMessageContract,
  canonicalizeMessageContractSpec,
  getMessageContractSpecHash,
} = require('../src/services/shilohMessageContracts');
const {
  META_TEMPLATE_BINDINGS,
  buildMetaTemplateContractView,
  buildMetaTemplateRegistrationPayload,
  resolveMetaTemplateBinding,
} = require('../src/services/metaTemplateAdapter');

test('Shiloh owns one canonical registry with 29 identities and 24 sendable contracts', () => {
  const contracts = getShilohMessageContracts();
  assert.equal(contracts.length, 29);
  assert.equal(new Set(contracts.map((contract) => contract.id)).size, 29);
  assert.equal(contracts.filter((contract) => contract.sendable).length, 24);
  assert.ok(contracts.some((contract) => contract.id === 'workspace_booking_request_alert' && contract.lifecycle === 'current' && contract.sendable));
  assert.deepEqual(
    contracts.filter((contract) => contract.lifecycle === 'retired').map((contract) => contract.id).sort(),
    ['appointment_followup_legacy', 'appointment_reminder_legacy', 'birthday_v1', 'booking_approval_outcome', 'booking_approval_request'],
  );
  assert.equal(META_TEMPLATE_BINDINGS.length, contracts.length);
  assert.equal(new Set(META_TEMPLATE_BINDINGS.map((binding) => binding.contractId)).size, contracts.length);
});

test('canonical Shiloh contract contains no provider identity or account authority', () => {
  const contract = getShilohMessageContract('booking_approval_request');
  assert.equal(contract.id, 'booking_approval_request');
  assert.equal(Object.hasOwn(contract, 'name'), false);
  assert.equal(Object.hasOwn(contract.message, 'name'), false);
  const serialized = JSON.stringify(contract);
  assert.equal(serialized.includes('waba'), false);
  assert.equal(serialized.includes('providerTemplateId'), false);
  assert.equal(serialized.includes('WHATSAPP_'), false);
});

test('contract spec hash is deterministic and ignores registration examples and object key order', () => {
  const contract = getShilohMessageContract('booking_approval_request');
  const first = getMessageContractSpecHash(contract);
  const cloned = JSON.parse(JSON.stringify(contract));
  cloned.message.components[0].example = { body_text: [['different', 'provider', 'submission', 'example']] };
  const reordered = {
    id: cloned.id,
    message: {
      components: cloned.message.components,
      category: cloned.message.category,
      language: cloned.message.language,
    },
  };
  assert.equal(getMessageContractSpecHash(reordered), first);
  assert.deepEqual(canonicalizeMessageContractSpec(reordered), canonicalizeMessageContractSpec(contract));
});

test('Meta registration payload is deterministic and retired contracts cannot be registered', () => {
  const first = buildMetaTemplateRegistrationPayload('booking_confirmation_v2');
  const second = buildMetaTemplateRegistrationPayload('booking_confirmation_v2');
  assert.deepEqual(first, second);
  assert.equal(first.name, 'shiloh_booking_confirmation_v2');
  assert.equal(first.language, 'en');
  assert.ok(Array.isArray(first.components));
  assert.throws(
    () => buildMetaTemplateRegistrationPayload('appointment_followup_legacy'),
    /Retired Shiloh message contract cannot be registered/,
  );
  assert.throws(
    () => buildMetaTemplateRegistrationPayload('booking_approval_request'),
    /Retired Shiloh message contract cannot be registered/,
  );
  assert.equal(buildMetaTemplateContractView('appointment_followup_legacy').name, 'appointment_followup');
});

test('exact approved current Meta readback creates a binding with matching Shiloh spec hash', () => {
  const provider = {
    id: 'provider-template-id',
    status: 'APPROVED',
    ...buildMetaTemplateRegistrationPayload('booking_declined'),
  };
  const binding = resolveMetaTemplateBinding({
    contractId: 'booking_declined',
    providerTemplates: [provider],
  });
  assert.equal(binding.bound, true);
  assert.equal(binding.state, 'approved_exact');
  assert.equal(binding.expectedSpecHash, binding.actualSpecHash);
  assert.equal(binding.providerTemplateId, 'provider-template-id');
});

test('Meta binding fails closed for missing, pending, rejected, drifted and duplicate variants', () => {
  const contractId = 'booking_declined';
  const exact = buildMetaTemplateRegistrationPayload(contractId);
  assert.equal(resolveMetaTemplateBinding({ contractId, providerTemplates: [] }).state, 'missing');
  assert.equal(resolveMetaTemplateBinding({ contractId, providerTemplates: [{ id: 'p', status: 'PENDING', ...exact }] }).state, 'pending');
  assert.equal(resolveMetaTemplateBinding({ contractId, providerTemplates: [{ id: 'r', status: 'REJECTED', ...exact }] }).state, 'rejected');

  const drifted = JSON.parse(JSON.stringify(exact));
  drifted.components[0].text = `${drifted.components[0].text} changed`;
  const drift = resolveMetaTemplateBinding({ contractId, providerTemplates: [{ id: 'd', status: 'APPROVED', ...drifted }] });
  assert.equal(drift.bound, false);
  assert.equal(drift.state, 'drifted');
  assert.equal(drift.reason, 'provider_spec_mismatch');

  const duplicate = resolveMetaTemplateBinding({
    contractId,
    providerTemplates: [
      { id: 'a', status: 'APPROVED', ...exact },
      { id: 'b', status: 'APPROVED', ...exact },
    ],
  });
  assert.equal(duplicate.bound, false);
  assert.equal(duplicate.state, 'duplicate');
});

test('Meta-managed staff authentication readback normalizes to the Shiloh OTP semantic contract', () => {
  const contractId = 'staff_auth_otp';
  const provider = {
    id: 'staff-auth-provider',
    status: 'APPROVED',
    ...buildMetaTemplateRegistrationPayload(contractId),
  };
  provider.components = JSON.parse(JSON.stringify(provider.components));
  provider.components[2].buttons[0] = {
    type: 'URL',
    otp_type: 'COPY_CODE',
    text: 'Copy Code',
    url: 'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}',
  };
  const binding = resolveMetaTemplateBinding({ contractId, providerTemplates: [provider] });
  assert.equal(binding.bound, true);
  assert.equal(binding.expectedSpecHash, binding.actualSpecHash);
});

test('retired Shiloh contracts can never produce an approved runtime binding', () => {
  const contractId = 'birthday_v1';
  const provider = { id: 'legacy', status: 'APPROVED', ...buildMetaTemplateContractView(contractId) };
  const binding = resolveMetaTemplateBinding({ contractId, providerTemplates: [provider] });
  assert.equal(binding.bound, false);
  assert.equal(binding.state, 'retired');
  assert.equal(binding.reason, 'contract_retired');
});
