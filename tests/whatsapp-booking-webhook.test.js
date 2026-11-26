'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const express = require('express');
const { createWebhookRouter } = require('../src/routes/webhook');
const { issueBookingAction } = require('../src/services/whatsAppBookingActions');
const { createWhatsAppBookingIntake } = require('../src/services/whatsAppBookingIntake');

const booking = {
  providerSecret: 'fictional provider secret',
  actionSecret: 'fictional client action secret',
  phoneNumberId: 'synthetic-number',
  now: Date.UTC(2026, 10, 26),
};
const senderMobile = '27820000001';
const buttonId = issueBookingAction(
  { acceptanceId: '31', verifiedClientId: '4', senderMobile, reviewHash: 'a'.repeat(43) },
  { secret: booking.actionSecret, now: booking.now },
);
const confirmation = 'Your request is with Reception. We’ll message you when it’s reviewed.';
const tap = {
  id: 'wamid.synthetic',
  type: 'interactive',
  from: senderMobile,
  interactive: { type: 'button_reply', button_reply: { id: buttonId } },
};

function callback(messages, statuses, phoneNumberId = booking.phoneNumberId) {
  return {
    field: 'messages',
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: phoneNumberId },
      messages,
      statuses,
    },
  };
}
function payload(...changes) {
  // The formatting must survive the HTTP JSON parser for signature validation.
  return JSON.stringify(
    {
      object: 'whatsapp_business_account',
      entry: changes.map((change) => ({ changes: [change] })),
    },
    null,
    2,
  );
}
const signature = (body) =>
  'sha256=' + createHmac('sha256', booking.providerSecret).update(body).digest('hex');

async function setup(t, options) {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {} };
    next();
  });
  app.use(createWebhookRouter(options));
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (body, signed = signature(body)) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/webhook', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signed },
    });
    await response.text();
    return response.status;
  };
}

test('disabled intake preserves delivery-status processing and acknowledges conversation callbacks', async (t) => {
  const seen = [];
  const post = await setup(t, {
    persistStatuses: async (records) => {
      seen.push(...records);
    },
  });
  assert.equal(
    await post(payload(callback(undefined, [{ id: 'wamid.status', status: 'delivered' }]))),
    200,
  );
  assert.equal(await post(payload(callback([tap]))), 200);
  assert.deepEqual(
    seen.map((x) => x.metaMessageId),
    ['wamid.status'],
  );
});

test('signed tap and delivery receipts share the callback while retry uses the same pending request', async (t) => {
  let writes = 0;
  let saved;
  let deliveryAttempts = 0;
  const acknowledgements = new Map();
  const statuses = [];
  const receiveBooking = createWhatsAppBookingIntake({
    db: {},
    readReceipt: async () => saved,
    commitBooking: async (_mobile, exact) => {
      assert.equal(exact.whatsappAcceptanceId, '31');
      writes++;
      saved = { appointmentId: '77', status: 'pending_resolution', reply: confirmation };
      return saved;
    },
  });
  const post = await setup(t, {
    booking,
    receiveBooking,
    persistStatuses: async (records) => {
      statuses.push(...records);
    },
    deliverAcknowledgement: async (item) => {
      deliveryAttempts++;
      if (deliveryAttempts === 1) throw new Error('Synthetic sender outage');
      acknowledgements.set(item.deduplicationKey, item);
    },
  });
  const body = payload(
    callback(undefined, [{ id: 'wamid.receipt', status: 'delivered' }]),
    callback([tap, tap]),
    callback(undefined, [{ id: 'wamid.second', status: 'read' }]),
  );
  assert.equal(await post(body), 503);
  assert.equal(await post(body), 200);
  assert.equal(await post(body), 200);
  assert.equal(writes, 1);
  assert.deepEqual(
    statuses.slice(0, 2).map((x) => x.metaMessageId),
    ['wamid.receipt', 'wamid.second'],
  );
  assert.equal(acknowledgements.size, 1);
  const ack = acknowledgements.get('booking-pending:77');
  assert.equal(ack.recipient, senderMobile);
  assert.equal(ack.text, confirmation);
  assert.doesNotMatch(ack.text, /https?:\/\/|deposit|confirmed/i);
});

test('bad signature, unrelated number and ordinary chat cannot enter the booking writer', async (t) => {
  let writes = 0;
  let sends = 0;
  const post = await setup(t, {
    booking,
    receiveBooking: createWhatsAppBookingIntake({
      db: {},
      readReceipt: async () => null,
      commitBooking: async () => {
        writes++;
        return { status: 'stale_whatsapp_action' };
      },
    }),
    deliverAcknowledgement: async () => {
      sends++;
    },
  });
  const body = payload(callback([tap]));
  assert.equal(await post(body, 'sha256=' + 'f'.repeat(64)), 200);
  assert.equal(await post(payload(callback([tap], undefined, 'unrelated-number'))), 200);
  assert.equal(await post(payload(callback([{ ...tap, type: 'text' }]))), 200);
  assert.equal(writes, 0);
  assert.equal(sends, 0);
});

test('enabling intake with no acknowledgement sender fails at construction', () => {
  assert.throws(() => createWebhookRouter({ booking }), /acknowledgement sender/);
});

test('the explicit booking greeting opens the browser sign-in flow without handling unrelated chat', async (t) => {
  const sent = new Map();
  let writes = 0;
  const post = await setup(t, {
    booking,
    receiveBooking: createWhatsAppBookingIntake({
      db: {},
      readReceipt: async () => null,
      commitBooking: async () => {
        writes++;
        return { status: 'stale_whatsapp_action' };
      },
    }),
    deliverAcknowledgement: async () =>
      assert.fail('The greeting cannot acknowledge an appointment'),
    deliverBookingLink: async (reply) => sent.set(reply.deduplicationKey, reply),
  });
  const message = {
    id: 'wamid.welcome-fixture',
    from: senderMobile,
    type: 'text',
    timestamp: String(booking.now / 1000 - 60),
    text: { body: '  Book an appointment  ' },
  };
  const body = payload(callback([message, message]));
  assert.equal(await post(body, 'sha256=' + 'f'.repeat(64)), 200);
  assert.equal(await post(payload(callback([message], undefined, 'other-number'))), 200);
  for (const changed of [
    { text: { body: 'Can I book an appointment next week?' } },
    { text: { body: 'Hello' } },
    { timestamp: String(booking.now / 1000 - 86400) },
    { timestamp: String(booking.now / 1000 + 1) },
    { id: '' },
  ]) {
    assert.equal(await post(payload(callback([{ ...message, ...changed }]))), 200);
  }
  assert.equal(sent.size, 0);
  assert.equal(await post(body), 200);
  assert.equal(await post(body), 200);
  assert.equal(writes, 0);
  assert.equal(sent.size, 1);
  const [welcome] = sent.values();
  assert.equal(welcome.recipient, senderMobile);
  assert.match(
    welcome.text,
    /^Welcome to Shiloh!.*sign in or create your profile.*Then you can choose.*Reception will review/i,
  );
  assert.match(welcome.text, /https:\/\/app\.shilohmtc\.co\.za\/my-shiloh\/book$/);
  assert.equal(welcome.expiresAt, new Date(booking.now + (86400 - 60) * 1000).toISOString());
});
