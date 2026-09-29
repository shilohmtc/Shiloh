const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const booking = fs.readFileSync(path.join(__dirname, '..', 'src/services/adminBooking.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'src/db/migrations/063_jean_pierre_booking_entitlement.sql'), 'utf8');

test('database guard prevents crafted or alternate admin booking paths from escaping practitioner scope', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION enforce_admin_booking_practitioner_scope/);
  assert.match(migration, /admin_name IN \('christel', 'abigail'\)/);
  assert.match(migration, /target_staff_name IN \('christel', 'abigail'\)/);
  assert.match(migration, /admin_name = 'marietjie'/);
  assert.match(migration, /admin_name = 'jean-pierre'[\s\S]*target_staff_name IN \('christel', 'abigail'\)/);
  assert.match(migration, /linked_staff_id = NEW\.staff_id/);
  assert.match(migration, /allowed := false/);
  assert.match(migration, /admin_booking_scope_denied/);
});

test('final booking still revalidates staff-service eligibility before production write', () => {
  assert.match(booking, /SELECT 1 FROM staff_services WHERE staff_id = \$1 AND service_id = \$2 LIMIT 1/);
  assert.match(booking, /eligibility_changed/);
});

test('booking commit uses Shiloh-only scheduling authority and creates no external mirror', () => {
  assert.match(booking, /schedulingAuthority: "shiloh_canonical"/);
  assert.doesNotMatch(booking, /createBookingEvent|createPractitionerBookingEvent|appointment_calendar_events|Google Calendar/);
});
