const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRACTITIONER_COPY_CAPABILITIES,
  practitionerPresetPermissions,
  principalProjection,
} = require('../src/services/workspaceAccessV2');
const { dashboardAuthority } = require('../src/services/workspaceDashboard');
const { createWorkspaceReportsPractitionerScopeService } = require('../src/services/workspaceReportsPractitionerScope');
const { createWorkspaceClientMutationsPractitionerScopeService } = require('../src/services/workspaceClientMutationsPractitionerScope');
const { createWorkspaceServicesPractitionerScopeService } = require('../src/services/workspaceServicesPractitionerScope');
const {
  createCalendarReadOnlyUxPractitionerScopeService,
  reorderByStaffId,
} = require('../src/services/calendarReadOnlyUxPractitionerScope');
const { injectClientDetailManagement } = require('../src/presentation/workspaceClientsManagePractitionerScopeUx');
const {
  canAccessWorkspaceOwnFinalization,
  canAccessWorkspaceBackupFinalization,
  canCertifyAppointment,
} = require('../src/services/attendanceFinalizationAuthority');

const SAFE_PRACTITIONER_CAPABILITIES = [
  'appointment:view',
  'booking:update',
  'client:lookup',
  'client:manage',
  'services:view',
  'services:manage',
];

function practitionerPrincipal(overrides = {}) {
  return {
    id: 71,
    staff_id: 44,
    display_name: 'Generic Practitioner',
    role: 'practitioner',
    active: true,
    admin_active: true,
    business_role: 'employee_practitioner',
    calendar_scope: 'all_business',
    service_scope: 'own_services',
    permissions: practitionerPresetPermissions(),
    staff_status: 'active',
    staff_resource_type: 'practitioner',
    staff_display_name: 'Generic Practitioner',
    staff_business_role: 'employee_practitioner',
    linked_count: 1,
    ...overrides,
  };
}

test('migration 118 grants only bounded practitioner Workspace capabilities and leaves read scopes untouched', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '118_practitioner_workspace_scope_v1.sql'), 'utf8');
  for (const capability of SAFE_PRACTITIONER_CAPABILITIES) {
    assert.match(sql, new RegExp(capability.replace(':', '\\:'), 'i'));
  }
  assert.match(sql, /resource_type\s*=\s*'practitioner'/i);
  assert.match(sql, /business_role\s+IN\s*\(\s*'tenant_practitioner'\s*,\s*'employee_practitioner'\s*\)/i);
  assert.match(sql, /business_role\s*=\s*'tenant_practitioner'/i);
  assert.match(sql, /services:create/i);
  assert.match(sql, /-\s*'client:delete'/i);
  assert.doesNotMatch(sql, /LOWER\s*\(\s*(?:TRIM\s*\()?\s*display_name/i);
  assert.doesNotMatch(sql, /christel|abigail|marietjie|jean-pierre/i);
  assert.doesNotMatch(sql, /SET\s+(?:calendar_scope|service_scope)\s*=/i);
});

test('Access V2 Practitioner preset is the safe reusable #928 capability contract', () => {
  assert.deepEqual([...PRACTITIONER_COPY_CAPABILITIES].sort(), [...SAFE_PRACTITIONER_CAPABILITIES].sort());
  assert.deepEqual(practitionerPresetPermissions(), Object.fromEntries(SAFE_PRACTITIONER_CAPABILITIES.map(key => [key, true])));
  for (const forbidden of ['client:delete', 'staff:view', 'staff:manage', 'staff_access:manage', 'staff_auth:reset', 'service:pricing', 'schedule:manage']) {
    assert.equal(practitionerPresetPermissions()[forbidden], undefined);
  }
  const projection = principalProjection(practitionerPrincipal({ calendar_scope: 'own_appointments' }));
  assert.equal(projection.preset.key, 'employee_practitioner_v1');
  assert.equal(projection.preset.status, 'current');
  assert.deepEqual(projection.capabilities, [...SAFE_PRACTITIONER_CAPABILITIES].sort());
});

test('ordinary practitioner Dashboard remains My Day even when Calendar read scope is all_business', () => {
  const authority = dashboardAuthority({
    permissions: { 'appointment:view': true, 'booking:update': true },
    calendarAuthority: {
      businessRole: 'employee_practitioner',
      calendarScope: 'all_business',
      linkedStaffId: 44,
      capabilities: ['appointment:view'],
    },
  });
  assert.equal(authority.mode, 'my_day');
  assert.equal(authority.linkedStaffId, 44);
  assert.deepEqual(authority.timelineViewer, { calendarScope: 'own_appointments', staffId: 44 });
  assert.equal(authority.canFinalizeAllBusiness, undefined);
});

test('Reports force ordinary practitioner queries to the linked staff identity', async () => {
  let received;
  const service = {
    async buildReport(input) {
      received = input;
      return {
        authority: { key: 'base', reportScope: 'all_business', staffId: null },
        selectedStaffId: 55,
        permittedStaff: [{ id: 44, displayName: 'Self' }, { id: 55, displayName: 'Other' }],
      };
    },
  };
  const db = {
    async query() {
      return { rows: [practitionerPrincipal()] };
    },
  };
  const scoped = createWorkspaceReportsPractitionerScopeService({ db, service });
  const model = await scoped.buildReport({ adminId: 71, staff: '55', preset: '7d' });
  assert.equal(received.staff, '44');
  assert.equal(model.authority.reportScope, 'own_staff');
  assert.equal(model.authority.staffId, 44);
  assert.equal(model.selectedStaffId, 44);
  assert.deepEqual(model.permittedStaff.map(item => item.id), [44]);
  assert.equal(model.practitionerScoped, true);
});

test('Clients permit practitioner maintenance but reject archive before canonical mutation', async () => {
  let archiveCalls = 0;
  const db = {
    async query() {
      return { rows: [practitionerPrincipal()] };
    },
  };
  const service = {
    async createClient() { return { status: 'created' }; },
    async updateClient() { return { status: 'updated' }; },
    async archiveClient() { archiveCalls += 1; return { status: 'archived' }; },
  };
  const scoped = createWorkspaceClientMutationsPractitionerScopeService({ db, service });
  assert.equal((await scoped.createClient({ adminId: 71 })).status, 'created');
  assert.equal((await scoped.updateClient({ adminId: 71 })).status, 'updated');
  await assert.rejects(
    scoped.archiveClient({ adminId: 71, clientId: 9 }),
    error => error.code === 'WORKSPACE_CLIENT_ARCHIVE_FORBIDDEN' && error.httpStatus === 403,
  );
  assert.equal(archiveCalls, 0);

  const html = injectClientDetailManagement(
    '<!doctype html><html><head><style></style></head><body><span class="truth-note">View only</span><section class="history-panel"></section></body></html>',
    {
      manageAllowed: true,
      archiveAllowed: false,
      client: {
        id: 9,
        revision: 'a'.repeat(64),
        status: 'active',
        name: 'Client',
        normalized_mobile: '27820000000',
      },
    },
  );
  assert.match(html, /Save client/);
  assert.doesNotMatch(html, /data-client-archive|Archive client/);
  assert.match(html, /archive and delete actions are not available/i);
});

test('Services list is practitioner-assignment scoped and shared catalogue mutations fail closed', async () => {
  const calls = [];
  let updateCalls = 0;
  const db = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('services-principal')) {
        return { rows: [practitionerPrincipal({ business_role: 'tenant_practitioner' })] };
      }
      if (String(sql).includes('services-list')) {
        return { rows: [{
          id: 9,
          name: 'Assigned service',
          duration_minutes: 60,
          processing_time_minutes: 0,
          extra_time_minutes: 0,
          variable_price: false,
          price: '500.00',
          display_price: null,
          status: 'active',
          category_name: 'Body',
          private_owner_staff_id: null,
          assigned_staff_count: 1,
          client_bookable_staff_count: 1,
        }] };
      }
      if (String(sql).includes('service-scope')) {
        return { rows: [{ id: 9, private_owner_staff_id: null, assigned_to_self: true }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = {
    async requireAccess() { return { businessRole: 'tenant_practitioner', linkedStaffId: 44 }; },
    async requireManageAccess() { return { capability: 'services:manage' }; },
    async updateService() { updateCalls += 1; return { status: 'updated' }; },
    async setServiceStatus() { return { status: 'updated' }; },
    async assignPractitioner() { return { status: 'updated' }; },
    async unassignPractitioner() { return { status: 'updated' }; },
    async listServices() { throw new Error('base list should not be used for practitioner'); },
  };
  const scoped = createWorkspaceServicesPractitionerScopeService({ db, service });
  const model = await scoped.listServices({ adminId: 71 });
  assert.equal(model.practitionerScoped, true);
  assert.deepEqual(model.services.map(item => item.id), [9]);
  const listSql = calls.find(sql => sql.includes('services-list'));
  assert.match(listSql, /self_ss\.staff_id=\$1/);
  assert.match(listSql, /visibility\.owner_staff_id=\$1/);

  await assert.rejects(
    scoped.updateService({ adminId: 71, serviceId: 9 }),
    error => error.code === 'WORKSPACE_SERVICES_SHARED_MUTATION_FORBIDDEN' && error.httpStatus === 403,
  );
  assert.equal(updateCalls, 0);
  await assert.rejects(
    scoped.assignPractitioner({ adminId: 71, serviceId: 9, staffId: 55 }),
    error => error.code === 'WORKSPACE_SERVICES_OTHER_PRACTITIONER_FORBIDDEN' && error.httpStatus === 403,
  );
});

test('private tenant-owned service may reuse canonical edit path without widening assignment authority', async () => {
  let updateCalls = 0;
  const db = {
    async query(sql) {
      if (String(sql).includes('services-principal')) {
        return { rows: [practitionerPrincipal({ business_role: 'tenant_practitioner' })] };
      }
      if (String(sql).includes('service-scope')) {
        return { rows: [{ id: 12, private_owner_staff_id: 44, assigned_to_self: true }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = {
    async requireAccess() { return { businessRole: 'tenant_practitioner', linkedStaffId: 44 }; },
    async requireManageAccess() { return { capability: 'services:manage' }; },
    async updateService() { updateCalls += 1; return { status: 'updated' }; },
  };
  const scoped = createWorkspaceServicesPractitionerScopeService({ db, service });
  assert.equal((await scoped.updateService({ adminId: 71, serviceId: 12 })).status, 'updated');
  assert.equal(updateCalls, 1);
});

test('Calendar keeps business-wide visibility but places authenticated practitioner first only inside permitted roster', async () => {
  const baseModel = {
    permittedStaff: [{ id: 11 }, { id: 44 }, { id: 55 }],
    visibleStaffIds: [11, 44, 55],
    authorizedTimeline: { staff: [{ id: 11 }, { id: 44 }, { id: 55 }] },
    timeline: { staff: [{ id: 11 }, { id: 44 }, { id: 55 }] },
  };
  const service = { async buildModel() { return baseModel; } };
  const db = {
    async query(sql) {
      if (String(sql).includes('calendar-principal')) {
        return { rows: [{
          id: 71,
          staff_id: 44,
          display_name: 'Generic Practitioner',
          role: 'practitioner',
          business_role: 'employee_practitioner',
          staff_status: 'active',
          staff_resource_type: 'practitioner',
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const scoped = createCalendarReadOnlyUxPractitionerScopeService({ db, service });
  const model = await scoped.buildModel({ viewer: { calendarScope: 'business_all_staff', operatorAdminId: 71 } });
  assert.deepEqual(model.permittedStaff.map(item => item.id), [44, 11, 55]);
  assert.deepEqual(model.visibleStaffIds, [44, 11, 55]);
  assert.deepEqual(model.timeline.staff.map(item => item.id), [44, 11, 55]);
  assert.equal(model.practitionerFirstStaffId, 44);
  assert.deepEqual(reorderByStaffId([{ id: 11 }, { id: 55 }], 44), [{ id: 11 }, { id: 55 }]);
});

test('generic practitioner with business-wide Calendar read can finalize only own canonical assignments', async () => {
  const admin = practitionerPrincipal();
  assert.equal(canAccessWorkspaceOwnFinalization(admin), true);
  assert.equal(canAccessWorkspaceBackupFinalization(admin), false);

  function authorityDb(assignmentIds) {
    return {
      async query(sql, params = []) {
        if (/FROM staff\s+WHERE id=\$1/.test(String(sql))) return { rows: [{ id: params[0] }] };
        if (/FROM appointment_staff/.test(String(sql))) return { rows: assignmentIds.map(staff_id => ({ staff_id })) };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }

  assert.equal(await canCertifyAppointment(admin, 1, authorityDb([44]), { workspace: true, allowBusinessBackup: true }), true);
  assert.equal(await canCertifyAppointment(admin, 2, authorityDb([55]), { workspace: true, allowBusinessBackup: true }), false);
  assert.equal(await canCertifyAppointment(admin, 3, authorityDb([44, 55]), { workspace: true, allowBusinessBackup: true }), false);
  assert.equal(await canCertifyAppointment(admin, 4, authorityDb([44, null]), { workspace: true, allowBusinessBackup: true }), false);
});

test('route wiring uses scoped authorities rather than parallel domain implementations', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  assert.match(read('src/routes/calendar.js'), /calendarReadOnlyUxPractitionerScope/);
  assert.match(read('src/routes/workspaceReports.js'), /workspaceReportsPractitionerScope/);
  assert.match(read('src/routes/workspaceServices.js'), /workspaceServicesPractitionerScope/);
  assert.match(read('src/routes/workspaceServicesMutations.js'), /workspaceServicesPractitionerScope/);
  assert.match(read('src/routes/workspaceClients.js'), /workspaceClientsPractitionerScope/);
  assert.match(read('src/routes/workspaceClientMutations.js'), /workspaceClientMutationsPractitionerScope/);
});
