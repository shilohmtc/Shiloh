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
const { webPolicyHtml } = require('../src/presentation/paymentPolicyUx');
const { BOOKING_POLICY_TEXT } = require('../src/config/bookingPolicyAuthority');

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
      if (args[1] === 'shiloh_payment_deposit_request_v2') {
        const error = new Error('template does not exist');
        error.response = { data: { error: { code: 132001, message: 'Template does not exist' } } };
        throw error;
      }
      return { messages: [{ id: 'wamid.legacy' }] };
    },
  });
  assert.equal(result.sent, true);
  assert.equal(result.fallback, true);
  assert.equal(result.templateName, 'shiloh_payment_deposit_request_v1');
  assert.equal(calls[0][1], 'shiloh_payment_deposit_request_v2');
  assert.equal(calls[1][1], 'shiloh_payment_deposit_request_v1');
});


test('deposit request falls back when Shiloh knows v2 is pending approval before provider send', async () => {
  const calls = [];
  const result = await sendPaymentTemplate({
    templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST,
    to: '0825278287',
    bodyParameters: ['Client', 'R125.00', 'Medi-Heel Pedicure', 'Friday, 25 September 2026', '08:00', '761'],
    urlButtonParameter: 'dep_761_token',
    environment: {
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE: 'shiloh_payment_deposit_request_v1',
    },
    send: async (...args) => {
      calls.push(args);
      if (args[1] === 'shiloh_payment_deposit_request_v2') {
        throw Object.assign(
          new Error('WhatsApp template is not exact, approved and configured: shiloh_payment_deposit_request_v2'),
          { code: 'META_TEMPLATE_NOT_READY' },
        );
      }
      return { messages: [{ id: 'wamid.761.legacy' }] };
    },
  });
  assert.equal(result.sent, true);
  assert.equal(result.fallback, true);
  assert.equal(result.templateName, 'shiloh_payment_deposit_request_v1');
  assert.deepEqual(calls.map(call => call[1]), [
    'shiloh_payment_deposit_request_v2',
    'shiloh_payment_deposit_request_v1',
  ]);
});

test('ambiguous provider failure does not retry a second WhatsApp template', async () => {
  let calls = 0;
  const result = await sendPaymentTemplate({
    templateKey: PAYMENT_TEMPLATE_KEYS.DEPOSIT_REQUEST,
    to: '0716742646',
    bodyParameters: ['Jean-Pierre', 'R125.00', 'Toe Gel Only', 'Saturday, 03 October 2026', '08:00', '760'],
    urlButtonParameter: 'dep_760_token',
    environment: {
      WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PAYMENT_DEPOSIT_REQUEST_TEMPLATE: 'shiloh_payment_deposit_request_v1',
    },
    send: async () => { calls += 1; throw new Error('network timeout'); },
  });
  assert.equal(result.sent, false);
  assert.equal(calls, 1);
});

test('web payment policy formats and reorders the canonical authority without changing its wording', () => {
  const html = webPolicyHtml(BOOKING_POLICY_TEXT);
  assert.match(html, /<h2>Booking Deposit<\/h2>/);
  assert.match(html, /<h2>Cancellations &amp; Rescheduling<\/h2>/);
  assert.match(html, /<h2>Appointments &amp; Arrival<\/h2>/);
  assert.match(html, /<h2>Health &amp; Treatment Information<\/h2>/);
  assert.match(html, /<h2>Respect, Safety &amp; Belongings<\/h2>/);
  assert.match(html, /<p>We understand that plans can change\./);
  assert.match(html, /<li>48 hours or more before your appointment: No portion of your booking deposit is forfeited\.<\/li>/);
  assert.doesNotMatch(html, /Marietjie/i);

  const deposit = html.indexOf('<h2>Booking Deposit</h2>');
  const cancellations = html.indexOf('<h2>Cancellations &amp; Rescheduling</h2>');
  const professionalHeading = html.indexOf('<h2>Professional Treatment Standards</h2>');
  const professional = html.indexOf('All treatments and services provided by Shiloh are strictly professional and non-sexual.');
  const appointments = html.indexOf('<h2>Appointments &amp; Arrival</h2>');
  const health = html.indexOf('<h2>Health &amp; Treatment Information</h2>');
  assert.ok(deposit >= 0 && deposit < cancellations);
  assert.ok(cancellations < professionalHeading && professionalHeading < professional && professional < appointments && appointments < health);
  assert.equal(html.match(/<h2>([^<]+)<\/h2>/)?.[1], 'Booking Deposit');

  assert.doesNotMatch(html, /reply exactly/i);
  assert.doesNotMatch(html, /reply\s+(?:\*?DECLINE\*?)/i);
  assert.doesNotMatch(html, /Policy updated:/i);
  assert.doesNotMatch(html, /Policy version:/i);
  assert.doesNotMatch(html, /\*Appointments & Arrival\*/);
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
    assert.match(body, /Review &amp; accept before payment/);
    assert.match(body, /R125\.00/);
    assert.match(body, /No payment is taken until you accept/);
    assert.match(body, /I have read and accept/);
    assert.match(body, /Accept &amp; continue to secure payment/);
    assert.doesNotMatch(body, /reply exactly/i);
    assert.doesNotMatch(body, /\*Respect, Safety & Belongings\*/);
    assert.doesNotMatch(body, /Updated 25 September 2026/);
    assert.doesNotMatch(body, /Version 2026-09-25-v3/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('terminal payment links lead to the status page and never redirect back to Ozow', async () => {
  for (const state of ['failed', 'paid']) {
    const app = express();
    app.use('/pay', createPaymentLinkRouter({
      policySchema: async () => { throw new Error('policy schema should not run'); },
      db: { query: async () => ({ rows: [{ state, amount: '125.00', payer_mobile: '27716742646' }] }) },
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}/pay`;
      const response = await fetch(`${base}/request_699_token`, { redirect: 'manual' });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/pay/status/request_699_token');
      const status = await fetch(new URL(response.headers.get('location'), base));
      assert.equal(status.status, 200);
      const body = await status.text();
      assert.match(body, state === 'paid' ? /Payment received/ : /Payment not confirmed/);
      assert.match(body, state === 'paid' ? /do not need to pay again/ : /contact the clinic before trying again/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
});

test('an expired issued link explains that payment is not confirmed', async () => {
  const app = express();
  app.use('/pay', createPaymentLinkRouter({
    db: { query: async () => ({ rows: [{ state: 'link_issued', amount: '125.00', payer_mobile: '27716742646', expires_at: '2020-01-01T00:00:00Z' }] }) },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/pay`;
    const response = await fetch(`${base}/request_699_token`, { redirect: 'manual' });
    assert.equal(response.status, 410);
    assert.match(await response.text(), /Payment not confirmed/);
    const page = await (await fetch(`${base}/status/request_699_token`)).text();
    assert.match(page, /Payment not confirmed/);
    assert.match(page, /contact the clinic before trying again/);
  } finally {
    await new Promise(resolve => server.close(resolve));
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
