const logger = require('../lib/logger');
const { APP_ORIGIN } = require('../config/publicOrigins');
const { configuredMetaTemplateName } = require('./metaTemplateAdapter');
const { sendWhatsAppTemplate } = require('./whatsapp');

const LEGACY_DEPOSIT_TEMPLATE_NAME = 'shiloh_payment_deposit_request_v1';

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

function paymentNotificationsEnabled(environment = process.env) {
  return String(environment.WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true';
}

function isTemplateUnavailableError(error) {
  const providerError = error?.response?.data?.error || {};
  const code = Number(providerError.code);
  const message = String(providerError.message || error?.message || '');
  return [132001, 132015].includes(code)
    || /template[^\n]*(?:not found|does not exist|not approved|paused|disabled)/i.test(message);
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
    if (templateKey === PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST && isTemplateUnavailableError(error)) {
      const legacyTemplateName = String(environment.WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE || LEGACY_DEPOSIT_TEMPLATE_NAME).trim();
      if (legacyTemplateName && legacyTemplateName !== templateName) {
        try {
          const fallback = await send(
            phone,
            legacyTemplateName,
            bodyParameters,
            'en',
            quickReplyPayloads,
            urlButtonParameter ? [String(urlButtonParameter)] : [],
          );
          logger.warn({
            templateKey,
            preferredTemplateName: templateName,
            fallbackTemplateName: legacyTemplateName,
            toSuffix: phone.slice(-4),
          }, 'Deposit WhatsApp v2 unavailable; legacy deposit template used');
          return {
            sent: true,
            templateKey,
            templateName: legacyTemplateName,
            preferredTemplateName: templateName,
            fallback: true,
            messageId: fallback?.messages?.[0]?.id || null,
          };
        } catch (fallbackError) {
          logger.warn({
            err: fallbackError,
            templateKey,
            preferredTemplateName: templateName,
            fallbackTemplateName: legacyTemplateName,
            toSuffix: phone.slice(-4),
          }, 'Payment WhatsApp legacy fallback was not sent');
        }
      }
    }
    logger.warn({
      err: error,
      templateKey,
      toSuffix: phone.slice(-4),
    }, 'Payment WhatsApp notification was not sent');
    return { sent: false, reason: 'provider_send_failed', templateKey };
  }
}

module.exports = {
  LEGACY_DEPOSIT_TEMPLATE_NAME,
  PAYMENT_TEMPLATE_KEYS,
  normalizeWhatsAppMobile,
  formatRand,
  paymentNotificationsEnabled,
  isTemplateUnavailableError,
  securePaymentUrl,
  secureVoucherUrl,
  withActionLink,
  sendPaymentTemplate,
};
