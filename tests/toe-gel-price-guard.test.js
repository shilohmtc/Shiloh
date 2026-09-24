'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const adminBooking = fs.readFileSync(path.join(ROOT, 'src/services/adminBooking.js'), 'utf8');
const directBooking = fs.readFileSync(path.join(ROOT, 'src/services/calendarDirectBookingConfirmation.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'migrations/153_toe_gel_price_and_bookability.sql'), 'utf8');

test('bookable services require a confirmed fixed price before booking preparation', () => {
  assert.match(adminBooking, /function usableFixedBookingPrice/);
  assert.match(adminBooking, /status: "pricing_unavailable"/);
  assert.match(adminBooking, /No appointment was created/);
  assert.match(directBooking, /session\.variable_price === true/);
  assert.match(directBooking, /status: 'pricing_unavailable'/);
});

test('Toe Gel Only is repaired as the owner-approved R250 active service', () => {
  assert.match(migration, /LOWER\(TRIM\(name\)\) = 'toe gel only'/);
  assert.match(migration, /status = 'active'/);
  assert.match(migration, /price = 250/);
  assert.match(migration, /variable_price = FALSE/);
  assert.match(migration, /mapping_count = 0/);
});
