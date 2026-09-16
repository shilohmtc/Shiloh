const crypto = require('crypto');

class OzowConfigurationError extends Error {
  constructor(message = 'Ozow is not configured for this Shiloh environment.') {
    super(message);
    this.code = 'PAYMENT_OZOW_NOT_CONFIGURED';
    this.httpStatus = 409;
  }
}

function configured(env = process.env) {
  return Boolean(env.OZOW_SITE_CODE && env.OZOW_PRIVATE_KEY && env.OZOW_API_KEY && env.SHILOH_PUBLIC_BASE_URL);
}

function sha512(value) {
  return crypto.createHash('sha512').update(String(value), 'utf8').digest('hex');
}

function canonicalHash(fields, privateKey) {
  return sha512(fields.map(value => String(value ?? '').trim().toLowerCase()).join('') + String(privateKey).trim().toLowerCase());
}

function notificationField(payload, name) {
  const key = Object.keys(payload || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return key ? payload[key] : '';
}

// Ozow's notification hash order is fixed and is not the same as object/property order.
const NOTIFICATION_HASH_FIELDS = Object.freeze([
  'SiteCode', 'TransactionId', 'TransactionReference', 'Amount', 'Status',
  'Optional1', 'Optional2', 'Optional3', 'Optional4', 'Optional5',
  'CurrencyCode', 'IsTest', 'StatusMessage',
]);

function createOzowPaymentProvider({ env = process.env, fetchImpl = global.fetch } = {}) {
  async function createPaymentLink({ requestKey, amount, bankReference, customerName = '', customerMobile = '' }) {
    if (!configured(env)) throw new OzowConfigurationError();
    const baseUrl = String(env.SHILOH_PUBLIC_BASE_URL).replace(/\/$/, '');
    const fields = {
      SiteCode: env.OZOW_SITE_CODE,
      CountryCode: 'ZA',
      CurrencyCode: 'ZAR',
      Amount: Number(amount).toFixed(2),
      TransactionReference: requestKey,
      BankReference: String(bankReference).slice(0, 20),
      Optional1: customerName,
      Optional2: customerMobile,
      Optional3: '', Optional4: '', Optional5: '',
      Customer: customerMobile,
      CancelUrl: `${baseUrl}/payments/return/cancelled`,
      ErrorUrl: `${baseUrl}/payments/return/error`,
      SuccessUrl: `${baseUrl}/payments/return/success`,
      NotifyUrl: `${baseUrl}/payments/providers/ozow/notify`,
      IsTest: String(env.OZOW_TEST_MODE || '').toLowerCase() === 'true' ? 'true' : 'false',
    };
    fields.HashCheck = canonicalHash(Object.values(fields), env.OZOW_PRIVATE_KEY);
    const response = await fetchImpl(String(env.OZOW_PAYMENT_API_URL || 'https://api.ozow.com/PostPaymentRequest'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ApiKey: env.OZOW_API_KEY },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error('Ozow could not create the payment link. Nothing was charged.');
      error.code = 'PAYMENT_OZOW_LINK_FAILED'; error.httpStatus = 502; throw error;
    }
    const body = await response.json();
    const url = String(body.url || body.paymentUrl || body.payment_url || '').trim();
    const id = String(body.requestId || body.paymentRequestId || body.id || '').trim();
    if (!url || !/^https:\/\//i.test(url) || !id) {
      const error = new Error('Ozow returned an incomplete payment-link response. Nothing was charged.');
      error.code = 'PAYMENT_OZOW_INVALID_RESPONSE'; error.httpStatus = 502; throw error;
    }
    return { providerRequestId: id, paymentUrl: url };
  }

  function verifyNotification(payload = {}) {
    if (!configured(env)) throw new OzowConfigurationError();
    const supplied = String(notificationField(payload, 'Hash') || notificationField(payload, 'HashCheck')).trim().toLowerCase();
    const ordered = NOTIFICATION_HASH_FIELDS.map(field => notificationField(payload, field));
    const expected = canonicalHash(ordered, env.OZOW_PRIVATE_KEY);
    if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
    return true;
  }

  return { configured: () => configured(env), createPaymentLink, verifyNotification };
}

module.exports = { OzowConfigurationError, configured, canonicalHash, createOzowPaymentProvider, NOTIFICATION_HASH_FIELDS };
