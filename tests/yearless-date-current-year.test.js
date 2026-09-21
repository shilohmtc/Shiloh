const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDate, displayDate } = require('../src/services/bookingIntent');
const { closePool } = require('../src/db/pool');

test.after(async () => {
  await closePool();
});

test('yearless written dates stay in the current clinic calendar year', () => {
  const now = new Date('2026-08-16T18:00:00.000Z');
  assert.equal(extractDate('15 Aug', now), '2026-08-15');
  assert.equal(extractDate('August 15', now), '2026-08-15');
  assert.match(displayDate(extractDate('15 Aug', now)), /15 August 2026/);
});

test('an explicit future year remains explicit', () => {
  const now = new Date('2026-08-16T18:00:00.000Z');
  assert.equal(extractDate('15 Aug 2027', now), '2027-08-15');
});

test('yearless written dates now match yearless numeric date semantics', () => {
  const now = new Date('2026-08-16T18:00:00.000Z');
  assert.equal(extractDate('15 Aug', now), extractDate('15/08', now));
});

test('availability-aware WhatsApp date button payloads preserve their exact ISO date', () => {
  const now = new Date('2026-09-21T07:30:00.000Z');
  assert.equal(extractDate('2026-09-23', now), '2026-09-23');
  assert.equal(extractDate('on 2026-09-23', now), '2026-09-23');
  assert.equal(extractDate('2026-02-30', now), null);
});
