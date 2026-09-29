const { APP_ORIGIN } = require('../config/publicOrigins');

const PAYMENT_TEMPLATE_KEYS = Object.freeze({
  DEPOSIT_REQUEST: 'payment_deposit_request_v2',
  DEPOSIT_RECEIVED: 'payment_deposit_received',
  BALANCE_DUE: 'payment_balance_due',
  SPLIT_REQUEST: 'payment_split_request',
  RECEIVED: 'payment_received',
  NOT_VERIFIED: 'payment_not_verified',
  REFUND_UPDATE: 'payment_refund_update',
  VOUCHER_REQUEST: 'payment_voucher_request',
  VOUCHER_ISSUED: 'payment_voucher_issued',
});

function normalizeWhatsAppMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^0[6789][0-9]{8}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27[6789][0-9]{8}$/.test(digits)) return digits;
  return null;
}

function formatRand(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `R${amount.toFixed(2)}` : 'R0.00';
}

function paymentNotificationsEnabled() {
  return false;
}

function securePaymentUrl(requestKey) {
  const key = String(requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new Error('A route-safe payment request key is required');
  return `${APP_ORIGIN}/pay/${encodeURIComponent(key)}`;
}

function secureVoucherUrl(requestKey) {
  const key = String(requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new Error('A route-safe voucher request key is required');
  return `${APP_ORIGIN}/gift-vouchers/${encodeURIComponent(key)}`;
}

function withActionLink(value, label, url) {
  return `${String(value)}\n${label}: ${url}`;
}

async function sendPaymentTemplate() {
  // Payment notices are app-owned. Keep this compatibility entry point until
  // the legacy callers and Meta template inventory are removed in later slices.
  return { sent: false, reason: 'disabled' };
}

module.exports = {
  PAYMENT_TEMPLATE_KEYS,
  normalizeWhatsAppMobile,
  formatRand,
  paymentNotificationsEnabled,
  securePaymentUrl,
  secureVoucherUrl,
  withActionLink,
  sendPaymentTemplate,
};
