'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWhatsAppBookingChoices } = require('../src/services/whatsAppBookingChoices');

const senderMobile = '27820000001';
const session = { crmV2ClientId: 55 };
const now = Date.parse('2030-12-01T22:15:00.000Z');
const slot = '2030-12-02T08:15:00.000Z';

function fixture() {
  let reads = 0;
  let owner = true;
  let available = true;
  let reviewState = 'review';
  const choose = createWhatsAppBookingChoices({
    db: {},
    clock: () => now,
    authorizeOwner: async (_db, mobile, id) => owner && mobile === senderMobile && id === 55,
    service: {
      async catalogue() {
        reads++;
        return Array.from({ length: 12 }, (_item, index) => ({
          id: String(index + 1),
          name: 'Treatment ' + (index + 1),
        }));
      },
      async practitioners(input) {
        assert.deepEqual(input, { serviceId: 1, crmV2ClientId: 55 });
        return { practitioners: [{ id: 7, name: 'Fictional practitioner' }] };
      },
      async slots(input) {
        assert.deepEqual(input, {
          serviceId: 1,
          crmV2ClientId: 55,
          staffId: 7,
          date: '2030-12-02',
        });
        return {
          slots: [
            { startsAt: '2030-12-01T22:00:00.000Z', time: '00:00' },
            ...(available ? [{ startsAt: slot, time: '10:15' }] : []),
          ],
        };
      },
    },
    continuation: {
      issue(selection) {
        assert.deepEqual(selection, { senderMobile, serviceId: 1, staffId: 7, startsAt: slot });
        return 'private-fixture';
      },
      async resume(token, verifiedSession) {
        assert.equal(token, 'private-fixture');
        assert.equal(verifiedSession, session);
        if (reviewState !== 'review') return { status: reviewState };
        return {
          status: 'review',
          reviewHash: 'review-fixture',
          startsAt: slot,
          price: '650.00',
          deposit: '325.00',
        };
      },
    },
  });
  return {
    choose,
    select: (input = {}) => choose({ senderMobile, session, ...input }),
    reads: () => reads,
    takeSlot: () => {
      available = false;
    },
    changeOwner: () => {
      owner = false;
    },
    staleQuote: () => {
      reviewState = 'slot_unavailable';
    },
  };
}

test('verified client can choose a current treatment, practitioner and clinic-local date then review the exact slot', async () => {
  const { select } = fixture();
  const services = await select();
  assert.equal(services.choices.length, 9);
  assert.equal(services.nextPage, 1);
  assert.deepEqual(
    (await select({ page: 1 })).choices.map((row) => row.id),
    [10, 11, 12],
  );
  assert.deepEqual((await select({ serviceId: 1 })).choices, [
    { id: 7, title: 'Fictional practitioner' },
  ]);
  const date = (await select({ serviceId: 1, staffId: 7 })).choices[0].id;
  assert.equal(date, '2030-12-02');
  const criteria = { serviceId: 1, staffId: 7, date };
  const times = await select(criteria);
  assert.deepEqual(times.choices, [{ id: slot, title: '10:15' }]);
  const review = await select({ ...criteria, startsAt: slot });
  assert.deepEqual(review, {
    status: 'review',
    reviewHash: 'review-fixture',
    startsAt: slot,
    price: '650.00',
    deposit: '325.00',
    continuationToken: 'private-fixture',
  });
});

test('missing proof, a mismatched mobile or an ownership change cannot read booking choices', async () => {
  const f = fixture();
  for (const input of [
    { session: null },
    { senderMobile: '27820000002' },
    { session: { crmV2ClientId: 99 } },
  ]) {
    assert.deepEqual(await f.select(input), { status: 'verification_required' });
  }
  f.changeOwner();
  assert.deepEqual(
    await f.select({ serviceId: 1, staffId: 7, date: '2030-12-02', startsAt: slot }),
    { status: 'verification_required' },
  );
  assert.equal(f.reads(), 0);
});

test('forged choices and a slot taken after the menu was shown cannot continue', async () => {
  const f = fixture();
  const criteria = { serviceId: 1, staffId: 7, date: '2030-12-02' };
  for (const input of [
    { serviceId: 99 },
    { serviceId: 1, staffId: 8 },
    { ...criteria, date: '2030-12-01' },
    { page: -1 },
  ]) {
    assert.deepEqual(await f.select(input), { status: 'unavailable' });
  }
  await f.select(criteria);
  f.staleQuote();
  assert.deepEqual(await f.select({ ...criteria, startsAt: slot }), { status: 'slot_unavailable' });
  f.takeSlot();
  assert.deepEqual(await f.select({ ...criteria, startsAt: slot }), { status: 'slot_unavailable' });
});
