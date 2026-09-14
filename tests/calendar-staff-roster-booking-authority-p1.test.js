const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const {
  CALENDAR_CAPABILITIES,
  CALENDAR_OPERATIONS,
  evaluateCalendarAuthority,
  operationsForAuthority,
  allowsBookingTarget,
  allowsAppointmentTarget,
  allowsStaffTarget,
} = require('../src/services/calendarAuthorization');

const create = {
  'appointment:view': true,
  'appointment:create': true,
  'client:lookup': true,
};
const appointments = {
  'calendar:booking:reschedule': true,
  'calendar:booking:cancel': true,
  'calendar:booking:reassign': true,
};

function principal(overrides = {}) {
  return {
    id: 100,
    staff_id: null,
    display_name: 'Data-assigned operator',
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { ...create, ...appointments },
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

test('stable vocabulary and evaluator derive authority only from canonical data fields', () => {
  assert.deepEqual(CALENDAR_CAPABILITIES, {
    VIEW: 'appointment:view',
    BOOKING_CREATE: 'appointment:create',
    RECORD_PAST: 'appointment:record_past',
    ADJUST_END: 'appointment:adjust_end',
    CLIENT_LOOKUP: 'client:lookup',
    BOOKING_RESCHEDULE: 'calendar:booking:reschedule',
    BOOKING_CANCEL: 'calendar:booking:cancel',
    BOOKING_REASSIGN: 'calendar:booking:reassign',
    COUPLES_DISCOUNT: 'appointment:couples:discount',
    SCHEDULE_MANAGE: 'schedule:manage',
  });
  const first = evaluateCalendarAuthority(principal());
  const renamed = evaluateCalendarAuthority(principal({ display_name: 'Entirely different operator' }));
  assert.deepEqual(renamed, first);
  const roleChanged = evaluateCalendarAuthority(principal({ business_role: 'receptionist' }));
  assert.equal(roleChanged.businessRole, 'receptionist');
  assert.notDeepEqual(roleChanged, first);
  assert.deepEqual(operationsForAuthority(first), ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign']);
  assert.deepEqual(CALENDAR_OPERATIONS.slice(3), ['calendar_block:manage', 'operational_leave:manage', 'working_schedule:manage']);
});

test('unknown, inactive, unlinked scoped and incompatible-scope principals fail closed', () => {
  assert.equal(evaluateCalendarAuthority({}), null);
  assert.equal(evaluateCalendarAuthority(principal({ admin_active: false })), null);
  assert.equal(evaluateCalendarAuthority(principal({ id: null })), null);
  assert.equal(evaluateCalendarAuthority(principal({ calendar_scope: 'none' })), null);
  assert.equal(evaluateCalendarAuthority(principal({ calendar_scope: 'own_services', service_scope: 'own_services' })), null);
  assert.equal(evaluateCalendarAuthority(principal({ staff_id: 8, staff_status: 'inactive', service_scope: 'own_services' }), { allowedServiceIds: [50] }), null);
  assert.equal(evaluateCalendarAuthority(principal({ staff_id: 8, staff_status: 'active', calendar_scope: 'own_services', service_scope: 'all_services' })), null);
});

test('all-business booking operator can book internal practitioners but receives no schedule powers', () => {
  const authority = evaluateCalendarAuthority(principal());
  for (const staffId of [201, 202, 203]) assert.equal(allowsBookingTarget(authority, { staffId, serviceId: 50 }), true);
  assert.equal(allowsAppointmentTarget(authority, { staffIds: [201], serviceIds: [50] }), true);
  assert.equal(allowsStaffTarget(authority, 201), true);
  assert.deepEqual(operationsForAuthority(authority), ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign']);
});

test('own-services operator is bounded by canonical service mappings and staff-only operations stay own-staff', () => {
  const authority = evaluateCalendarAuthority(principal({
    staff_id: 11,
    staff_status: 'active',
    calendar_scope: 'own_services',
    service_scope: 'own_services',
    permissions: { ...create, ...appointments, 'schedule:manage': true },
  }), { allowedServiceIds: [50] });
  assert.equal(allowsBookingTarget(authority, { staffId: 201, serviceId: 50 }), true);
  assert.equal(allowsBookingTarget(authority, { staffId: 201, serviceId: 51 }), false);
  assert.equal(allowsAppointmentTarget(authority, { staffIds: [201], serviceIds: [50] }), true);
  assert.equal(allowsAppointmentTarget(authority, { staffIds: [201], serviceIds: [50, 51] }), false);
  assert.equal(allowsStaffTarget(authority, 11), true);
  assert.equal(allowsStaffTarget(authority, 201), false);
  assert.deepEqual(operationsForAuthority(authority), CALENDAR_OPERATIONS);
});

test('affected Calendar application paths contain no person-name or phone authorization policy', () => {
  const runtime = [
    'src/services/calendarAuthorization.js',
    'src/services/calendarCreateBooking.js',
    'src/services/calendarOperationalMutations.js',
    'src/services/calendarAccessDiagnostic.js',
  ].map(read).join('\n');
  assert.doesNotMatch(runtime, /christel|abigail|marietjie|jean-pierre|naomi|pieter|savanna|ilince/i);
  assert.doesNotMatch(runtime, /normalized_whatsapp|whatsapp_number|OPERATIONAL_PRINCIPALS|GOVERNED_PRACTITIONERS|JP_UNION/);
  assert.match(runtime, /resolveCalendarAuthority/);
  assert.match(runtime, /allowsBookingTarget/);
  assert.match(runtime, /allowsAppointmentTarget/);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/services/jeanPierreAdminAccessBootstrap.js')), false);
  assert.doesNotMatch(read('app.js'), /ensureJeanPierreAdminCapabilities|capability clone/i);
});

test('internal Calendar and client self-service bookability remain explicitly separated', () => {
  const calendar = read('src/services/calendarCreateBooking.js');
  const clientAvailability = read('src/services/clientBookingAvailability.js');
  const clientCommit = read('src/services/clientBookingCommit.js');
  assert.doesNotMatch(calendar, /client_bookable/);
  assert.match(calendar, /st\.status = 'active'/);
  assert.match(calendar, /JOIN staff_services/);
  assert.match(clientAvailability, /client_bookable = TRUE/);
  assert.match(clientCommit, /canonical\.client_bookable !== true/);
});

test('migration assigns least privilege, reconciles roster and never embeds private mobiles', () => {
  const migration = read('migrations/088_calendar_staff_roster_booking_authority.sql');
  assert.match(migration, /booking_operator/);
  assert.match(migration, /private_naomi_mobile/);
  assert.match(migration, /private_ilince_mobile/);
  assert.doesNotMatch(migration, /\+27\d{9}|'27[678]\d{8}'/);
  assert.match(migration, /source_name='Pieter \.'/);
  assert.match(migration, /source_name='Savanna Massage Practitioner'/);
  assert.match(migration, /source_name='ILince \.'/);
  assert.match(migration, /scheduling_type='regular', client_bookable=FALSE/);
  assert.match(migration, /display_name='ILince'[\s\S]*client_bookable=TRUE/);
  assert.match(migration, /61a0a7db-426d-4ecf-94ff-9fd6855f384d/);
  assert.match(migration, /DELETE FROM staff_services[\s\S]*staff_id=ilince_staff_id[\s\S]*service_id<>swedish_service_id/);
  assert.match(migration, /COUNT\(\*\) FROM staff_services WHERE staff_id=ilince_staff_id\) <> 1/);
  assert.match(migration, /role='receptionist'[\s\S]*business_role='booking_operator'[\s\S]*calendar_scope='all_business'[\s\S]*service_scope='all_services'/);
  assert.doesNotMatch(migration, /client:delete|service:pricing|provider|staff_auth:reset|credential/i);
  assert.doesNotMatch(migration, /INSERT INTO appointments|UPDATE appointments|INSERT INTO clients|UPDATE clients|send|google/i);
});

test('ILince booking-request resolution is linked-staff Workspace authority, not WhatsApp contact authority', () => {
  const approval = read('src/services/clientBookingApproval.js');
  const migration = read('migrations/088_calendar_staff_roster_booking_authority.sql');
  assert.match(approval, /Number\(row\.approver_staff_id\) === Number\(principal\.staff_id\)/);
  assert.doesNotMatch(approval, /resolveApproverContact|normalized_whatsapp/);
  assert.match(migration, /WHERE id=ilince_admin_id/);
  assert.match(migration, /- 'appointment:create'/);
  assert.match(migration, /- 'calendar:booking:reschedule'/);
  assert.match(migration, /- 'calendar:booking:cancel'/);
  assert.match(migration, /- 'calendar:booking:reassign'/);
});

test('migration leaves clinic envelope, appointments, CRM V2, providers and existing catalogue values untouched', () => {
  const migration = read('migrations/088_calendar_staff_roster_booking_authority.sql');
  assert.doesNotMatch(migration, /location_working_hours|location_hours_exceptions|public_holidays/);
  assert.doesNotMatch(migration, /UPDATE services|INSERT INTO services|price|duration_minutes/);
  assert.doesNotMatch(migration, /crm_v2|client_contacts|whatsapp_messages|google_calendar/i);
});

test('migration runner applies the roster unit atomically and rolls the entire file back on failure', () => {
  const runner = read('scripts/migrate.js');
  const authority = read('src/services/migrations.js');
  assert.match(runner, /applyPendingMigrations/);
  assert.match(authority, /await client\.query\('BEGIN'\)/);
  assert.match(authority, /if \(sql\.trim\(\)\) await client\.query\(sql\)/);
  assert.match(authority, /await client\.query\('COMMIT'\)/);
  assert.match(authority, /await client\.query\('ROLLBACK'\)/);
  assert.ok(authority.lastIndexOf("await client.query('ROLLBACK')") > authority.indexOf('if (sql.trim()) await client.query(sql)'));
});
