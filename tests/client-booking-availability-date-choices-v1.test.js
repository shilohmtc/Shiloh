const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const availabilityPath = path.join(__dirname, '..', 'src', 'services', 'clientBookingAvailability.js');

const availabilitySource = fs.readFileSync(availabilityPath, 'utf8');

test('production wiring uses canonical future-slot authority and preserves explicit/free-text date routing', () => {
  assert.match(availabilitySource, /if \(!isFutureSlot\(enriched, now\)\) continue/);
  assert.match(availabilitySource, /const date = explicitBookingDate\(value\)\|\|extractDate\(value\)/);
  assert.match(availabilitySource, /async function revalidateSelectedSlot/);
  assert.match(availabilitySource, /const result = await listAvailableSlots\(/);
});
