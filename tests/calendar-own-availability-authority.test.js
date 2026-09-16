const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CALENDAR_CAPABILITIES,
  evaluateCalendarAuthority,
  operationsForAuthority,
  allowsStaffTarget,
} = require('../src/services/calendarAuthorization');
const {
  PROFILE_OWN_WORKSPACE,
  TOGGLES,
  canonicalProfileConfig,
  safeTogglePermissions,
} = require('../src/services/workspaceStaffAccessProfiles');

function ownWorkspaceAuthority(permissions = {}) {
  return evaluateCalendarAuthority({
    id: 19,
    staff_id: 51,
    display_name: 'Marietjie',
    business_role: 'tenant_practitioner',
    calendar_scope: 'own_appointments',
    service_scope: 'own_services',
    permissions,
    admin_active: true,
    staff_status: 'active',
  }, { allowedServiceIds: [101, 102] });
}

test('availability management grants Block time and Leave without Clinic Hours authority', () => {
  const authority = ownWorkspaceAuthority({
    'appointment:view': true,
    'schedule:availability_manage': true,
  });
  assert.ok(authority);
  assert.equal(authority.capabilities.includes(CALENDAR_CAPABILITIES.AVAILABILITY_MANAGE), true);
  assert.deepEqual(operationsForAuthority(authority), [
    'calendar_block:manage',
    'operational_leave:manage',
  ]);
  assert.equal(operationsForAuthority(authority).includes('working_schedule:manage'), false);
  assert.equal(authority.capabilities.includes(CALENDAR_CAPABILITIES.SCHEDULE_MANAGE), false);
});

test('own availability remains locked to the linked practitioner', () => {
  const authority = ownWorkspaceAuthority({ 'schedule:availability_manage': true });
  assert.equal(allowsStaffTarget(authority, 51), true);
  assert.equal(allowsStaffTarget(authority, 52), false);
});

test('existing broad schedule managers retain all schedule operations', () => {
  const authority = evaluateCalendarAuthority({
    id: 2,
    staff_id: 7,
    display_name: 'Owner',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'schedule:manage': true },
    admin_active: true,
    staff_status: 'active',
  });
  assert.deepEqual(operationsForAuthority(authority).slice(-3), [
    'calendar_block:manage',
    'operational_leave:manage',
    'working_schedule:manage',
  ]);
});

test('Own workspace profile exposes friendly own-availability control and keeps Clinic Hours protected', () => {
  const config = canonicalProfileConfig(PROFILE_OWN_WORKSPACE);
  assert.equal(config.permissions['schedule:availability_manage'], true);
  assert.notEqual(config.permissions['schedule:manage'], true);

  const availabilityToggle = TOGGLES[PROFILE_OWN_WORKSPACE].find((item) => item.key === 'manage_my_availability');
  assert.ok(availabilityToggle);
  assert.equal(availabilityToggle.label, 'Manage my availability');

  const row = { permissions: config.permissions };
  const off = safeTogglePermissions(row, PROFILE_OWN_WORKSPACE, 'manage_my_availability', false);
  assert.notEqual(off['schedule:availability_manage'], true);
  assert.equal(off['schedule:view'], true);
  assert.notEqual(off['schedule:manage'], true);
});

test('migration 129 grants only the scoped availability capability to Marietjie', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '129_marietjie_own_availability_controls.sql'), 'utf8');
  assert.match(migration, /LOWER\(TRIM\(a\.display_name\)\)='marietjie'/i);
  assert.match(migration, /calendar_scope <> 'own_appointments'/);
  assert.match(migration, /service_scope <> 'own_services'/);
  assert.match(migration, /schedule:availability_manage/);
  assert.match(migration, /schedule:manage/);
  assert.match(migration, /calendar:booking:reassign/);
});
