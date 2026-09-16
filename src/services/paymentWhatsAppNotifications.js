const logger = require('../lib/logger');
const { configuredMetaTemplateName } = require('./metaTemplateAdapter');
const { sendWhatsAppTemplate } = require('./whatsapp');

const PAYMENT_TEMPLATE_KEYS = Object.freeze({
  DEPOSIT_REQUEST: 'payment_deposit_request',
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

function paymentNotificationsEnabled(environment = process.env) {
  return String(environment.WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true';
}

async function sendPaymentTemplate({
  templateKey,
  to,
  bodyParameters = [],
  urlButtonParameter = null,
  quickReplyPayloads = [],
  environment = process.env,
  send = sendWhatsAppTemplate,
} = {}) {
  if (!paymentNotificationsEnabled(environment)) return { sent: false, reason: 'disabled' };
  const phone = normalizeWhatsAppMobile(to);
  if (!phone) return { sent: false, reason: 'missing_or_invalid_mobile' };
  const templateName = configuredMetaTemplateName(templateKey, environment);
  if (!templateName) return { sent: false, reason: 'template_not_configured' };

  try {
    const response = await send(
      phone,
      templateName,
      bodyParameters,
      'en',
      quickReplyPayloads,
      urlButtonParameter ? [String(urlButtonParameter)] : [],
    );
    return {
      sent: true,
      templateKey,
      templateName,
      messageId: response?.messages?.[0]?.id || null,
    };
  } catch (error) {
    logger.warn({
      err: error,
      templateKey,
      toSuffix: phone.slice(-4),
    }, 'Payment WhatsApp notification was not sent');
    return { sent: false, reason: 'provider_send_failed', templateKey };
  }
}

module.exports = {
  PAYMENT_TEMPLATE_KEYS,
  normalizeWhatsAppMobile,
  formatRand,
  paymentNotificationsEnabled,
  sendPaymentTemplate,
};
