const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROFILE_CLINIC_TEAM,
  PROFILE_OWN_WORKSPACE,
  canonicalProfileConfig,
  safeTogglePermissions,
  project,
} = require('../src/services/workspaceStaffAccessProfiles');
const { createWorkspaceReportsProfileViewService } = require('../src/services/workspaceReportsProfileView');
const { createWorkspaceClinicHoursReadViewService } = require('../src/services/workspaceClinicHoursReadView');
const { renderStaffAccessDetail, clientScript } = require('../src/presentation/workspaceStaffAccessProfilesUx');
const { clinicHoursReadOnlyClientScript } = require('../src/routes/workspaceClinicHours');

function principal(overrides = {}) {
  return {
    id: 19,
    staff_id: 51,
    display_name: 'Synthetic Staff',
    staff_display_name: 'Synthetic Staff',
    active: true,
    permissions: {},
    business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments',
    service_scope: 'own_services',
    staff_status: 'active',
    staff_resource_type: 'practitioner',
    staff_business_role: 'employee_practitioner',
    ...overrides,
  };
}

test('Clinic team profile is broad view plus own completion, never broad mutation', () => {
  const config = canonicalProfileConfig(PROFILE_CLINIC_TEAM);
  assert.equal(config.calendarScope, 'own_appointments');
  assert.equal(config.serviceScope, 'own_services');
  for (const capability of ['appointment:view', 'client:lookup', 'services:view', 'staff:view', 'reports:view_all', 'schedule:view', 'booking:update', 'forms:view', 'forms:clinical_manage']) {
    assert.equal(config.permissions[capability], true, capability);
  }
  for (const forbidden of ['appointment:create', 'calendar:booking:reschedule', 'calendar:booking:cancel', 'calendar:booking:reassign', 'client:manage', 'services:manage', 'schedule:manage', 'staff:manage', 'staff_access:manage']) {
    assert.notEqual(config.permissions[forbidden], true, forbidden);
  }
});

test('Own workspace profile keeps Marietjie work-scoped and explicitly blocks clinic/other-staff authority', () => {
  const config = canonicalProfileConfig(PROFILE_OWN_WORKSPACE);
  assert.equal(config.businessRole, 'tenant_practitioner');
  assert.equal(config.calendarScope, 'own_appointments');
  assert.equal(config.serviceScope, 'own_services');
  for (const capability of ['appointment:view', 'appointment:create', 'appointment:adjust_end', 'booking:update', 'calendar:booking:reschedule', 'calendar:booking:cancel', 'client:lookup', 'client:manage', 'services:view', 'services:manage', 'service:pricing', 'schedule:view', 'forms:view', 'forms:clinical_manage']) {
    assert.equal(config.permissions[capability], true, capability);
  }
  for (const forbidden of ['calendar:booking:reassign', 'schedule:manage', 'client:delete', 'services:create', 'staff:view', 'staff:manage', 'staff_access:manage', 'staff_auth:reset']) {
    assert.notEqual(config.permissions[forbidden], true, forbidden);
  }
});

test('Friendly switches can only change profile-safe actions and reassert protected denies', () => {
  const row = principal({
    business_role: 'tenant_practitioner',
    staff_business_role: 'tenant_practitioner',
    permissions: { 'schedule:manage': true, 'calendar:booking:reassign': true, 'client:delete': true },
  });
  const next = safeTogglePermissions(row, PROFILE_OWN_WORKSPACE, 'manage_my_clients', true);
  assert.equal(next['client:manage'], true);
  assert.equal(next['appointment:view'], true);
  assert.equal(next['schedule:view'], true);
  assert.equal(next['forms:view'], true);
  assert.equal(next['forms:clinical_manage'], true);
  assert.notEqual(next['schedule:manage'], true);
  assert.notEqual(next['calendar:booking:reassign'], true);
  assert.notEqual(next['client:delete'], true);
  assert.throws(
    () => safeTogglePermissions(row, PROFILE_OWN_WORKSPACE, 'manage_everything', true),
    (error) => error.code === 'STAFF_ACCESS_TOGGLE_UNSUPPORTED',
  );
});

test('Profile projection presents human labels instead of raw permission language', () => {
  const clinic = project(principal({ permissions: canonicalProfileConfig(PROFILE_CLINIC_TEAM).permissions }));
  assert.equal(clinic.profileKey, PROFILE_CLINIC_TEAM);
  assert.equal(clinic.profileLabel, 'Clinic team');
  assert.equal(clinic.toggles[0].label, 'Complete or mark my appointments no-show');
  const own = project(principal({
    business_role: 'tenant_practitioner',
    staff_business_role: 'tenant_practitioner',
    permissions: canonicalProfileConfig(PROFILE_OWN_WORKSPACE).permissions,
  }));
  assert.equal(own.profileLabel, 'Own workspace');
  assert.ok(own.protectedRestrictions.some((value) => /Clinic Hours/.test(value)));
});

test('Staff access UI uses accessible switch semantics and avoids technical scope/capability copy', () => {
  const person = project(principal({
    business_role: 'tenant_practitioner',
    staff_business_role: 'tenant_practitioner',
    permissions: canonicalProfileConfig(PROFILE_OWN_WORKSPACE).permissions,
  }));
  const html = renderStaffAccessDetail({ authority: { displayName: 'Owner' }, person });
  assert.match(html, /<h1>Staff access<\/h1>/);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, />On<\/span>/);
  assert.match(html, /Protected boundaries/);
  assert.doesNotMatch(html, /calendar_scope|service_scope|canonical principal|capabilit(?:y|ies)/i);
  assert.match(clientScript(), /Saving…/);
  assert.match(clientScript(), /\/staff-access\/.*\/toggle/);
});

test('reports:view_all widens only the read-only Reports projection', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(String(sql));
      if (String(sql).includes('WorkspaceReports:principal')) {
        return { rows: [{ id: 7, staff_id: 77, display_name: 'Clinic Team', calendar_scope: 'own_appointments', permissions: { 'appointment:view': true, 'reports:view_all': true }, admin_active: true, staff_status: 'active' }] };
      }
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };
  const service = createWorkspaceReportsProfileViewService({ db });
  const authority = await service.resolveAccess(7);
  assert.equal(authority.reportScope, 'all_business');
  assert.equal(authority.staffId, null);
  assert.equal(seen.length, 1);
});

test('schedule:view can read Clinic Hours while schedule:manage remains false', async () => {
  const db = {
    async query(sql) {
      if (String(sql).includes('workspaceClinicHoursReadView:principal')) {
        return { rows: [{ id: 8, staff_id: 88, display_name: 'Read Only', permissions: { 'schedule:view': true }, admin_active: true, staff_status: 'active' }] };
      }
      throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
    },
  };
  const service = createWorkspaceClinicHoursReadViewService({ db });
  const authority = await service.resolveAccess(8);
  assert.equal(authority.canManage, false);
  assert.equal(await service.canManage(8), false);
  const script = clinicHoursReadOnlyClientScript();
  assert.match(script, /View only/);
  assert.match(script, /disabled=true/);
});

test('migration 128 aligns the four owner-authorized staff profiles and revokes Marietjie broad authority', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '128_staff_access_profiles_v1.sql'), 'utf8');
  for (const name of ['Naomi', 'ILince', 'Abigail', 'Marietjie']) assert.match(migration, new RegExp(name, 'i'));
  assert.match(migration, /calendar_scope='own_appointments'/);
  assert.match(migration, /service_scope='own_services'/);
  assert.match(migration, /"reports:view_all": true/);
  assert.match(migration, /"schedule:view": true/);
  assert.match(migration, /calendar:booking:reassign/);
  assert.match(migration, /schedule:manage/);
  assert.match(migration, /services:create/);
});

test('Staff access mutations retain session, same-origin and CSRF guards', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workspaceStaffMutations.js'), 'utf8');
  assert.match(route, /const mutationChain = \[sameOrigin, requireSession, requireCsrf\]/);
  assert.match(route, /\/staff-access\/:id\/profile', \.\.\.mutationChain/);
  assert.match(route, /\/staff-access\/:id\/toggle', \.\.\.mutationChain/);
  assert.doesNotMatch(route, /req\.body\?\.permissions/);
});
