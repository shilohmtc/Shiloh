'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createWhatsAppBookingSender } = require('../src/services/whatsAppBookingSender');
const {
  WELCOME_TEXT,
  GREETING_TEXT,
  RECEPTION_TEXT,
} = require('../src/services/whatsAppBookingEntry');
const { PENDING_REPLY } = require('../src/services/whatsAppBookingRequestReceipt');
const { issueBookingAction } = require('../src/services/whatsAppBookingActions');

test('booking-only sender respects admission and prevents duplicate provider attempts across instances', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    readFileSync(path.join(__dirname, '../migrations/203_whatsapp_booking_deliveries.sql'), 'utf8'),
  );
  const now = Date.UTC(2026, 10, 26);
  const expiry = new Date(now + 60_000).toISOString();
  const mobile = '27820000001';
  let allowed = true;
  let providerSucceeds = true;
  const requests = [];
  const options = {
    enabled: true,
    db,
    clock: () => now,
    provider: { phoneNumberId: '12345', apiVersion: 'v26.0', accessToken: 'fictional' },
    fingerprintKey: Buffer.alloc(32, 17),
    authorizeDelivery: async () => ({ allowed, serviceWindowEndsAt: expiry }),
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
      if (!providerSucceeds) throw Error('Synthetic network error');
      return Response.json({ messages: [{ id: 'wamid.synthetic' + requests.length }] });
    },
  };
  const first = createWhatsAppBookingSender(options);
  const recipient = mobile;
  const welcome = {
    recipient,
    text: WELCOME_TEXT,
    expiresAt: expiry,
    deduplicationKey: 'booking-entry:' + 'a'.repeat(64),
  };
  await assert.rejects(
    createWhatsAppBookingSender({ ...options, enabled: false }).deliverBookingLink(welcome),
    /disabled/,
  );
  allowed = false;
  await assert.rejects(first.deliverBookingLink(welcome), /window or budget/);
  allowed = true;
  await assert.rejects(
    first.deliverBookingLink({ ...welcome, expiresAt: new Date(now).toISOString() }),
    /window or budget/,
  );
  await assert.rejects(first.deliverBookingLink({ ...welcome, text: 'unrelated' }), /Invalid/);
  assert.equal(requests.length, 0);
  const results = await Promise.allSettled([
    first.deliverBookingLink(welcome),
    createWhatsAppBookingSender(options).deliverBookingLink(welcome),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.equal(requests.length, 1);
  assert.deepEqual(await createWhatsAppBookingSender(options).deliverBookingLink(welcome), {
    state: 'accepted',
    replayed: true,
  });
  await assert.rejects(
    first.deliverBookingLink({ ...welcome, recipient: '27820000002' }),
    /needs review/,
  );

  const action = issueBookingAction(
    {
      acceptanceId: '31',
      verifiedClientId: '4',
      senderMobile: recipient,
      reviewHash: 'b'.repeat(43),
    },
    { secret: 'fictional action key', now },
  );
  const button = { recipient, action, deduplicationKey: 'booking-request-button:31' };
  await first.deliverRequestButton(button);
  assert.equal(requests[1].body.interactive.action.buttons[0].reply.title, 'Request appointment');
  assert.equal(requests[1].body.interactive.action.buttons[0].reply.id, action);
  assert.ok(
    requests.every(
      (request) =>
        request.url === 'https://graph.facebook.com/v26.0/12345/messages' &&
        request.redirect === 'error',
    ),
  );

  const pending = { recipient, text: PENDING_REPLY, deduplicationKey: 'booking-pending:55' };
  providerSucceeds = false;
  await assert.rejects(first.deliverAcknowledgement(pending), /needs review/);
  providerSucceeds = true;
  await assert.rejects(
    createWhatsAppBookingSender(options).deliverAcknowledgement(pending),
    /needs review/,
  );
  assert.equal(requests.length, 3);
  assert.doesNotMatch(requests[2].body.text.body, /deposit|payment|https?:\/\//i);
  const evidence = await db.query(
    'SELECT * FROM whatsapp_booking_deliveries ORDER BY delivery_key',
  );
  assert.deepEqual(
    evidence.rows.map((row) => row.state),
    ['accepted', 'uncertain', 'accepted'],
  );
  const persisted = JSON.stringify(evidence.rows);
  for (const value of [mobile, action, WELCOME_TEXT, PENDING_REPLY])
    assert.ok(!persisted.includes(value));
  const greeting = {
    recipient,
    text: GREETING_TEXT,
    expiresAt: expiry,
    deduplicationKey: 'booking-entry:' + 'c'.repeat(64),
  };
  await first.deliverGreeting(greeting);
  await createWhatsAppBookingSender(options).deliverGreeting(greeting);
  assert.deepEqual(
    requests[3].body.interactive.action.buttons.map((item) => item.reply),
    [
      { id: 'shiloh_booking_start', title: 'Book an appointment' },
      { id: 'shiloh_talk_to_reception', title: 'Talk to Reception' },
    ],
  );
  await first.deliverReceptionPrompt({
    ...greeting,
    text: RECEPTION_TEXT,
    deduplicationKey: 'booking-entry:' + 'd'.repeat(64),
  });
  assert.equal(requests[4].body.text.body, RECEPTION_TEXT);
  assert.equal(requests.length, 5);
});
