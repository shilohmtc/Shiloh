const {
  getShilohMessageContracts,
  getShilohMessageContract,
  canonicalizeMessageContractSpec,
  getMessageContractSpecHash,
} = require('./shilohMessageContracts');

const META_TEMPLATE_BINDINGS = Object.freeze([
  { contractId: 'booking_update', templateName: 'shiloh_booking_update_v1', env: 'WHATSAPP_BOOKING_UPDATE_TEMPLATE' },
  { contractId: 'workspace_booking_request_alert', templateName: 'shiloh_workspace_booking_request_alert_v1', env: 'WHATSAPP_WORKSPACE_BOOKING_REQUEST_ALERT_TEMPLATE' },
  { contractId: 'staff_auth_otp', templateName: 'shiloh_staff_auth_otp_v1', env: 'WHATSAPP_STAFF_AUTH_TEMPLATE', defaultWhenUnset: true },
  { contractId: 'staff_finalization_actions', templateName: 'shiloh_staff_finalization_actions_v1', env: null },
  { contractId: 'appointment_followup_v2', templateName: 'shiloh_appointment_followup_v2', env: 'WHATSAPP_FOLLOWUP_ACTIONS_TEMPLATE' },
  { contractId: 'booking_approval_outcome', templateName: 'shiloh_booking_approval_outcome_v1', env: null },
  { contractId: 'booking_declined', templateName: 'shiloh_booking_declined_v1', env: 'WHATSAPP_BOOKING_DECLINED_TEMPLATE' },
  { contractId: 'booking_approval_request', templateName: 'shiloh_booking_approval_request_v1', env: null },
  { contractId: 'reschedule_approval_request', templateName: 'shiloh_reschedule_approval_request_v1', env: 'WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE' },
  { contractId: 'reschedule_declined', templateName: 'shiloh_reschedule_declined_v1', env: 'WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE' },
  { contractId: 'cancellation_confirmation', templateName: 'shiloh_cancellation_confirmation_v1', env: 'WHATSAPP_CANCELLATION_CONFIRMATION_TEMPLATE' },
  { contractId: 'reschedule_confirmation', templateName: 'shiloh_reschedule_confirmation_v1', env: 'WHATSAPP_RESCHEDULE_CONFIRMATION_TEMPLATE' },
  { contractId: 'appointment_reminder_actions', templateName: 'shiloh_appointment_reminder_actions_v1', env: 'WHATSAPP_REMINDER_ACTIONS_TEMPLATE' },
  { contractId: 'booking_confirmation', templateName: 'shiloh_booking_confirmation_v1', env: 'WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE' },
  { contractId: 'booking_confirmation_v2', templateName: 'shiloh_booking_confirmation_v2', env: 'WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE' },
  { contractId: 'consultation_form', templateName: 'shiloh_consultation_form_v1', env: 'WHATSAPP_CONSULTATION_FORM_TEMPLATE', defaultWhenUnset: true },
  { contractId: 'consultation_form_reminder', templateName: 'shiloh_consultation_form_reminder_v1', env: 'WHATSAPP_CONSULTATION_FORM_REMINDER_TEMPLATE', defaultWhenUnset: true },
  { contractId: 'staff_finalization', templateName: 'shiloh_staff_finalization_v1', env: 'WHATSAPP_STAFF_FINALIZATION_TEMPLATE', defaultWhenUnset: true },
  { contractId: 'birthday_v2', templateName: 'shiloh_birthday_wish_v2', env: 'WHATSAPP_BIRTHDAY_TEMPLATE' },
  { contractId: 'birthday_v1', templateName: 'shiloh_birthday_wish_v1', env: null },
  { contractId: 'appointment_followup_legacy', templateName: 'appointment_followup', env: 'WHATSAPP_FOLLOWUP_TEMPLATE' },
  { contractId: 'appointment_reminder_legacy', templateName: 'appointment_reminder', env: 'WHATSAPP_REMINDER_TEMPLATE' },
  { contractId: 'payment_deposit_request', templateName: 'shiloh_payment_deposit_request_v1', env: 'WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE' },
  { contractId: 'payment_deposit_received', templateName: 'shiloh_payment_deposit_received_v1', env: 'WHATSAPP_PAYMENT_DEPOSIT_RECEIVED_TEMPLATE' },
  { contractId: 'payment_balance_due', templateName: 'shiloh_payment_balance_due_v1', env: 'WHATSAPP_PAYMENT_BALANCE_DUE_TEMPLATE' },
  { contractId: 'payment_split_request', templateName: 'shiloh_payment_split_request_v1', env: 'WHATSAPP_PAYMENT_SPLIT_REQUEST_TEMPLATE' },
  { contractId: 'payment_received', templateName: 'shiloh_payment_received_v1', env: 'WHATSAPP_PAYMENT_RECEIVED_TEMPLATE' },
  { contractId: 'payment_not_verified', templateName: 'shiloh_payment_not_verified_v1', env: 'WHATSAPP_PAYMENT_NOT_VERIFIED_TEMPLATE' },
  { contractId: 'payment_refund_update', templateName: 'shiloh_payment_refund_update_v1', env: 'WHATSAPP_PAYMENT_REFUND_UPDATE_TEMPLATE' },
  { contractId: 'payment_voucher_request', templateName: 'shiloh_payment_voucher_request_v1', env: 'WHATSAPP_PAYMENT_VOUCHER_REQUEST_TEMPLATE' },
  { contractId: 'payment_voucher_issued', templateName: 'shiloh_payment_voucher_issued_v1', env: 'WHATSAPP_PAYMENT_VOUCHER_ISSUED_TEMPLATE' },
].map((binding) => Object.freeze({ defaultWhenUnset: false, ...binding })));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function getMetaTemplateBindingSpec(contractId) { return META_TEMPLATE_BINDINGS.find((binding) => binding.contractId === contractId) || null; }
function getContractIdForMetaTemplateName(templateName) { return META_TEMPLATE_BINDINGS.find((binding) => binding.templateName === templateName)?.contractId || null; }
function buildMetaTemplateContractView(contractId) {
  const contract = getShilohMessageContract(contractId);
  const binding = getMetaTemplateBindingSpec(contractId);
  if (!contract || !binding) throw new Error(`Unknown Shiloh Meta template binding: ${contractId}`);
  return { name: binding.templateName, ...clone(contract.message) };
}
function buildMetaTemplateRegistrationPayload(contractId) {
  const contract = getShilohMessageContract(contractId);
  if (!contract) throw new Error(`Unknown Shiloh message contract: ${contractId}`);
  if (contract.lifecycle !== 'current' || !contract.sendable) throw new Error(`Retired Shiloh message contract cannot be registered: ${contractId}`);
  const definition = buildMetaTemplateContractView(contractId);
  if (!Array.isArray(definition.components)) throw new Error(`Shiloh message contract has no registrable components: ${contractId}`);
  return definition;
}
function configuredMetaTemplateName(contractId, environment = process.env) {
  const binding = getMetaTemplateBindingSpec(contractId);
  if (!binding) return null;
  if (!binding.env) return binding.templateName;
  const override = environment[binding.env];
  if (override == null || String(override).trim() === '') return binding.defaultWhenUnset ? binding.templateName : null;
  return String(override).trim();
}
function providerMessage(provider = {}) { return { language: provider.language, category: provider.category, components: provider.components, message_send_ttl_seconds: provider.message_send_ttl_seconds }; }
function providerSpecHash(contractId, provider) { return getMessageContractSpecHash({ id: contractId, message: providerMessage(provider) }); }
function providerVariantsForContract(contractId, providerTemplates = []) {
  const binding = getMetaTemplateBindingSpec(contractId);
  if (!binding) return [];
  return (Array.isArray(providerTemplates) ? providerTemplates : []).filter((provider) => provider?.name === binding.templateName).sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
}
function resolveMetaTemplateBinding({ contractId, providerTemplates = [] } = {}) {
  const contract = getShilohMessageContract(contractId);
  const binding = getMetaTemplateBindingSpec(contractId);
  if (!contract || !binding) return { contractId, bound: false, state: 'unknown_contract', reason: 'unknown_contract' };
  const expectedSpecHash = getMessageContractSpecHash(contract);
  if (contract.lifecycle !== 'current' || !contract.sendable) return { contractId, templateName: binding.templateName, expectedSpecHash, bound: false, state: 'retired', reason: 'contract_retired' };
  const namedVariants = providerVariantsForContract(contractId, providerTemplates);
  if (namedVariants.length === 0) return { contractId, templateName: binding.templateName, expectedSpecHash, bound: false, state: 'missing', reason: 'template_missing' };
  const languageVariants = namedVariants.filter((provider) => provider?.language === contract.message.language);
  if (languageVariants.length === 0) return { contractId, templateName: binding.templateName, expectedSpecHash, bound: false, state: 'drifted', reason: 'language_mismatch', providerStatus: namedVariants[0]?.status || null };
  if (languageVariants.length !== 1) return { contractId, templateName: binding.templateName, expectedSpecHash, bound: false, state: 'duplicate', reason: 'duplicate_exact_language_variants', duplicateCount: languageVariants.length - 1, providerStatus: languageVariants[0]?.status || null };
  const provider = languageVariants[0];
  const providerStatus = String(provider?.status || '').toUpperCase();
  const actualSpecHash = providerSpecHash(contractId, provider);
  if (providerStatus !== 'APPROVED') return { contractId, templateName: binding.templateName, expectedSpecHash, actualSpecHash, bound: false, state: providerStatus === 'REJECTED' ? 'rejected' : 'pending', reason: 'provider_not_approved', providerStatus: provider?.status || null };
  if (actualSpecHash !== expectedSpecHash) return { contractId, templateName: binding.templateName, expectedSpecHash, actualSpecHash, bound: false, state: 'drifted', reason: 'provider_spec_mismatch', providerStatus: provider?.status || null };
  return { contractId, templateName: binding.templateName, expectedSpecHash, actualSpecHash, bound: true, state: 'approved_exact', reason: null, providerStatus: provider?.status || null, providerTemplateId: provider?.id == null ? null : String(provider.id) };
}
function buildMetaTemplateBindings(providerTemplates = []) { return getShilohMessageContracts().map((contract) => resolveMetaTemplateBinding({ contractId: contract.id, providerTemplates })); }
function compareMetaTemplateVariant(contractId, provider = {}) {
  const contract = getShilohMessageContract(contractId); const binding = getMetaTemplateBindingSpec(contractId); if (!contract || !binding) return { exact: false };
  const expected = canonicalizeMessageContractSpec(contract); const actual = canonicalizeMessageContractSpec({ id: contractId, message: providerMessage(provider) });
  const checks = { name: provider?.name === binding.templateName, language: actual.language === expected.language, category: actual.category === expected.category, components: JSON.stringify(actual.components) === JSON.stringify(expected.components) };
  if (expected.message_send_ttl_seconds != null) checks.messageTtl = actual.message_send_ttl_seconds === expected.message_send_ttl_seconds;
  checks.exact = Object.values(checks).every(Boolean); return checks;
}
module.exports = { META_TEMPLATE_BINDINGS, getMetaTemplateBindingSpec, getContractIdForMetaTemplateName, buildMetaTemplateContractView, buildMetaTemplateRegistrationPayload, configuredMetaTemplateName, providerVariantsForContract, providerSpecHash, resolveMetaTemplateBinding, buildMetaTemplateBindings, compareMetaTemplateVariant };
