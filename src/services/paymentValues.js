const { APP_ORIGIN } = require('../config/publicOrigins');

function normalizePaymentMobile(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (/^0[6789][0-9]{8}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27[6789][0-9]{8}$/.test(digits)) return digits;
  return null;
}

function formatRand(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `R${amount.toFixed(2)}` : 'R0.00';
}

function securePaymentUrl(requestKey) {
  const key = String(requestKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new Error('A route-safe payment request key is required');
  return `${APP_ORIGIN}/pay/${encodeURIComponent(key)}`;
}

module.exports = { normalizePaymentMobile, formatRand, securePaymentUrl };
