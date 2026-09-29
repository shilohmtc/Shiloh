const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatTime24, formatTimeRange24 } = require('../src/presentation/timePresentation');

test('canonical booking formatter uses 24-hour Johannesburg time', () => {
  assert.equal(formatTime24('2026-08-21T12:30:00.000Z'), '14:30');
  assert.equal(formatTimeRange24('2026-08-21T12:30:00.000Z', '2026-08-21T13:20:00.000Z'), '14:30–15:20');
  assert.equal(formatTime24('2026-08-21T06:30:00.000Z'), '08:30');
});

test('core Shiloh booking surfaces explicitly prohibit 12-hour Intl presentation', () => {
  const files = [
    'src/services/appointmentChange.js',
    'src/services/appointmentReminderConfirmation.js',
    'src/services/clientBookingApproval.js',
    'src/services/clientBookingAvailability.js',
    'src/services/customerBookingConfirmation.js',
  ];

  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.doesNotMatch(source, /hour12\s*:\s*true/i, `${relativePath} must not use 12-hour Intl formatting`);
  }
});
