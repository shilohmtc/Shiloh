const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const interactivePath = path.join(__dirname, '..', 'src', 'services', 'clientBookingInteractive.js');
const discoveryPath = path.join(__dirname, '..', 'src', 'services', 'clientDiscoveryMenu.js');
const staffGuardPath = path.join(__dirname, '..', 'src', 'services', 'clientBookingStaffGuard.js');
const source = fs.readFileSync(interactivePath, 'utf8');
const discovery = fs.readFileSync(discoveryPath, 'utf8');
const {
  bookingDiscoveryInteractive,
  confirmationInteractive,
  decorateClientBookingResult,
  practitionerRequiredInteractive,
} = require(interactivePath);
const { clientFacingPractitionerLabel } = require(staffGuardPath);

const serviceIntent = {
  service_text: 'Swedish Massage',
  service_verified: true,
  therapist_text: null,
  preferred_date: null,
  preferred_time: null,
  status: 'collecting',
};

test('booking entry presents the four client service families as a genuine WhatsApp list', () => {
  const view = bookingDiscoveryInteractive();
  assert.equal(view.type, 'list');
  assert.deepEqual(view.rows.map((row) => row.id), [
    'client_family_beauty',
    'client_family_massage',
    'client_family_lymphatic',
    'client_family_pedicure',
  ]);
  assert.deepEqual(view.rows.map((row) => row.title), [
    'Beauty & Aesthetics',
    'Massage Treatments',
    'Lymphatic Drainage',
    'Elim MediHeel Pedicures',
  ]);
  assert.ok(view.rows.every((row) => row.title.length <= 24));
});

test('Our practitioners chooser labels the three client-facing roles without exposing owner or employee status', () => {
  assert.equal(clientFacingPractitionerLabel('Christel'), 'Christel · Massage');
  assert.equal(clientFacingPractitionerLabel('Abigail'), 'Abigail · Massage');
  assert.equal(clientFacingPractitionerLabel('Marietjie'), 'Marietjie · Esthetician');
  const labels = [clientFacingPractitionerLabel('Christel'), clientFacingPractitionerLabel('Abigail'), clientFacingPractitionerLabel('Marietjie')].join(' ');
  assert.doesNotMatch(labels, /owner|employee/i);
});

test('missing practitioner preference blocks date collection and redirects to CRM-backed discovery', () => {
  const decorated = decorateClientBookingResult({ handled: true, intent: serviceIntent });
  assert.equal(decorated.interactive.type, 'button');
  assert.match(decorated.interactive.body, /practitioners currently eligible for this treatment/i);
  assert.deepEqual(decorated.interactive.buttons.map((button) => button.id), ['client_selected_service_practitioners', 'client_browse_services']);
  assert.deepEqual(decorated.interactive.buttons.map((button) => button.title), ['See practitioners', 'Change treatment']);
});

test('missing practitioner can never silently become Any available at final confirmation', () => {
  const awaiting = decorateClientBookingResult({ handled: true, intent: { ...serviceIntent, preferred_date: '2026-08-13', preferred_time: '14:00', status: 'awaiting_confirmation' } });
  assert.match(awaiting.interactive.body, /explicit \*Any available\* option/);
  assert.doesNotMatch(source, /therapist_text\s*\|\|\s*['"]Any available practitioner['"]/);
  const explicit = confirmationInteractive({ ...serviceIntent, therapist_text: 'Any available therapist', preferred_date: '2026-08-13', preferred_time: '14:00', status: 'awaiting_confirmation' });
  assert.match(explicit.body, /Practitioner: Any available therapist/);
});

test('standard discovery keeps Any available explicit and service-scoped', () => {
  assert.match(discovery, /welcomeVoucher \? 'client_voucher_practitioner_any' : 'client_practitioner_any'/);
  assert.match(discovery, /Use any eligible practitioner for this service/);
  assert.match(discovery, /listEligiblePractitionersForService/);
  assert.match(discovery, /practitionerEligibleForService/);
  assert.match(discovery, /serviceEligibleForPractitioner/);
  assert.match(discovery, /st\.client_bookable = TRUE/);
});

test('typed booking entry is redirected into the same four-family discovery list when service is missing', () => {
  const decorated = decorateClientBookingResult({ handled: true, intent: { ...serviceIntent, service_text: null, service_verified: null } });
  assert.equal(decorated.interactive.type, 'list');
  assert.deepEqual(decorated.interactive.rows.map((row) => row.id), ['client_family_beauty', 'client_family_massage', 'client_family_lymphatic', 'client_family_pedicure']);
});

test('practitioner requirement copy never labels the treatment team as employees', () => {
  const view = practitionerRequiredInteractive(serviceIntent);
  assert.doesNotMatch(`${bookingDiscoveryInteractive().body}\n${view.body}`, /employees?/i);
  assert.doesNotMatch(view.body, /Marietjie|Christel|Abigail/);
});
