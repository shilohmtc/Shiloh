const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  PAYMENT_TEMPLATE_KEYS,
  normalizeWhatsAppMobile,
  paymentNotificationsEnabled,
  securePaymentUrl,
  secureVoucherUrl,
  withActionLink,
  sendPaymentTemplate,
} = require('../src/services/paymentWhatsAppNotifications');
const { createPaymentLinkRouter } = require('../src/routes/paymentLinks');

test('payment WhatsApp notifications normalize South African mobile numbers', () => {
  assert.equal(normalizeWhatsAppMobile('071 674 2646'), '27716742646');
  assert.equal(normalizeWhatsAppMobile('+27 71 674 2646'), '27716742646');
  assert.equal(normalizeWhatsAppMobile('011 555 0100'), null);
});

test('voucher notifications include direct secure links as a button fallback', () => {
  assert.equal(securePaymentUrl('voucher_request_123'), 'https://app.shilohmtc.co.za/pay/voucher_request_123');
  assert.equal(secureVoucherUrl('voucher_request_123'), 'https://app.shilohmtc.co.za/gift-vouchers/voucher_request_123');
  assert.equal(
    withActionLink('R50.00', 'Secure payment link', securePaymentUrl('voucher_request_123')),
    'R50.00\nSecure payment link: https://app.shilohmtc.co.za/pay/voucher_request_123',
  );
  assert.throws(() => securePaymentUrl('unsafe/key'));
});

test('payment WhatsApp notifications remain off until explicitly enabled', async () => {
  let calls = 0;
  assert.equal(paymentNotificationsEnabled({}), false);
  const result = await sendPaymentTemplate({
    templateKey: PAYMENT_TEMPLATE_KEYS.RECEIVED,
    to: '0716742646',
    bodyParameters: ['Jean-Pierre'],
    environment: {},
    send: async () => { calls += 1; },
  });
  assert.deepEqual(result, { sent: false, reason: 'disabled' });
  assert.equal(calls, 0);
});

test('enabled payment notification passes a dynamic Shiloh payment button value', async () => {
  let call = null;
  const result = await sendPaymentTemplate({
    templateKey: PAYMENT_TEMPLATE_KEYS.BALANCE_DUE,
    to: '0716742646',
    bodyParameters: ['Jean-Pierre', 'Massage', '699', 'R20.00'],
    urlButtonParameter: 'request_699_token',
    environment: {
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PAYMENT_BALANCE_DUE_TEMPLATE: 'shiloh_payment_balance_due_v1',
    },
    send: async (...args) => { call = args; return { messages: [{ id: 'wamid.test' }] }; },
  });
  assert.equal(result.sent, true);
  assert.deepEqual(call, [
    '27716742646',
    'shiloh_payment_balance_due_v1',
    ['Jean-Pierre', 'Massage', '699', 'R20.00'],
    'en',
    [],
    ['request_699_token'],
  ]);
});

test('deposit request prefers policy-aware v2 and falls back safely while Meta approval is pending', async () => {
  const calls = [];
  const result = await sendPaymentTemplate({
    templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST,
    to: '0716742646',
    bodyParameters: ['Jean-Pierre', 'R125.00', 'Toe Gel Only', 'Saturday, 03 October 2026', '08:00', '760'],
    urlButtonParameter: 'dep_760_token',
    environment: {
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE: 'shiloh_payment_deposit_request_v1',
    },
    send: async (...args) => {
      calls.push(args);
      if (args[1] === 'shiloh_payment_deposit_request_v2') throw new Error('template pending');
      return { messages: [{ id: 'wamid.legacy' }] };
    },
  });
  assert.equal(result.sent, true);
  assert.equal(result.fallback, true);
  assert.equal(result.templateName, 'shiloh_payment_deposit_request_v1');
  assert.equal(calls[0][1], 'shiloh_payment_deposit_request_v2');
  assert.equal(calls[1][1], 'shiloh_payment_deposit_request_v1');
});


test('payment links show the booking policy before redirecting to Ozow', async () => {
  const app = express();
  app.use('/pay', createPaymentLinkRouter({
    policySchema: async () => {},
    db: { query: async () => ({ rows: [{
      provider: 'ozow',
      state: 'link_issued',
      provider_payment_url: 'https://pay.ozow.com/request/test',
      amount: '125.00',
      payer_name: 'Jean-Pierre Botha',
      payer_mobile: '27716742646',
      appointment_id: 759,
    }] }) },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const response = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: address.port, path: '/pay/request_699_token' }, resolve);
      request.on('error', reject);
    });
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    await new Promise(resolve => response.on('end', resolve));
    assert.equal(response.statusCode, 200);
    assert.match(body, /Before you pay, review the Booking Policy & Terms/);
    assert.match(body, /R125\.00/);
    assert.match(body, /No payment is taken on this page/);
    assert.match(body, /I have read and accept/);
    assert.match(body, /I accept — continue to secure payment/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('cancelled booking payment links fail closed before policy acceptance or Ozow redirect', async () => {
  const app = express();
  app.use('/pay', createPaymentLinkRouter({
    policySchema: async () => { throw new Error('policy schema should not run'); },
    db: { query: async () => ({ rows: [{
      provider: 'ozow',
      state: 'link_issued',
      provider_payment_url: 'https://pay.ozow.com/request/old',
      amount: '125.00',
      payer_name: 'Jean-Pierre Botha',
      payer_mobile: '27716742646',
      appointment_id: 759,
      appointment_status: 'cancelled',
    }] }) },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const getResponse = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: address.port, path: '/pay/old_759_token' }, resolve);
      request.on('error', reject);
    });
    let getBody = '';
    getResponse.setEncoding('utf8');
    getResponse.on('data', chunk => { getBody += chunk; });
    await new Promise(resolve => getResponse.on('end', resolve));
    assert.equal(getResponse.statusCode, 410);
    assert.match(getBody, /booking was cancelled/i);
    assert.match(getBody, /can no longer be used/i);

    const postResponse = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: '/pay/old_759_token/accept',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, resolve);
      request.on('error', reject);
      request.end('accept=yes');
    });
    assert.equal(postResponse.statusCode, 410);
    assert.equal(postResponse.headers.location, undefined);
    postResponse.resume();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('payment policy acceptance is recorded before redirecting to Ozow', async () => {
  const queries = [];
  const app = express();
  app.use('/pay', createPaymentLinkRouter({
    policySchema: async () => {},
    db: { query: async (sql) => {
      queries.push(sql);
      if (String(sql).startsWith('SELECT')) return { rows: [{
        provider: 'ozow',
        state: 'link_issued',
        provider_payment_url: 'https://pay.ozow.com/request/test',
        amount: '125.00',
        payer_name: 'Jean-Pierre Botha',
        payer_mobile: '27716742646',
        appointment_id: 759,
      }] };
      return { rows: [] };
    } },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: address.address,
        port: address.port,
        path: '/pay/request_699_token/accept',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, resolve);
      request.on('error', reject);
      request.end('accept=yes');
    });
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, 'https://pay.ozow.com/request/test');
    assert.equal(queries.some(sql => String(sql).includes('booking_policy_acceptances')), true);
    response.resume();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('payment service has payment notification hooks at request and settlement boundaries', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/bookingPayments.js'), 'utf8');
  assert.match(source, /sendPaymentTemplate/);
  assert.match(source, /PAYMENT_TEMPLATE_KEYS\.BALANCE_DUE/);
  assert.match(source, /PAYMENT_TEMPLATE_KEYS\.RECEIVED/);
  assert.match(source, /PAYMENT_TEMPLATE_KEYS\.NOT_VERIFIED/);
  assert.match(source, /PAYMENT_TEMPLATE_KEYS\.REFUND_UPDATE/);
});
