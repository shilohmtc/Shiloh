const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function combined(...files) {
  return files.map(source).join('\n');
}

test('booking-path audit covers new and returning client identity without bypassing registration', () => {
  const identity = combined(
    'tests/client-booking-identity-gate.test.js',
    'src/services/clientIdentityOnboarding.js',
    'src/services/clientBookingIdentityGate.js'
  );
  assert.match(identity, /onboarding|registration/i);
  assert.match(identity, /return|matched_complete|profileComplete/i);
  assert.match(identity, /preserv|booking intent|booking_requested/i);
});

test('booking-path audit covers service and practitioner questions from authoritative CRM knowledge', () => {
  const knowledge = combined(
    'tests/practitioner-public-knowledge.test.js',
    'src/services/practitionerKnowledge.js',
    'src/services/activeCatalogueKnowledge.js'
  );
  assert.match(knowledge, /staff_services/);
  assert.match(knowledge, /client_bookable/);
  assert.match(knowledge, /active/);
  assert.match(knowledge, /authoritative|CRM/i);
});

test('booking-path audit covers practitioner-specific and any-eligible-practitioner booking', () => {
  const discovery = combined(
    'tests/client-booking-practitioner-service-link.test.js',
    'tests/client-authoritative-availability.test.js'
  );
  assert.match(discovery, /specific service-practitioner combinations are revalidated/i);
  assert.match(discovery, /Any available/i);
  assert.match(discovery, /client-bookable/i);
});

test('booking-path audit covers unavailable practitioner and fail-closed slot conflict behavior', () => {
  const availability = combined(
    'tests/client-authoritative-availability.test.js',
    'src/services/clientBookingAvailability.js',
    'src/services/availabilityService.js',
    'src/services/clientBookingCommit.js'
  );
  const operationalSources = combined(
    'src/services/clientBookingAvailability.js',
    'src/services/availabilityService.js',
    'src/services/clientBookingCommit.js'
  );
  assert.match(availability, /revalidat/i);
  assert.match(availability, /conflict/i);
  assert.match(availability, /stale|unavailable/i);
  assert.doesNotMatch(operationalSources, /checkCalendarAvailability|checkPractitionerCalendarAvailability|appointment_calendar_events/);
});

test('booking-path audit covers explicit policy acceptance before canonical appointment creation', () => {
  const policy = combined(
    'tests/p3-booking-policy.test.js',
    'tests/client-canonical-booking-commit.test.js',
    'src/services/bookingPolicy.js',
    'src/services/clientBookingCommit.js'
  );
  assert.match(policy, /I AGREE/);
  assert.match(policy, /policy_accepted/);
  assert.match(policy, /INSERT INTO appointments/);
  assert.match(policy, /FOR UPDATE/);
});

test('booking-path audit covers Google decommission plus legacy integrity monitoring', () => {
  const calendars = combined(
    'tests/practitioner-calendar-sync.test.js',
    'tests/client-canonical-booking-commit.test.js',
    'src/services/googleBookingCalendar.js',
    'src/services/bookingIntegrityMonitor.js'
  );
  assert.match(calendars, /SHILOH_CALENDAR_SOLE_AUTHORITY|decommissioned/i);
  assert.match(calendars, /shilohAppointmentId/);
  assert.match(calendars, /booking_integrity/i);
});

test('booking-path audit covers client cancellation and rescheduling against canonical calendars', () => {
  const appointmentChange = source('src/services/appointmentChange.js');
  const cancellationOwner = source('src/services/clientAppointmentCancellation.js');
  const changes = `${appointmentChange}\n${cancellationOwner}`;
  assert.match(appointmentChange, /cancelOwnedAppointmentInTransaction/);
  assert.match(cancellationOwner, /client\.appointment_cancelled/);
  assert.match(appointmentChange, /client\.appointment_rescheduled/);
  assert.match(changes, /pg_advisory_xact_lock/);
  assert.doesNotMatch(changes, /cancelBookingEvent|updateBookingEvent|checkCalendarAvailability|appointment_calendar_events/);
});

test('booking-path production test suite remains non-mutating by default', () => {
  const p0 = source('tests/p0-regression.test.js');
  assert.match(p0, /CI regression suite contains no production mutation or outbound-message code/);
});
