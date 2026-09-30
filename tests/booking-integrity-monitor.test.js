const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const monitor = fs.readFileSync(path.join(root, 'src/services/bookingIntegrityMonitor.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/032_booking_integrity_exceptions.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const buttons = fs.readFileSync(path.join(root, 'src/services/adminEarningsButtons.js'), 'utf8');

test('booking integrity monitor covers current practitioner calendars', () => {
  assert.match(monitor, /GOOGLE_CHRISTEL_CALENDAR_ID/);
  assert.match(monitor, /GOOGLE_ABIGAIL_CALENDAR_ID/);
  assert.doesNotMatch(monitor, /GOOGLE_MARIETJIE_CALENDAR_ID/);
  assert.match(monitor, /SCAN_LOOKAHEAD_MS = 90/);
});

test('manual calendar events never auto-create CRM appointments or authorize outbound messaging', () => {
  assert.doesNotMatch(monitor, /INSERT INTO appointments/i);
  assert.doesNotMatch(monitor, /sendWhatsApp/i);
  assert.match(monitor, /automaticImport: false/);
  assert.match(monitor, /outboundMessagingAuthorized: false/);
  assert.match(monitor, /Shiloh never auto-imports them/);
});

test('integrity review ledger self-initializes safely before scanning', () => {
  assert.match(monitor, /CREATE TABLE IF NOT EXISTS booking_integrity_exceptions/);
  assert.match(monitor, /CREATE INDEX IF NOT EXISTS idx_booking_integrity_open/);
  assert.match(monitor, /await ensureIntegrityTable\(\)/);
  assert.match(migration, /UNIQUE \(calendar_id, event_id\)/);
});

test('CRM-linked events resolve exceptions while booking-like unlinked events remain open', () => {
  assert.match(monitor, /shilohAppointmentId/);
  assert.match(monitor, /classification === 'booking_like' \? 'open' : 'observed'/);
  assert.match(monitor, /status='resolved'/);
});

test('integrity scan runs automatically on a bounded interval', () => {
  assert.match(monitor, /15 \* 60 \* 1000/);
  assert.match(monitor, /setInterval\(run, SCAN_INTERVAL_MS\)/);
  assert.match(app, /startBookingIntegrityScheduler\(\)/);
});

test('stale integrity button ids fail into internal-only retirement', () => {
  assert.match(buttons, /admin_calendar_integrity_scan: 'admin_retired_internal_action'/);
  assert.match(buttons, /admin_calendar_integrity_issues: 'admin_retired_internal_action'/);
  assert.doesNotMatch(buttons, /title: 'Scan Now'|title: 'Open Issues'/);
});
