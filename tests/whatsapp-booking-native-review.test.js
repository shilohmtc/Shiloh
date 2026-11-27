'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const {
  createWhatsAppBookingNativeReview,
  TERMS,
} = require('../src/services/whatsAppBookingNativeReview');
const { createWhatsAppBookingSender } = require('../src/services/whatsAppBookingSender');
const { BOOKING_POLICY_VERSION } = require('../src/config/bookingPolicyAuthority');

const start = Date.UTC(2030, 1, 1);
const mobile = '27820000001';
const other = '27820000002';
const configuration = {
  phoneNumberId: '12345',
  providerSecret: 'fictional-app',
  allowedSender: mobile,
};
const selection = {
  recipient: mobile,
  crmV2ClientId: '42',
  serviceId: 2,
  staffId: 3,
  startsAt: new Date(start + 3600_000).toISOString(),
  reviewHash: 'a'.repeat(43),
  expires: start / 1000 + 2400,
  inboundAt: start / 1000,
};

function signedCallback(
  action,
  from = mobile,
  secret = configuration.providerSecret,
  timestamp = start / 1000,
) {
  const message = {
    id: 'wamid.fictional',
    from,
    timestamp: String(timestamp),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: action } },
  };
  const raw = Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: configuration.phoneNumberId },
                messages: [message, message],
              },
            },
          ],
        },
      ],
    }),
  );
  return [raw, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'), configuration];
}

test('signed acceptance is sender-bound, retry-stable and subject to the current quote', async () => {
  const submits = [];
  const sent = [];
  let clock = start;
  let changed = true;
  const review = createWhatsAppBookingNativeReview({
    key: Buffer.alloc(32, 9),
    clock: () => clock,
    continuation: {
      issue(value) {
        assert.deepEqual(value, {
          senderMobile: mobile,
          serviceId: 2,
          staffId: 3,
          startsAt: selection.startsAt,
        });
        return 'internal';
      },
    },
    async submit(value) {
      submits.push(value);
      if (changed) return { status: 'review_changed' };
      return {
        status: 'ready',
        recipient: mobile,
        action: 'signed-request',
        acceptanceId: '71',
        expiresAt: 'expiry',
      };
    },
  });
  const action = review.issue(selection);
  assert.ok(action.length <= 256);
  clock += 1000;
  assert.equal(review.issue(selection), action);
  const deliver = async (button) => sent.push(button);
  await review.receive(...signedCallback(action, other), deliver);
  await review.receive(...signedCallback(action, mobile, 'wrong'), deliver);
  await review.receive(...signedCallback(action + 'A'), deliver);
  assert.deepEqual(submits, []);
  await review.receive(...signedCallback(action), deliver);
  assert.deepEqual(sent, []);
  changed = false;
  await review.receive(...signedCallback(action), deliver);
  assert.deepEqual(
    submits,
    [1, 2].map(() => ({
      token: 'internal',
      session: { crmV2ClientId: '42' },
      reviewHash: selection.reviewHash,
      policyAccepted: true,
    })),
  );
  assert.deepEqual(sent, [
    {
      recipient: mobile,
      action: 'signed-request',
      expiresAt: 'expiry',
      deduplicationKey: 'booking-request-button:71',
    },
  ]);
  clock = start + 900_000;
  await review.receive(...signedCallback(action, mobile, undefined, clock / 1000), deliver);
  assert.equal(sent.length, 1);
});

test('sends the full versioned terms before the bound acceptance button, with replay-safe delivery', async () => {
  const requests = [];
  const rows = new Map();
  let allowed = true;
  const review = createWhatsAppBookingNativeReview({
    key: Buffer.alloc(32, 9),
    clock: () => start,
  });
  const sender = createWhatsAppBookingSender({
    enabled: true,
    nativeReview: review,
    clock: () => start,
    provider: { phoneNumberId: '12345', accessToken: 'fixture', apiVersion: 'v26.0' },
    fingerprintKey: Buffer.alloc(32, 7),
    authorizeDelivery: async () => ({ allowed, serviceWindowEndsAt: new Date(start + 60_000) }),
    db: {
      async query(sql, [key, value]) {
        if (sql.startsWith('SELECT')) return { rows: rows.has(key) ? [rows.get(key)] : [] };
        if (sql.includes('INSERT')) {
          rows.set(key, { fingerprint: value });
          return { rows: [key] };
        }
        rows.get(key).state = 'accepted';
        return { rows: [] };
      },
    },
    fetchImpl: async (_url, { body }) => {
      requests.push(JSON.parse(body));
      return Response.json({ messages: [{ id: 'wamid.fictional' + requests.length }] });
    },
  });
  const input = {
    type: 'review',
    recipient: mobile,
    inboundId: 'wamid.fixture',
    action: review.issue(selection),
    deduplicationKey: 'booking-menu:' + 'f'.repeat(64),
    text: 'Treatment: Fictional massage',
  };
  allowed = false;
  await assert.rejects(sender.deliverBookingMenu(input), /window or budget/);
  allowed = true;
  assert.equal(requests.length, 0);
  await sender.deliverBookingMenu(input);
  await sender.deliverBookingMenu(input);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].text.body, TERMS);
  assert.ok(TERMS.includes(BOOKING_POLICY_VERSION));
  assert.deepEqual(requests[1].interactive.action.buttons[0].reply, {
    id: input.action,
    title: 'Accept terms',
  });
});
