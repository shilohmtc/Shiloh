const test = require('node:test');
const assert = require('node:assert/strict');
const { recordedVisitTrend } = require('../src/domain/recordedVisitTrend');

test('only explicit completed and no-charge records count, not bookings or missed visits', () => {
  assert.deepEqual(recordedVisitTrend({ completed: 7, no_charge: 2, scheduled: 99, confirmed: 14, cancelled: 8, no_show: 5 }, { completed: 4, no_charge: 2 }),
    { available: true, currentCount: 9, previousCount: 6, delta: 3, percent: 50 });
});
test('zero comparison does not invent a 100 percent rise; a real decline remains visible', () => {
  assert.equal(recordedVisitTrend({ completed: 3 }, {}).percent, null);
  assert.deepEqual(recordedVisitTrend({}, { completed: 4 }), { available: true, currentCount: 0, previousCount: 4, delta: -4, percent: -100 });
});
test('missing or invalid source counts remain unavailable rather than zero', () => {
  for (const invalid of [undefined, null, [], { completed: -1 }, { no_charge: NaN }, { completed: 0.5 }, { completed: '2' }, { completed: Number.MAX_SAFE_INTEGER, no_charge: 1 }]) {
    assert.deepEqual(recordedVisitTrend(invalid, {}), { available: false });
    assert.deepEqual(recordedVisitTrend({}, invalid), { available: false });
  }
});
