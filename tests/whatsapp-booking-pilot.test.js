'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { PENDING_REPLY } = require('../src/services/whatsAppBookingRequestReceipt');
const { createWhatsAppBookingIntake } = require('../src/services/whatsAppBookingIntake');
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

test('staff-only native pilot delivers its draft Flow and completed registration opens a signed menu', async (t) => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const file of [
    '203_whatsapp_booking_deliveries.sql',
    '204_whatsapp_booking_registration_grants.sql',
  ]) {
    await pg.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
  }
  await pg.exec(
    'CREATE TABLE crm_v2_clients (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, normalized_mobile TEXT UNIQUE,' +
      ' date_of_birth DATE, gender TEXT, profile_status TEXT, mobile_verified_at TIMESTAMPTZ, source TEXT,' +
      ' status TEXT, provenance JSONB, first_name TEXT, surname TEXT, created_at TIMESTAMPTZ DEFAULT now(),' +
      ' updated_at TIMESTAMPTZ DEFAULT now()); CREATE TABLE client_contacts (normalized_value TEXT, contact_type TEXT);',
  );
  await pg.exec(`
    CREATE TABLE booking_intents(phone varchar(32) primary key, service_text text, therapist_text text,
      preferred_date text, preferred_time text, service_verified boolean, status text, policy_version text,
      policy_accepted_at timestamptz, policy_channel text);
    CREATE TABLE booking_policy_acceptances(id bigint generated always as identity primary key, phone varchar(32),
      crm_v2_client_id bigint, service_text text, therapist_text text, preferred_date text, preferred_time text,
      policy_version text, accepted_at timestamptz, policy_text_snapshot text, channel text, appointment_id bigint);
  `);
  const db = {
    query: pg.query.bind(pg),
    async connect() {
      return { query: pg.query.bind(pg), release() {} };
    },
  };
  const now = Math.floor(Date.now() / 1000) * 1000;
  const mobile = '27820000001';
  const other = '27820000002';
  const secret = 'fictional provider';
  const provider = { phoneNumberId: '12345', apiVersion: 'v26.0', accessToken: 'fictional' };
  const requests = [];
  const startsAt = new Date(now + 24 * 3600_000).toISOString();
  const treatment = { id: 1, name: 'Fictional treatment' };
  const practitioner = { id: 7, name: 'Fictional practitioner' };
  let receipt;
  let requestsMade = 0;
  const pilot = createWhatsAppBookingPilot({
    enabled: true,
    nativeReviewEnabled: true,
    registrationFlowId: '123',
    db,
    provider,
    providerSecret: secret,
    recipient: mobile,
    maximumAttempts: 12,
    key: Buffer.alloc(32, 3),
    clock: () => now,
    bookingService: {
      async catalogue() {
        return [treatment];
      },
      async practitioners() {
        return { practitioners: [practitioner] };
      },
      async slots() {
        return { service: treatment, practitioner, slots: [{ startsAt, time: '10:00' }] };
      },
      async review() {
        return { total: '650.00', quoteHash: 'fictional-price' };
      },
      async policy() {
        return {
          enabled: true,
          rateBasisPoints: 5000,
          policyVersion: 'fixture',
          effectiveFrom: '2026-01-01T00:00:00Z',
        };
      },
    },
    receiveBooking: createWhatsAppBookingIntake({
      db,
      readReceipt: async () => receipt,
      async commitBooking(recipient, authority) {
        assert.equal(recipient, mobile);
        assert.equal(authority.whatsappAcceptanceId, '1');
        requestsMade++;
        receipt = { appointmentId: '71', status: 'pending_resolution', reply: PENDING_REPLY };
        return receipt;
      },
    }),
    async fetchImpl(_url, request) {
      requests.push(JSON.parse(request.body));
      return Response.json({ messages: [{ id: 'wamid.fake' + requests.length }] });
    },
  });
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
  const post = async (event, from = mobile, key = secret) => {
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
                messages: [{ from, timestamp: String(now / 1000), ...event }],
              },
            },
          ],
        },
      ],
    });
    const res = await fetch(uri, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=' + createHmac('sha256', key).update(body).digest('hex'),
      },
    });
    await res.text();
    assert.equal(res.status, 200);
  };
  await post({ id: 'wamid.hello', type: 'text', text: { body: 'Hi' } });
  const bookButton = requests[0].interactive.action.buttons[0].reply.id;
  const book = {
    id: 'wamid.book',
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: bookButton } },
  };
  await post(book);
  await post(book);
  assert.equal(requests.length, 2);
  const flow = requests[1].interactive;
  assert.equal(flow.type, 'flow');
  assert.equal(flow.action.parameters.mode, 'draft');
  const token = flow.action.parameters.flow_token;
  const complete = {
    id: 'wamid.complete',
    type: 'interactive',
    interactive: {
      type: 'nfm_reply',
      nfm_reply: {
        response_json: JSON.stringify({
          flow_token: token,
          first_name: 'Fictional',
          surname: 'Client',
          date_of_birth: '1990-01-01',
          gender: 'prefer_not_to_say',
        }),
      },
    },
  };
  await post(complete, other);
  await post(complete, mobile, 'wrong secret');
  assert.equal(requests.length, 2);
  await post(complete);
  await post(complete);
  await post({ ...complete, id: 'wamid.tokenReplay' });
  await post(book);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].interactive.body.text, 'Choose a treatment');
  const row = requests[2].interactive.action.sections[0].rows[0];
  assert.equal(row.title, 'Fictional treatment');
  await post({
    id: 'wamid.pick',
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: row.id } },
  });
  assert.equal(requests[3].interactive.body.text, 'Choose a practitioner');
  await post({ ...book, id: 'wamid.returning' });
  assert.equal(requests[4].interactive.body.text, 'Choose a treatment');
  let menu = requests[4];
  for (const [index, expected] of [
    'Choose a practitioner',
    'Choose a date',
    'Choose a time',
    null,
  ].entries()) {
    const selections = menu.interactive.action.sections[0].rows;
    const id = selections[index === 2 ? 1 : 0].id;
    await post({
      id: 'wamid.nativeChoice' + index,
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id } },
    });
    menu = requests.at(-1);
    if (expected) assert.equal(menu.interactive.body.text, expected);
  }
  assert.equal(requests.at(-2).type, 'text');
  assert.match(requests.at(-2).text.body, /Booking Policy & Terms/);
  assert.match(menu.interactive.body.text, /Price: R650\.00/);
  const accepted = menu.interactive.action.buttons[0].reply;
  assert.equal(accepted.title, 'Accept terms');
  assert.equal(requestsMade, 0);
  const tap = (name, id) =>
    post({
      id: 'wamid.' + name,
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id } },
    });
  await tap('terms', accepted.id);
  await tap('terms', accepted.id);
  assert.equal(requestsMade, 0);
  const request = requests.at(-1).interactive.action.buttons[0].reply;
  assert.equal(request.title, 'Request appointment');
  await tap('request', request.id);
  await tap('request', request.id);
  assert.equal(requestsMade, 1);
  assert.equal(requests.at(-1).text.body, PENDING_REPLY);
  assert.equal(requests.filter((item) => item.text?.body === PENDING_REPLY).length, 1);
  const acceptances = await pg.query(
    'SELECT channel,policy_text_snapshot FROM booking_policy_acceptances',
  );
  assert.equal(acceptances.rows.length, 1);
  assert.equal(acceptances.rows[0].channel, 'whatsapp');
  assert.match(acceptances.rows[0].policy_text_snapshot, /Booking Policy & Terms/);
  const { rows } = await pg.query('SELECT first_name,surname FROM crm_v2_clients');
  assert.deepEqual(rows, [{ first_name: 'Fictional', surname: 'Client' }]);
  const grants = await pg.query('SELECT * FROM whatsapp_booking_registration_grants');
  assert.ok(!JSON.stringify(grants.rows).includes(token));
  assert.ok(!JSON.stringify(grants.rows).includes(mobile));
  assert.equal(grants.rows.length, 1);
  assert.ok(requests.every(({ to }) => to === mobile));
  assert.doesNotMatch(JSON.stringify(requests), /https?:\/\//);
});
