'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const {
  issueBookingAction,
  verifiedBookingTaps,
} = require('../src/services/whatsAppBookingActions');
const { createWhatsAppBookingIntake } = require('../src/services/whatsAppBookingIntake');

const action = {
  acceptanceId: '31',
  verifiedClientId: '4',
  senderMobile: '27820000001',
  reviewHash: 'a'.repeat(43),
};
const settings = {
  providerSecret: 'synthetic-provider-key',
  actionSecret: 'synthetic-action-key',
  phoneNumberId: 'clinic-test',
  now: Date.UTC(2026, 10, 26),
};
const actionId = issueBookingAction(action, { secret: settings.actionSecret, now: settings.now });

function payload({
  id = actionId,
  sender = action.senderMobile,
  phoneNumberId = settings.phoneNumberId,
  copies = 1,
  type = 'interactive',
} = {}) {
  const message = {
    type,
    from: sender,
    interactive: { type: 'button_reply', button_reply: { id } },
  };
  const entry = {
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: phoneNumberId },
          messages: Array(copies).fill(message),
        },
      },
    ],
  };
  return Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [entry] }));
}
const sign = (raw) =>
  'sha256=' + createHmac('sha256', settings.providerSecret).update(raw).digest('hex');
const taps = (raw, overrides = {}) =>
  verifiedBookingTaps(raw, sign(raw), { ...settings, ...overrides });

test('provider-signed taps accept the correct number and coalesce copies of the same action in one delivery', () => {
  assert.deepEqual(taps(payload({ copies: 3 })), [action]);
  assert.deepEqual(taps(payload({ phoneNumberId: 'different' })), []);
  assert.deepEqual(taps(payload({ type: 'text' })), []);
  assert.deepEqual(taps(Buffer.from('{')), []);
});

test('unsigned, modified, forwarded and expired actions are ignored', () => {
  const raw = payload();
  assert.deepEqual(verifiedBookingTaps(raw, null, settings), []);
  assert.deepEqual(
    verifiedBookingTaps(Buffer.concat([raw, Buffer.from(' ')]), sign(raw), settings),
    [],
  );
  assert.deepEqual(
    taps(payload({ id: actionId.slice(0, -1) + (actionId.endsWith('A') ? 'B' : 'A') })),
    [],
  );
  assert.deepEqual(taps(payload({ sender: '27820000002' })), []);
  assert.deepEqual(taps(raw, { now: settings.now + 15 * 60 * 1000 }), []);
});

test('intake uses the exact accepted request and replays a receipt without writing a second booking', async () => {
  let calls = 0;
  let receipt;
  const receive = createWhatsAppBookingIntake({
    db: {},
    readReceipt: async (_db, exact) => {
      assert.deepEqual(exact, action);
      return receipt;
    },
    commitBooking: async (mobile, options) => {
      calls++;
      assert.equal(mobile, action.senderMobile);
      assert.deepEqual(options, {
        crmV2ClientId: '4',
        whatsappAcceptanceId: '31',
        whatsappReviewHash: action.reviewHash,
        enableMorningOffer: true,
      });
      receipt = {
        status: 'pending_resolution',
        appointmentId: '53',
        reply: 'Your request is with Reception. We’ll message you when it’s reviewed.',
      };
      return receipt;
    },
  });
  const raw = payload();
  assert.deepEqual(await receive(raw, null, settings), []);
  const first = await receive(raw, sign(raw), settings);
  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'pending_resolution');
  assert.doesNotMatch(first[0].reply, /https?:\/\/|deposit|confirmed/i);
  assert.deepEqual(await receive(raw, sign(raw), settings), first);
  assert.equal(calls, 1);
});

test('intake recovers a concurrent commit and withholds acknowledgement without a pending receipt', async () => {
  let receipt;
  let otherExecutorCommitted = false;
  const receive = createWhatsAppBookingIntake({
    db: {},
    readReceipt: async () => receipt,
    commitBooking: async () => {
      if (otherExecutorCommitted)
        receipt = { status: 'pending_resolution', appointmentId: '53', reply: 'Awaiting approval' };
      return { status: 'already_consumed' };
    },
  });
  const raw = payload();
  assert.deepEqual(await receive(raw, sign(raw), settings), []);
  otherExecutorCommitted = true;
  assert.equal((await receive(raw, sign(raw), settings))[0].appointmentId, '53');
});
