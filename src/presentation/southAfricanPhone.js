'use strict';

// Presentation only: never rewrite unknown/foreign numbers or stored identities.
// CRM validation and ownership remain in crmV2ClientService.
function localPhoneInput(value = '') {
  const original = String(value ?? '');
  if (!/^\+?[\d\s()-]+$/.test(original.trim())) return original;
  const digits = original.replace(/\D/g, '');
  if (/^0[1-9]\d{8}$/.test(digits)) return digits;
  if (/^27[1-9]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^0027[1-9]\d{8}$/.test(digits)) return `0${digits.slice(4)}`;
  return original;
}

function displayPhone(value = '', fallback = 'Contact unavailable') {
  const local = localPhoneInput(value);
  if (/^0[1-9]\d{8}$/.test(local)) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return /^\+?[\d\s()-]+$/.test(local.trim()) ? local : fallback;
}

function canonicalPhoneInput(value = '') {
  const local = localPhoneInput(value);
  return /^0[1-9]\d{8}$/.test(local) ? `27${local.slice(1)}` : String(value ?? '');
}

function phonePresentationClientScript() {
  return `var localPhoneInput=${localPhoneInput.toString()};var displayPhone=${displayPhone.toString()};var canonicalPhoneInput=${canonicalPhoneInput.toString()};`;
}

module.exports = { localPhoneInput, displayPhone, canonicalPhoneInput, phonePresentationClientScript };
