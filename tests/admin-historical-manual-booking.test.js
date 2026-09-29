const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('historical booking writes Shiloh truth without sending a client notification or touching external snapshots', () => {
  const historical = source('src/services/adminHistoricalBooking.js');
  assert.match(historical, /shiloh_admin_historical_manual/);
  assert.match(historical, /admin\.historical_booking_created/);
  assert.match(historical, /customerMessageSent: false/);
  assert.match(historical, /schedulingAuthority: 'shiloh_canonical'/);
  assert.doesNotMatch(historical, /createBookingEvent|createPractitionerBookingEvent|appointment_calendar_events/);
  assert.doesNotMatch(historical, /sendWhatsAppMessage/);
  assert.match(historical, /remains unresolved\/scheduled/);
});

test('historical manual booking remains guarded by clinic schedule eligibility and CRM conflict checks', () => {
  const historical = source('src/services/adminHistoricalBooking.js');
  assert.match(historical, /staff_services/);
  assert.match(historical, /checkClinicHours/);
  assert.match(historical, /checkAuthoritativeSchedule/);
  assert.match(historical, /getConflicts/);
  assert.match(historical, /pg_advisory_xact_lock/);
  assert.match(historical, /Nothing was written/);
});
