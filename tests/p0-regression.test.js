const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  deterministicEventId,
  bookingSummary,
  serviceIcon,
} = require('../src/services/googleBookingCalendar');
const {
  registrationStatus,
  assertRegistrationComplete,
  identityVerificationStatus,
} = require('../src/services/clientRegistrationPolicy');
const { isBusinessWide } = require('../src/services/staffAdminScope');
const { closePool } = require('../src/db/pool');

const ROOT = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test.after(async () => {
  await closePool();
});

test('calendar event IDs are deterministic and appointment-specific', () => {
  const first = deterministicEventId('shiloh-appointment:354');
  assert.equal(first, deterministicEventId('shiloh-appointment:354'));
  assert.notEqual(first, deterministicEventId('shiloh-appointment:355'));
  assert.match(first, /^[a-f0-9]{40}$/);
});

test('calendar presentation uses canonical treatment/client/practitioner ordering', () => {
  assert.equal(
    bookingSummary({ clientName: 'Christel Botha', serviceName: 'Full Body Swedish', staffName: 'Abigail' }),
    '💆 Full Body Swedish — Christel Botha — Abigail',
  );
  assert.equal(serviceIcon('Permanent Makeup'), '✨');
  assert.doesNotMatch(
    bookingSummary({ clientName: 'Janita Hatting', serviceName: 'Facial', staffName: 'Marietjie' }),
    /Client\s*-/i,
  );
});

test('walk-in registration remains minimal and separate from contact verification', () => {
  assert.deepEqual(
    registrationStatus({ fullName: 'Test Client', mobileNumber: '0820000000', dateOfBirth: '1990-01-01' }),
    { complete: true, missing: [], required: ['full_name', 'mobile_number', 'date_of_birth'] },
  );
  assert.throws(
    () => assertRegistrationComplete({ fullName: 'Test Client', mobileNumber: '', dateOfBirth: null }),
    (error) => error.code === 'CLIENT_REGISTRATION_INCOMPLETE' && error.missing.includes('mobile_number'),
  );
  assert.deepEqual(identityVerificationStatus({ contactVerified: false }), { verified: false });
});

test('business-wide scope cannot be inferred for scoped practitioners', () => {
  assert.equal(isBusinessWide({ business_role: 'owner' }), true);
  assert.equal(isBusinessWide({ business_role: 'business_admin' }), true);
  assert.equal(isBusinessWide({ business_role: 'tenant_practitioner', service_scope: 'own_services', calendar_scope: 'own_services' }), false);
  assert.equal(isBusinessWide({ business_role: 'employee_practitioner', service_scope: 'own_services', calendar_scope: 'own_appointments' }), false);
});

test('ordinary role-specific WhatsApp Admin menu is retired', () => {
  const menu = source('src/services/adminMobileMenu.js');
  assert.match(menu, /WhatsApp Admin has retired/);
  assert.match(menu, /function getMenuOptions\(\) \{ return \[\]; \}/);
  assert.doesNotMatch(menu, /appointment:view|service:pricing|client:lookup|schedule:manage|key:/);
});

test('booking updates retain clinic, staff and canonical Shiloh conflict guards', () => {
  const bookingUpdate = source('src/services/adminBookingUpdate.js');
  assert.match(bookingUpdate, /checkClinicHours/);
  assert.match(bookingUpdate, /checkAuthoritativeSchedule/);
  assert.match(bookingUpdate, /a\.starts_at<\$4 AND a\.ends_at>\$3/);
  assert.doesNotMatch(bookingUpdate, /checkCalendarAvailability|googleBookingCalendar|appointment_calendar_events/);
  assert.match(bookingUpdate, /ROLLBACK/);
  assert.match(bookingUpdate, /multi-service booking/i);
});

test('client cancellation remains explicit, scoped and leaves external snapshots untouched', () => {
  const change = source('src/services/appointmentChange.js');
  assert.match(change, /cancel/i);
  assert.match(change, /confirmation|confirm/i);
  assert.match(change, /normalized_whatsapp|normalizePhone/i);
  assert.doesNotMatch(change, /cancelBookingEvent|Google Calendar|appointment_calendar_events/i);
  assert.match(change, /crm_audit_events|audit/i);
});

test('Goldie future import retains structural replay and duplicate safeguards', () => {
  const goldie = source('src/services/goldieFutureImport.js');
  assert.match(goldie, /function rowKey/);
  assert.match(goldie, /existingAppointment/);
  assert.match(goldie, /source='goldie_import' AND external_key=\$1/);
  assert.match(goldie, /ON CONFLICT\(source,entity_type,external_id\)/);
  assert.match(goldie, /no customer confirmation sent/i);
  assert.doesNotMatch(goldie, /sendWhatsAppMessage\s*\(/);
});

test('normal post-cutover startup contains only current long-running schedulers and no one-time maintenance hooks', () => {
  const app = source('app.js');
  assert.match(app, /startGoogleBusinessProfileSyncScheduler/);
  assert.match(app, /startAppointmentLifecycleScheduler/);
  assert.match(app, /startCustomerCareScheduler/);
  assert.doesNotMatch(app, /startGoldieSyncScheduler|goldieSync/);
  assert.doesNotMatch(app, /RUN_[A-Z0-9_]+/);
  assert.doesNotMatch(app, /BIRTHDAY_TEMPLATE_INSPECT_ONCE|getBirthdayTemplateStatus/);
  assert.doesNotMatch(app, /repairJeanPierreIdentity|repairNatashaStaffAssignment/);
  assert.doesNotMatch(app, /runGoldieFutureImport|runGoogleCalendarReconciliation/);
  assert.doesNotMatch(app, /runMarietjieCalendarRollout|runAbigailCalendarRollout/);
  assert.doesNotMatch(app, /runCataloguePolish|runStartupTestCommand/);
});

test('OpenAI language guard uses a currently valid output-token floor', () => {
  const guard = source('src/services/englishLanguageGuard.js');
  assert.match(guard, /max_output_tokens:16/);
  assert.doesNotMatch(guard, /max_output_tokens:[0-9](?:\D|$)/);
});

test('maintenance writes and outbound WhatsApp require explicit acknowledgements', () => {
  const maintenance = source('scripts/maintenance.js');
  assert.match(maintenance, /command\.mutates && !args\.includes\('--confirm'\)/);
  assert.match(maintenance, /startup-test-command/);
  assert.match(maintenance, /mutates: true,\r?\n    mayMessage: true/);
  assert.match(maintenance, /sendReplyToWhatsApp: allowWhatsApp === true/);
  assert.match(maintenance, /args\.includes\('--allow-whatsapp'\)/);
  assert.match(maintenance, /goldie-future-import-dry-run/);
  assert.match(maintenance, /google-calendar-reconcile-dry-run/);
  assert.match(maintenance, /goldie-future-import-commit/);
  assert.match(maintenance, /google-calendar-reconcile-commit/);
});

test('CI regression suite contains no production mutation or outbound-message code', () => {
  const self = source('tests/p0-regression.test.js');
  assert.doesNotMatch(self, /pool\.query\s*\(/);
  assert.doesNotMatch(self, /fetch\s*\(/);
  assert.doesNotMatch(self, /sendWhatsAppMessage\s*\(/);
});
