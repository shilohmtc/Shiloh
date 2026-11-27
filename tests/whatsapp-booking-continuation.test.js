'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createWhatsAppBookingContinuation,
} = require('../src/services/whatsAppBookingContinuation');
const { quoteWhatsAppBooking } = require('../src/services/whatsAppBookingQuote');

const selection = {
  senderMobile: '27820000001',
  serviceId: 2,
  staffId: 7,
  startsAt: '2030-11-13T22:30:00.000Z',
};
const initialTime = Date.parse('2030-11-13T14:30:00Z');
const policy = {
  enabled: true,
  rateBasisPoints: 5000,
  policyVersion: 'fixture',
  effectiveFrom: '2026-01-01T00:00:00Z',
};

function fixture() {
  let time = initialTime;
  let owner = true;
  let available = true;
  let total = '550.05';
  let slotReads = 0;
  const continuation = createWhatsAppBookingContinuation({
    key: Buffer.alloc(32, 1),
    clock: () => time,
    db: {
      async query(_sql, args) {
        return {
          rows: owner && args[0] === 5 && args[1] === selection.senderMobile ? [{ id: 5 }] : [],
        };
      },
    },
    service: {
      async slots({ serviceId, staffId, date }) {
        slotReads++;
        assert.deepEqual([serviceId, staffId, date], [2, 7, '2030-11-14']);
        return {
          slots: available ? [{ startsAt: selection.startsAt }] : [],
          service: { id: 2 },
          practitioner: { id: 7 },
        };
      },
      async review({ crmV2ClientId, startsAt }) {
        assert.equal(crmV2ClientId, 5);
        assert.equal(startsAt, selection.startsAt);
        return { total, quoteHash: 'offer-review' };
      },
      async policy() {
        return policy;
      },
    },
  });
  return {
    continuation,
    expire: () => {
      time += 45 * 60 * 1000;
    },
    block: () => {
      owner = false;
    },
    removeSlot: () => {
      available = false;
    },
    setTotal: (value) => {
      total = value;
    },
    slotReads: () => slotReads,
  };
}

test('registration resumes the original slot and recalculates the reviewed price and deposit', async () => {
  const f = fixture();
  const token = f.continuation.issue(selection);
  assert.doesNotMatch(
    Buffer.from(token, 'base64url').toString('latin1'),
    new RegExp(selection.senderMobile),
  );
  assert.equal(await f.continuation.resume(token, null), null);
  assert.equal(f.slotReads(), 0);
  const review = await f.continuation.resume(token, { crmV2ClientId: 5 });
  assert.deepEqual(
    [review.status, review.price, review.deposit, review.startsAt],
    ['review', '550.05', '275.03', selection.startsAt],
  );
  f.setTotal('600.00');
  const refreshed = await f.continuation.resume(token, { crmV2ClientId: 5 });
  assert.notEqual(refreshed.reviewHash, review.reviewHash);
  assert.equal(refreshed.deposit, '300.00');
});

test('expired or altered links and ownership changes never fetch the slot', async () => {
  const f = fixture();
  const token = f.continuation.issue(selection);
  const tampered = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
  assert.equal(await f.continuation.resume(token, { crmV2ClientId: 4 }), null);
  assert.equal(await f.continuation.resume(tampered, { crmV2ClientId: 5 }), null);
  f.block();
  assert.equal(await f.continuation.resume(token, { crmV2ClientId: 5 }), null);
  f.expire();
  assert.equal(await f.continuation.resume(token, { crmV2ClientId: 5 }), null);
  assert.equal(f.slotReads(), 0);
});

test('a taken slot requires a new selection', async () => {
  const f = fixture();
  const token = f.continuation.issue(selection);
  f.removeSlot();
  assert.deepEqual(await f.continuation.resume(token, { crmV2ClientId: 5 }), {
    status: 'slot_unavailable',
  });
});

test('the submitted review binds the quoted price, deposit, pricing authority and slot', () => {
  const input = {
    ...selection,
    total: '600.00',
    policy,
    now: new Date(initialTime),
    pricingHash: 'original',
  };
  const original = quoteWhatsAppBooking(input);
  assert.equal(original.deposit, '300.00');
  for (const changed of [
    { total: '599.99' },
    { staffId: 8 },
    { pricingHash: 'changed' },
    { policy: { ...policy, rateBasisPoints: 3000 } },
    { policy: { ...policy, policyVersion: 'next' } },
  ]) {
    assert.notEqual(quoteWhatsAppBooking({ ...input, ...changed }).reviewHash, original.reviewHash);
  }
  assert.equal(
    quoteWhatsAppBooking({ ...input, policy: { ...policy, exemptStaffId: 7 } }).deposit,
    '0.00',
  );
  assert.equal(
    quoteWhatsAppBooking({ ...input, policy: { ...policy, enabled: false } }).deposit,
    '0.00',
  );
  assert.equal(quoteWhatsAppBooking({ ...input, total: null }), null);
});
