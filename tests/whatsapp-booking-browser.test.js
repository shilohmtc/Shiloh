'use strict';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { createHmac } = require('node:crypto');
const { createWebhookRouter } = require('../src/routes/webhook');
const { createWhatsAppBookingIntake } = require('../src/services/whatsAppBookingIntake');
const { createClientCodeRouter, BASE } = require('../src/routes/clientCodeAuth');
const { createWhatsAppBookingSubmission } = require('../src/services/whatsAppBookingSubmission');

test('registration returns to the original private review and a sender retry reuses the signed request', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE crm_v2_clients(id bigint primary key, normalized_mobile text, status text, profile_status text, mobile_verified_at timestamptz);
    CREATE TABLE client_contacts(normalized_value text, contact_type text);
    CREATE TABLE booking_intents(phone varchar(32) primary key, service_text text, therapist_text text, preferred_date text,
      preferred_time text, service_verified boolean, status text, policy_version text, policy_accepted_at timestamptz, policy_channel text);
    CREATE TABLE booking_policy_acceptances(id bigint generated always as identity primary key, phone varchar(32), crm_v2_client_id bigint,
      service_text text, therapist_text text, preferred_date text, preferred_time text, policy_version text, accepted_at timestamptz,
      policy_text_snapshot text, channel text, appointment_id bigint);
    INSERT INTO crm_v2_clients VALUES (55,'27820000001','active','registered',NOW());
  `);
  const connection = { query: (...args) => db.query(...args), release() {} };
  const token = 'a'.repeat(100);
  const review = {
    status: 'review',
    service: { name: 'Massage & Care' },
    practitioner: { name: 'Fictional staff' },
    startsAt: '2030-12-01T08:15:00.000Z',
    price: '650.00',
    deposit: '325.00',
    reviewHash: 'b'.repeat(43),
  };
  const continuation = {
    selectedMobile: (value) => (value === token ? '27820000001' : null),
    resume: async (value, session) =>
      value === token && session?.crmV2ClientId === 55 ? review : null,
  };
  const sessions = {
    validateSessionToken: async (value) =>
      value === 'fixture-client'
        ? { ok: true, crmV2ClientId: 55, sessionId: 'fixture-session' }
        : { ok: false },
    validateCsrfToken: (_session, value) => value === 'fixture-csrf',
    rotateCsrfToken: async () => ({ ok: true, csrfToken: 'fixture-csrf' }),
  };
  const outgoing = [];
  const app = express();
  app.use(
    BASE,
    createClientCodeRouter({
      enabled: true,
      sessions,
      env: { NODE_ENV: 'test' },
      service: {
        enabled: () => true,
        smsEnabled: () => false,
        admitRequest: async () => true,
        completeRegistration: async () => ({
          ok: true,
          sessionToken: 'fixture-client',
          expiresAt: Date.now() + 60000,
          client: {},
        }),
      },
      bookingBrowser: {
        continuation,
        submit: createWhatsAppBookingSubmission({
          continuation,
          actionSecret: 'fictional-key',
          db: { connect: async () => connection },
        }),
        async deliverRequestButton(message) {
          outgoing.push(message);
          if (outgoing.length === 1) throw new Error('Fictional outage');
        },
      },
    }),
  );
  let receipt;
  let writes = 0;
  const acks = new Map();
  app.use(
    createWebhookRouter({
      booking: {
        providerSecret: 'synthetic provider',
        actionSecret: 'fictional-key',
        phoneNumberId: 'fixture-number',
      },
      receiveBooking: createWhatsAppBookingIntake({
        db: {},
        readReceipt: async () => receipt,
        commitBooking: async (mobile, authority) => {
          assert.equal(mobile, '27820000001');
          assert.equal(authority.whatsappAcceptanceId, '1');
          assert.equal(authority.whatsappReviewHash, review.reviewHash);
          writes++;
          receipt = {
            appointmentId: '99',
            status: 'pending_resolution',
            reply: 'Your request is with Reception.',
          };
          return receipt;
        },
      }),
      deliverAcknowledgement: async (ack) => acks.set(ack.deduplicationKey, ack),
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (suffix, options = {}) =>
    fetch(origin + BASE + suffix, { redirect: 'manual', ...options });
  const opened = await call('/booking/open?request=' + token);
  assert.equal(opened.status, 303);
  assert.equal(opened.headers.get('location'), BASE + '/');
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  const loginPage = await call('/');
  await loginPage.text();
  const registration = await call('/register', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: cookie + '; ' + loginPage.headers.get('set-cookie').split(';')[0],
    },
    body: JSON.stringify({ grant: 'fixture', profile: {} }),
  });
  const authResult = await registration.json();
  assert.equal(authResult.bookingReview, BASE + '/booking/review');
  const signedIn = cookie + '; ' + registration.headers.get('set-cookie').split(';')[0];
  const shown = await call('/booking/review', { headers: { cookie: signedIn } });
  assert.equal(shown.status, 200);
  assert.match(await shown.text(), /Massage &amp; Care.*R650\.00.*R325\.00/s);
  const submit = (policyAccepted, reviewHash = review.reviewHash, csrf = 'fixture-csrf') =>
    call('/booking/review', {
      method: 'POST',
      headers: { origin, cookie: signedIn, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ policyAccepted, reviewHash, csrf }),
    });
  assert.equal((await submit('no')).status, 409);
  assert.equal((await submit('yes', 'stale')).status, 409);
  assert.equal((await submit('yes', review.reviewHash, 'wrong')).status, 403);
  assert.equal(outgoing.length, 0);
  assert.equal((await submit('yes')).status, 503);
  const retried = await submit('yes');
  assert.equal(retried.status, 200);
  assert.match(await retried.text(), /Request appointment/);
  assert.equal(outgoing.length, 2);
  assert.equal(outgoing[0].action, outgoing[1].action);
  assert.equal(outgoing[0].deduplicationKey, outgoing[1].deduplicationKey);
  assert.equal((await db.query('SELECT id FROM booking_policy_acceptances')).rows.length, 1);
  assert.equal(writes, 0);
  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'fixture-number' },
              messages: [
                {
                  type: 'interactive',
                  from: outgoing[1].recipient,
                  interactive: { type: 'button_reply', button_reply: { id: outgoing[1].action } },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature =
    'sha256=' + createHmac('sha256', 'synthetic provider').update(payload).digest('hex');
  for (let i = 0; i < 2; i++) {
    const callback = await fetch(origin + '/webhook', {
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
    });
    assert.equal(callback.status, 200);
    await callback.text();
  }
  assert.equal(writes, 1);
  assert.equal(acks.size, 1);
  assert.equal(acks.get('booking-pending:99').text, 'Your request is with Reception.');
});
