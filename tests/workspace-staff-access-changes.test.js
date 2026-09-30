const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceStaffAccessProfilesService, project } = require('../src/services/workspaceStaffAccessProfiles');

function fixture(overrides = {}, operatorId = 1) {
  let row = { id: 19, staff_id: 51, display_name: 'Synthetic practitioner', active: true,
    business_role: 'tenant_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services',
    staff_status: 'active', permissions: { 'client:manage': true, 'services:manage': true, 'service:pricing': true, 'unrelated:existing': true, 'disabled:existing': false }, ...overrides };
  let snapshot;
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql === 'BEGIN') snapshot = structuredClone(row);
    if (sql === 'ROLLBACK') row = snapshot;
    if (sql.includes('workspaceStaffAccessProfiles:principal')) return { rows: [structuredClone(row)] };
    if (sql.startsWith('UPDATE staff_admin_accounts')) row.permissions = JSON.parse(params[1]);
    return { rows: [] };
  }, release() { calls.push({ sql: 'release' }); } };
  const service = createWorkspaceStaffAccessProfilesService({ db: { query: client.query, async connect() { return client; } }, accessService: { async requireManageAccess() { return { operatorAdminId: operatorId, businessRole: 'owner', calendarScope: 'all_business' }; } } });
  const save = changes => service.saveChanges({ adminId: operatorId, principalId: 19, expectedRevision: project(row).revision, requestId: 'synthetic_changes_123', changes });
  return { service, save, calls, row: () => row };
}

test('save atomically changes only selected switches, preserving unrelated grants, disabled settings and scopes', async () => {
  const f = fixture();
  const result = await f.save([{ key: 'client:manage', on: false }, { key: 'services:manage', on: false }]);
  assert.equal(result.status, 'updated');
  assert.deepEqual(f.row().permissions, { 'client:manage': false, 'services:manage': false, 'service:pricing': true, 'unrelated:existing': true, 'disabled:existing': false });
  assert.equal(f.row().calendar_scope, 'own_appointments');
  assert.equal(f.row().business_role, 'tenant_practitioner');
  assert.equal(f.calls.filter(call => call.sql.startsWith('UPDATE')).length, 1);
  assert.equal(f.calls.filter(call => call.sql.includes('INSERT INTO crm_audit_events')).length, 1);
  assert.equal(f.calls.find(call => call.sql.includes('INSERT INTO crm_audit_events')).params[1], 'workspace.staff_access_changes_saved');
  assert.ok(f.calls.some(call => call.sql === 'COMMIT'));
});

test('unsupported switch rolls back the whole save before writing or auditing', async () => {
  const f = fixture();
  const before = structuredClone(f.row());
  await assert.rejects(f.save([{ key: 'client:manage', on: false }, { key: 'staff_access:manage', on: true }]), { code: 'STAFF_ACCESS_TOGGLE_UNSUPPORTED' });
  assert.deepEqual(f.row(), before);
  assert.ok(f.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!f.calls.some(call => call.sql.startsWith('UPDATE') || call.sql.includes('INSERT INTO crm_audit_events')));
});

test('stale revisions, self changes and protected account types refuse before permission writes', async () => {
  for (const mode of ['stale', 'self', 'inactive']) {
    const f = fixture(mode === 'inactive' ? { staff_status: 'inactive' } : {}, mode === 'self' ? 19 : 1);
    const payload = { adminId: 1, principalId: 19, expectedRevision: mode === 'stale' ? '0'.repeat(64) : project(f.row()).revision, requestId: 'synthetic_changes_123', changes: [{ key: 'client:manage', on: false }] };
    await assert.rejects(f.service.saveChanges(payload));
    assert.ok(!f.calls.some(call => call.sql.startsWith('UPDATE')), mode);
  }
});

test('invalid or duplicate switch choices cannot start a transaction', async () => {
  for (const changes of [[], null, [{ key: 'client:manage', on: 'false' }], [{ key: 'client:manage', on: true }, { key: 'client:manage', on: false }]]) {
    const f = fixture();
    await assert.rejects(f.save(changes), { code: 'STAFF_ACCESS_INVALID_TOGGLE' });
    assert.equal(f.calls.length, 0);
  }
});

test('individual administrator detail retains the access-management gate and exposes no private identity fields', async () => {
  const f = fixture({ staff_id: null, business_role: 'business_admin', permissions: { 'payment:refund': true }, whatsapp_number: 'private-number' });
  const model = await f.service.get({ adminId: 1, principalId: 19 });
  assert.equal(model.person.editable, true);
  assert.ok(model.person.toggles.some(toggle => toggle.key === 'payment:refund' && toggle.on));
  assert.equal(JSON.stringify(model).includes('private-number'), false);
});

 test('the staged-save browser script parses and its endpoint keeps session, origin and CSRF guards', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const { clientScript } = require('../src/presentation/workspaceStaffAccessProfilesUx');
  assert.doesNotThrow(() => new vm.Script(clientScript()));
  assert.match(fs.readFileSync(require.resolve('../src/routes/workspaceStaffMutations'), 'utf8'), /router.post\('\/staff-access\/:id\/changes', \.\.\.mutationChain/);
});


test('clinic administrator can independently disable refunds and Reception approval on an unlinked administrator', async () => {
  const f = fixture({ staff_id: null, business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'payment:refund': true, 'appointment:create': true, 'appointment:record_past:crm_v2_client_ids': [91] } });
  assert.equal(project(f.row()).editable, true);
  assert.equal(project(f.row()).toggles.find(t => t.key === 'booking_requests:manage').on, true);
  const result = await f.save([{ key: 'payment:refund', on: false }, { key: 'booking_requests:manage', on: false }]);
  assert.equal(result.person.toggles.find(t => t.key === 'booking_requests:manage').on, false);
  assert.deepEqual(f.row().permissions, { 'payment:refund': false, 'booking_requests:manage': false, 'appointment:create': true, 'appointment:record_past:crm_v2_client_ids': [91] });
  assert.equal(require('../src/services/workspaceBookingRequestRouting').isDerivedGlobalCoordinator(f.row()), false);
  await f.save([{ key: 'booking_requests:manage', on: true }]);
  assert.equal(require('../src/services/workspaceBookingRequestRouting').isDerivedGlobalCoordinator(f.row()), true);
});

test('every displayed individual switch controls exactly one canonical capability', () => {
  for (const business_role of ['owner', 'business_admin', 'booking_operator', 'employee_practitioner', 'tenant_practitioner']) {
    const model = project(fixture({ business_role, calendar_scope: business_role.includes('practitioner') ? 'own_appointments' : 'all_business', service_scope: business_role.includes('practitioner') ? 'own_services' : 'all_services' }).row());
    for (const toggle of model.toggles) assert.deepEqual(toggle.capabilities, [toggle.key]);
    assert.equal(new Set(model.toggles.map(t => t.key)).size, model.toggles.length);
  }
});

test('Reception and practitioner boundaries cannot acquire administration grants', async () => {
  for (const business_role of ['booking_operator', 'employee_practitioner']) {
    const f = fixture({ business_role, calendar_scope: business_role === 'booking_operator' ? 'all_business' : 'own_appointments', service_scope: business_role === 'booking_operator' ? 'all_services' : 'own_services' });
    await assert.rejects(f.save([{ key: 'staff_access:manage', on: true }]), { code: 'STAFF_ACCESS_TOGGLE_UNSUPPORTED' });
    assert.ok(!f.calls.some(c => c.sql.startsWith('UPDATE')));
  }
});

test('individual access editor requires clinic administrator authority in addition to access-management capability', async () => {
  const f = fixture();
  const service = createWorkspaceStaffAccessProfilesService({ db: { query: async () => ({ rows: [f.row()] }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) }, accessService: { requireManageAccess: async () => ({ operatorAdminId: 1, businessRole: 'employee_practitioner', calendarScope: 'own_appointments' }) } });
  await assert.rejects(service.saveChanges({ adminId: 1, principalId: 19, expectedRevision: project(f.row()).revision, requestId: 'synthetic_block_123', changes: [{ key: 'client:lookup', on: false }] }), { code: 'STAFF_ACCESS_INDIVIDUAL_FORBIDDEN' });
  const own = await f.service.get({ adminId: 1, principalId: 19 });
  assert.equal(own.person.editable, true);
  assert.equal(project(f.row(), { operatorAdminId: 19 }).editable, false);
});

test('explicit Reception Off is honored by direct approval and routing, including owner role', async () => {
  const routing = require('../src/services/workspaceBookingRequestRouting');
  const approval = require('../src/services/clientBookingApproval');
  for (const business_role of ['owner', 'business_admin', 'booking_operator']) {
    const principal = { id: 7, business_role, calendar_scope: 'all_business', permissions: { 'appointment:create': true, 'booking_requests:manage': false } };
    assert.equal(routing.isDerivedGlobalCoordinator(principal), false);
    assert.equal(approval.operatorCanResolve(principal, {}), false);
    assert.deepEqual(await routing.coordinationScopeForPrincipal({ query: async () => { throw Error('Revoked queue must not be read'); } }, principal), { kind: 'none', teamId: null, teamName: null, explicit: false });
  }
});
