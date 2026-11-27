'use strict';
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const { createWhatsAppBookingChat } = require('../src/services/whatsAppBookingChat');
const { createWebhookRouter } = require('../src/routes/webhook');
const { createClientCodeRouter, BASE } = require('../src/routes/clientCodeAuth');

const mobile = '27820000001';
const otherMobile = '27820000002';
const choiceDate = '2030-11-27';
const slot = '2030-11-27T08:00:00.000Z';
const clock = Date.parse('2030-11-26T15:00:00Z');
const seconds = clock / 1000;
const fixtureConfig = {
  phoneNumberId: 'fixture-number',
  now: clock,
  providerSecret: 'fictional provider',
  actionSecret: 'fictional action',
};

test('the verified browser return starts live choices with signed rows and ends at private review', async (t) => {
  let active = true;
  let time = clock;
  const chat = createWhatsAppBookingChat({
    key: Buffer.alloc(32, 7),
    clock: () => time,
    db: {
      async query(sql, [id, phone]) {
        if (sql.includes('SELECT normalized_mobile'))
          return { rows: [{ normalized_mobile: String(id) === '4' ? mobile : otherMobile }] };
        assert.equal(phone, mobile);
        return { rows: active && String(id) === '4' ? [{ id: 4 }] : [] };
      },
    },
    async choices({ senderMobile, session, serviceId, staffId, date, startsAt }) {
      assert.equal(senderMobile, mobile);
      assert.equal(session.crmV2ClientId, '4');
      if (!active) return { status: 'verification_required' };
      if (!serviceId)
        return {
          status: 'choices',
          kind: 'treatment',
          choices: [{ id: 1, title: 'Fictional massage' }],
        };
      if (!staffId)
        return {
          status: 'choices',
          kind: 'practitioner',
          choices: [{ id: 7, title: 'Fictional practitioner' }],
        };
      if (!date)
        return { status: 'choices', kind: 'date', choices: [{ id: choiceDate, title: '27 Nov' }] };
      if (!startsAt)
        return { status: 'choices', kind: 'time', choices: [{ id: slot, title: '10:00' }] };
      assert.deepEqual([serviceId, staffId, date, startsAt], [1, 7, choiceDate, slot]);
      return {
        status: 'review',
        startsAt: slot,
        service: { name: 'Fictional massage' },
        practitioner: { name: 'Fictional practitioner' },
        price: '650.00',
        deposit: '325.00',
        continuationToken: 'privateToken',
      };
    },
  });
  const app = express();
  const delivered = [];
  const links = [];
  app.use(
    createWebhookRouter({
      booking: fixtureConfig,
      bookingChat: chat,
      deliverBookingMenu: async (m) => delivered.push(m),
      deliverBookingLink: async (m) => links.push(m),
      deliverAcknowledgement: async () => assert.fail('Chat choices do not create bookings'),
    }),
  );
  app.use(
    BASE,
    createClientCodeRouter({
      enabled: true,
      env: { NODE_ENV: 'test' },
      sessions: {
        async validateSessionToken(token) {
          return token === 'signed-fixture' ? { ok: true, crmV2ClientId: 4 } : { ok: false };
        },
        validateCsrfToken: () => false,
      },
      service: { enabled: () => true, smsEnabled: () => false },
      bookingBrowser: {
        bookingChat: chat,
        continuation: { selectedMobile: () => null },
        submit: async () => assert.fail('no submit'),
        deliverRequestButton: async () => assert.fail('no send'),
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let sequence = 0;
  const post = async (content, from = mobile, bad = false) => {
    const message = { from, id: 'wamid.chat' + ++sequence, timestamp: String(seconds), ...content };
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: fixtureConfig.phoneNumberId },
                messages: [message, message],
              },
            },
          ],
        },
      ],
    });
    const signature =
      'sha256=' + createHmac('sha256', fixtureConfig.providerSecret).update(body).digest('hex');
    const response = await fetch(origin + '/webhook', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': bad ? 'invalid' : signature,
      },
    });
    assert.equal(response.status, 200);
    await response.text();
  };
  await post({ type: 'text', text: { body: 'BOOK' } });
  assert.equal(links.length, 1);
  const open = new URL(links[0].text.match(/https:\/\/[^\s]+$/)[0]);
  const start = open.searchParams.get('request');
  assert.equal(await chat.resumeLink(start, { crmV2ClientId: 8 }), null);
  const opened = await fetch(origin + open.pathname + open.search, { redirect: 'manual' });
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  assert.equal(opened.headers.get('location'), BASE + '/');
  const browser = await fetch(origin + BASE + '/booking/review', {
    headers: { cookie: cookie + '; shiloh_client_session=signed-fixture' },
  });
  assert.equal(browser.status, 200);
  const markup = await browser.text();
  const returned = new URL(markup.match(/href="(https:\/\/wa\.me\/[^"]+)"/)[1]);
  const command = returned.searchParams.get('text');
  const inbound = { type: 'text', text: { body: command } };
  await post(inbound, otherMobile);
  await post(inbound, mobile, true);
  assert.equal(delivered.length, 0);
  await post(inbound);
  const tap = () =>
    post({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: delivered.at(-1).rows[0].id } },
    });
  for (const expected of [
    'Choose a treatment',
    'Choose a practitioner',
    'Choose a date',
    'Choose a time',
  ]) {
    assert.equal(delivered.at(-1).text, expected);
    assert.ok(delivered.at(-1).rows[0].id.length <= 200);
    await tap();
  }
  assert.equal(delivered.length, 5);
  assert.match(
    delivered[4].text,
    /Price: R650\.00.*Deposit after staff approval: R325\.00.*request=privateToken/s,
  );
  assert.ok(delivered.every((reply) => reply.deduplicationKey.startsWith('booking-menu:')));
  active = false;
  await post(inbound);
  time += 45 * 60 * 1000;
  await post(inbound);
  assert.equal(delivered.length, 5);
});
