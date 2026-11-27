'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const {
  createWhatsAppBookingPilot,
  prepareConfiguredBookingPilot,
} = require('../src/services/whatsAppBookingPilot');

test('pilot applies sender, signature, auth readiness and persistent allowance gates', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, '../migrations/203_whatsapp_booking_deliveries.sql'),
      'utf8',
    ),
  );
  await db.exec(`
    CREATE TABLE crm_v2_clients(id bigint primary key,status text,profile_status text,normalized_mobile text,mobile_verified_at timestamptz);
    CREATE TABLE client_contacts(normalized_value text,contact_type text);
    INSERT INTO crm_v2_clients VALUES(4,'active','registered','27820000001',NOW());
  `);
  const now = Date.now();
  const mobile = '27820000001';
  const secret = 'synthetic-provider-secret';
  const provider = { phoneNumberId: '12345', apiVersion: 'v26.0', accessToken: 'synthetic-access' };
  const requests = [];
  let ready = false;
  const options = {
    enabled: true,
    db,
    provider,
    providerSecret: secret,
    recipient: mobile,
    maximumAttempts: 2,
    key: Buffer.alloc(32, 3),
    clock: () => now,
    bookingReady: () => ready,
    bookingService: {
      async catalogue() {
        return [{ id: 1, name: 'Fictional treatment' }];
      },
    },
    async fetchImpl(_url, request) {
      requests.push(JSON.parse(request.body));
      return Response.json({ messages: [{ id: 'wamid.mock' + requests.length }] });
    },
  };
  assert.equal(prepareConfiguredBookingPilot({ env: {} }), null);
  assert.equal(createWhatsAppBookingPilot({ ...options, enabled: false }), null);
  assert.throws(
    () => createWhatsAppBookingPilot({ ...options, providerSecret: null }),
    /incomplete/,
  );
  const pilot = createWhatsAppBookingPilot(options);
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {} };
    next();
  });
  app.use(pilot.webhookRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const uri = 'http://127.0.0.1:' + server.address().port + '/webhook';
  const message = (id, text, from = mobile) => ({
    id: 'wamid.' + id,
    type: 'text',
    from,
    timestamp: String(Math.floor(now / 1000)),
    text: { body: text },
  });
  const post = async (messages, valid = true) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: provider.phoneNumberId },
                messages,
              },
            },
          ],
        },
      ],
    });
    const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(uri, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': valid ? signature : 'invalid',
      },
    });
    await response.text();
    return response.status;
  };
  const book = message('request', 'BOOK');
  assert.equal(await post([book]), 200);
  ready = true;
  assert.equal(await post([book], false), 200);
  assert.equal(await post([message('outsider', 'BOOK', '27820000002')]), 200);
  assert.equal(requests.length, 0);
  assert.equal(await post([book, message('outsider', 'BOOK', '27820000002')]), 200);
  assert.equal(await post([book]), 200);
  assert.equal(requests.length, 1);
  const link = new URL(requests[0].text.body.match(/https:\/\/[^\s]+$/)[0]);
  const returnLink = await pilot.bookingBrowser.bookingChat.resumeLink(
    link.searchParams.get('request'),
    { crmV2ClientId: 4 },
  );
  const chatText = new URL(returnLink).searchParams.get('text');
  const resume = message('resume', chatText);
  assert.equal(await post([resume]), 200);
  assert.equal(await post([resume]), 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].interactive.type, 'list');
  assert.equal(requests[1].interactive.action.sections[0].rows[0].title, 'Fictional treatment');
  assert.equal(requests[1].to, mobile);
  assert.equal(await post([message('overcap', 'Hi')]), 503);
  assert.equal(requests.length, 2);
  const row = (
    await db.query('SELECT recipient_hash,reserved_attempts FROM whatsapp_booking_pilot_admission')
  ).rows[0];
  assert.equal(row.reserved_attempts, 2);
  assert.notEqual(row.recipient_hash, mobile);
});
