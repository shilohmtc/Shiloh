const crypto = require('node:crypto');
const { buildBirthdayTemplateDefinition } = require('./birthdayTemplateProvisioning');
const { buildStaffFinalizationTemplateDefinition, buildStaffFinalizationActionTemplateDefinition } = require('./staffFinalizationTemplateProvisioning');
const { buildBookingConfirmationTemplateDefinition } = require('./bookingConfirmationTemplateProvisioning');
const { buildBookingConfirmationV2TemplateDefinition } = require('./bookingConfirmationV2TemplateProvisioning');
const { buildWorkspaceBookingRequestAlertTemplateDefinition } = require('./workspaceBookingRequestAlertTemplateProvisioning');
const { buildReminderActionTemplateDefinition } = require('./reminderActionTemplateProvisioning');
const { buildDefinition } = require('./clientLifecycleTemplateProvisioning');
const { buildStaffAuthTemplateSubmissionDefinition } = require('./staffAuthTemplateDefinition');
const { buildPaymentTemplateDefinition } = require('./paymentTemplateDefinitions');

const definition = (key) => buildDefinition(key);

const SOURCE_DEFINITIONS = Object.freeze({
  booking_update: () => definition('booking_update'),
  workspace_booking_request_alert: () => buildWorkspaceBookingRequestAlertTemplateDefinition(),
  staff_auth_otp: () => buildStaffAuthTemplateSubmissionDefinition(),
  staff_finalization_actions: () => buildStaffFinalizationActionTemplateDefinition(),
  appointment_followup_v2: () => definition('appointment_followup_actions'),
  booking_approval_outcome: () => definition('booking_approval_outcome'),
  booking_declined: () => definition('booking_declined'),
  booking_approval_request: () => definition('booking_approval_request'),
  reschedule_approval_request: () => definition('reschedule_approval_request'),
  reschedule_declined: () => definition('reschedule_declined'),
  cancellation_confirmation: () => definition('cancellation_confirmation'),
  reschedule_confirmation: () => definition('reschedule_confirmation'),
  appointment_reminder_actions: () => buildReminderActionTemplateDefinition(),
  booking_confirmation: () => buildBookingConfirmationTemplateDefinition(),
  booking_confirmation_v2: () => buildBookingConfirmationV2TemplateDefinition(),
  staff_finalization: () => buildStaffFinalizationTemplateDefinition(),
  birthday_v2: () => buildBirthdayTemplateDefinition(),
  birthday_v1: () => ({ language: 'en', category: 'MARKETING', components: null }),
  appointment_followup_legacy: () => ({ language: 'en', category: 'UTILITY', components: null }),
  appointment_reminder_legacy: () => ({ language: 'en', category: 'UTILITY', components: null }),
  payment_deposit_request: () => buildPaymentTemplateDefinition('payment_deposit_request'),
  payment_deposit_received: () => buildPaymentTemplateDefinition('payment_deposit_received'),
  payment_balance_due: () => buildPaymentTemplateDefinition('payment_balance_due'),
  payment_split_request: () => buildPaymentTemplateDefinition('payment_split_request'),
  payment_received: () => buildPaymentTemplateDefinition('payment_received'),
  payment_not_verified: () => buildPaymentTemplateDefinition('payment_not_verified'),
  payment_refund_update: () => buildPaymentTemplateDefinition('payment_refund_update'),
  payment_voucher_request: () => buildPaymentTemplateDefinition('payment_voucher_request'),
  payment_voucher_issued: () => buildPaymentTemplateDefinition('payment_voucher_issued'),
});

const CONTRACT_LIFECYCLE = Object.freeze({
  booking_approval_request: 'retired',
  booking_approval_outcome: 'retired',
  birthday_v1: 'retired',
  appointment_followup_legacy: 'retired',
  appointment_reminder_legacy: 'retired',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function toMessage(definitionValue) {
  const message = clone(definitionValue) || {};
  delete message.name;
  return message;
}

const SHILOH_MESSAGE_CONTRACTS = Object.freeze(
  Object.entries(SOURCE_DEFINITIONS).map(([id, build]) => {
    const lifecycle = CONTRACT_LIFECYCLE[id] || 'current';
    return deepFreeze({
      id,
      lifecycle,
      sendable: lifecycle === 'current',
      message: toMessage(build()),
    });
  }),
);

function getShilohMessageContracts() {
  return SHILOH_MESSAGE_CONTRACTS;
}

function getShilohMessageContract(id) {
  return SHILOH_MESSAGE_CONTRACTS.find((contract) => contract.id === id) || null;
}

function semanticButton(button = {}, contractId = null) {
  const otpType = button.otp_type == null ? null : String(button.otp_type).toUpperCase();
  let type = String(button.type || '').toUpperCase();
  if (contractId === 'staff_auth_otp' && otpType === 'COPY_CODE') type = 'OTP';
  const normalized = { type };
  if (button.text != null) normalized.text = button.text;
  if (otpType) normalized.otp_type = otpType;
  if (contractId !== 'staff_auth_otp' && button.url != null) normalized.url = button.url;
  if (button.phone_number != null) normalized.phone_number = button.phone_number;
  return normalized;
}

function semanticComponents(components = [], contractId = null) {
  if (!Array.isArray(components)) return null;
  return components.map((component) => {
    const normalized = { type: String(component?.type || '').toUpperCase() };
    if (component?.format != null) normalized.format = String(component.format).toUpperCase();
    if (component?.text != null) normalized.text = component.text;
    if (component?.add_security_recommendation != null) normalized.add_security_recommendation = Boolean(component.add_security_recommendation);
    if (component?.code_expiration_minutes != null) normalized.code_expiration_minutes = Number(component.code_expiration_minutes);
    if (Array.isArray(component?.buttons)) normalized.buttons = component.buttons.map((button) => semanticButton(button, contractId));
    return normalized;
  });
}

function resolveContractInput(value) {
  if (typeof value === 'string') {
    const contract = getShilohMessageContract(value);
    if (!contract) throw new Error(`Unknown Shiloh message contract: ${value}`);
    return contract;
  }
  if (!value || typeof value !== 'object') throw new Error('Shiloh message contract is required');
  if (value.message) return value;
  return { id: value.id || value.key || null, message: value };
}

function canonicalizeMessageContractSpec(value) {
  const contract = resolveContractInput(value);
  const message = contract.message || {};
  return {
    id: contract.id || null,
    language: String(message.language || ''),
    category: String(message.category || '').toUpperCase(),
    components: semanticComponents(message.components, contract.id || null),
    message_send_ttl_seconds: message.message_send_ttl_seconds == null
      ? null
      : Number(message.message_send_ttl_seconds),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function getMessageContractSpecHash(value) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(canonicalizeMessageContractSpec(value)))
    .digest('hex');
}

module.exports = {
  SHILOH_MESSAGE_CONTRACTS,
  getShilohMessageContracts,
  getShilohMessageContract,
  semanticButton,
  semanticComponents,
  canonicalizeMessageContractSpec,
  stableStringify,
  getMessageContractSpecHash,
};
