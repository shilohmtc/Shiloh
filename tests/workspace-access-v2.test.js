const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  RECEPTION_PRESET: RECEPTION_ACCESS_PRESET,
  FORBIDDEN_RECEPTION_CAPABILITIES: RECEPTION_FORBIDDEN_CAPABILITIES,
  expectedPermissions: receptionPermissions,
  isExactReceptionPrincipal: isReceptionPreset,
} = require('../src/services/workspaceReceptionAccess');
const {
  ACCESS_V2_LOCK_BASE,
  principalRevision,
  principalProjection,
  groupedCapabilities,
  practitionerPresetPermissions,
  createWorkspaceAccessV2Service,
} = require('../src/services/workspaceAccessV2');
const { renderAccessListPage, renderAccessDetailPage } = require('../src/presentation/workspaceAccessV2Ux');
const { dashboardAuthority } = require('../src/services/workspaceDashboard');
const { operatorCanResolve } = require('../src/services/clientBookingApproval');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');

const ENV = { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' };
const practitioner = (id, staffId, name, permissions = { 'appointment:view': true }) => ({
  id, staff_id: staffId, display_name: name, role: 'practitioner', active: true, permissions,
  business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services',
  staff_display_name: name, staff_status: 'active', staff_resource_type: 'practitioner', staff_business_role: 'employee_practitioner',
});
const reception = (overrides = {}) => ({
  id: 30, staff_id: null, display_name: 'Shiloh Reception', role: 'receptionist', active: true,
  permissions: receptionPermissions(), business_role: 'booking_operator', calendar_scope: 'all_business', service_scope: 'all_services',
  staff_display_name: null, staff_status: null, staff_resource_type: null, staff_business_role: null, ...overrides,
});
const accessAuthority = {
  async requireManageAccess(adminId) {
    if (Number(adminId) !== 1) { const error = new Error('forbidden'); error.httpStatus = 403; throw error; }
    return { operatorAdminId: 1, capability: 'staff_access:manage', displayName: 'Access admin' };
  },
  async resolveManageAccess(adminId) { return Number(adminId) === 1 ? { operatorAdminId: 1 } : null; },
};

function fakeDb(seed = []) {
  const state = { rows: new Map(seed.map(row => [Number(row.id), { ...row, permissions: { ...(row.permissions || {}) } }])), calls: [], audits: [], nextId: 100 };
  const hydrate = row => row ? { ...row } : null;
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim(); state.calls.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceAccessV2:list')) return { rows: [...state.rows.values()].map(hydrate), rowCount: state.rows.size };
    if (sql.includes('workspaceAccessV2:principal')) { const row = state.rows.get(Number(params[0])); return { rows: row ? [hydrate(row)] : [], rowCount: row ? 1 : 0 }; }
    if (sql.includes('workspaceAccessV2:linked-count')) { const rows = [...state.rows.values()].filter(row => Number(row.staff_id) === Number(params[0])).slice(0, 2); return { rows, rowCount: rows.length }; }
    if (sql.includes('workspaceAccessV2:reception-count') || sql.includes('workspaceReceptionAccess:principal') || sql.startsWith('SELECT id FROM staff_admin_accounts WHERE LOWER')) { const rows = [...state.rows.values()].filter(row => row.display_name.trim().toLowerCase() === 'shiloh reception' || row.business_role === 'booking_operator').slice(0, 4); return { rows, rowCount: rows.length }; }
    if (sql.includes('workspaceAccessV2:copy-sources')) { const rows = [...state.rows.values()].filter(row => row.id !== Number(params[0]) && row.staff_id && row.active); return { rows, rowCount: rows.length }; }
    if (sql.startsWith('SELECT id FROM staff WHERE LOWER')) return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceReceptionAccess:number-owner') || sql.startsWith('SELECT id FROM staff_admin_accounts WHERE normalized_whatsapp')) { const rows = [...state.rows.values()].filter(row => row.normalized_whatsapp === params[0]); return { rows, rowCount: rows.length }; }
    if (sql.startsWith('UPDATE staff_admin_accounts SET role=')) { const row = state.rows.get(Number(params[0])); Object.assign(row, { role: params[1], business_role: params[2], calendar_scope: params[3], service_scope: params[4], permissions: JSON.parse(params[5]) }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE staff_admin_accounts SET active=')) { const row = state.rows.get(Number(params[0])); row.active = params[1]; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO crm_audit_events')) { const literalReception = sql.includes("'workspace.reception_access_created'"); state.audits.push(literalReception ? { actor: params[0], action: 'workspace.reception_access_created', target: params[1], metadata: JSON.parse(params[2]) } : { actor: params[0], action: params[1], target: params[2], metadata: JSON.parse(params[3]) }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO staff_admin_accounts')) { const row = reception({ id: state.nextId++, whatsapp_number: params[2], normalized_whatsapp: params[3], permissions: JSON.parse(params[4]) }); state.rows.set(row.id, row); return { rows: [hydrate(row)], rowCount: 1 }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { state, db: { query, connect: async () => ({ query, release() {} }) } };
}

test('Reception is one exact shared-principal preset with Christel capability parity', () => {
  assert.deepEqual({ role: RECEPTION_ACCESS_PRESET.role, businessRole: RECEPTION_ACCESS_PRESET.businessRole, calendarScope: RECEPTION_ACCESS_PRESET.calendarScope, serviceScope: RECEPTION_ACCESS_PRESET.serviceScope },
    { role: 'receptionist', businessRole: 'booking_operator', calendarScope: 'all_business', serviceScope: 'all_services' });
  for (const key of ['staff:manage', 'staff_access:manage', 'staff_auth:reset', 'client:delete', 'service:pricing']) assert.equal(RECEPTION_ACCESS_PRESET.capabilities.includes(key), true);
  for (const key of RECEPTION_FORBIDDEN_CAPABILITIES) assert.equal(RECEPTION_ACCESS_PRESET.capabilities.includes(key), false);
  assert.equal(isReceptionPreset(reception()), true);
  assert.equal(isReceptionPreset(reception({ permissions: { ...receptionPermissions(), 'staff:manage': false } })), false);
  assert.equal(isReceptionPreset(reception({ permissions: { ...receptionPermissions(), 'unknown:power': true } })), false);
});

test('Access projection distinguishes Staff-linked and non-Staff principals without private identity or credential fields', () => {
  const linked = principalProjection(practitioner(20, 7, 'Naomi')); const shared = principalProjection(reception());
  assert.equal(linked.principalType, 'staff_linked'); assert.equal(linked.preset.label, 'Practitioner');
  assert.equal(shared.principalType, 'shared_or_other'); assert.equal(shared.principalLabel, 'Shared operational principal');
  assert.ok(groupedCapabilities(receptionPermissions()).find(group => group.label === 'Calendar'));
  const html = renderAccessDetailPage({ principal: shared, copySources: [], authority: { operatorAdminId: 1 } });
  assert.match(html, /Reception/); assert.match(html, /Advanced capability details/); assert.match(html, /@media\(max-width:700px\)/);
  assert.doesNotMatch(html, /whatsapp_number|normalized_whatsapp|totp|recovery|session token|27821234567/i);
});

test('list shows Staff-linked and Shared/Other sections and only offers Reception creation when absent', async () => {
  const fake = fakeDb([practitioner(20, 7, 'Naomi'), reception()]);
  const model = await createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority }).listPrincipals({ adminId: 1 });
  assert.equal(model.staffLinked.length, 1); assert.equal(model.sharedOrOther.length, 1); assert.equal(model.receptionPresent, true);
  const html = renderAccessListPage(model);
  assert.match(html, /Staff-linked access/); assert.match(html, /Other Workspace access/); assert.doesNotMatch(html, /Create Reception access/);
});

test('Practitioner preset revokes broader target policy without changing identity and exact replay is a no-op', async () => {
  const target = practitioner(20, 7, 'Naomi', { 'appointment:view': true, 'booking:update': true, 'staff:manage': true });
  Object.assign(target, { role: 'receptionist', business_role: 'booking_operator', calendar_scope: 'all_business', service_scope: 'all_services' });
  const fake = fakeDb([target]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  const result = await service.applyPreset({ adminId: 1, principalId: 20, expectedRevision: principalRevision(target), requestId: 'request_788_preset', preset: 'employee_practitioner_v1' });
  assert.equal(result.status, 'updated'); assert.deepEqual(fake.state.rows.get(20).permissions, practitionerPresetPermissions());
  const update = fake.state.calls.find(call => call.sql.startsWith('UPDATE staff_admin_accounts SET role=')); assert.doesNotMatch(update.sql, /whatsapp|normalized|totp|recovery/i);
  assert.equal(fake.state.audits[0].metadata.identityChanged, false);
  const calls = fake.state.calls.length;
  const replay = await service.applyPreset({ adminId: 1, principalId: 20, expectedRevision: principalRevision(fake.state.rows.get(20)), requestId: 'request_788_replay', preset: 'employee_practitioner_v1' });
  assert.equal(replay.status, 'unchanged'); assert.equal(fake.state.audits.length, 1);
  assert.equal(fake.state.calls.slice(calls).some(call => call.sql.startsWith('UPDATE staff_admin_accounts')), false);
});

test('copy previews before save and copies explicit compatible policy only', async () => {
  const target = practitioner(20, 7, 'Naomi');
  const source = practitioner(21, 8, 'ILince', { 'appointment:view': true, 'booking:update': true, 'protected:condition': [88], 'staff:manage': false });
  const fake = fakeDb([target, source]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  const input = { adminId: 1, principalId: 20, sourcePrincipalId: 21, expectedRevision: principalRevision(target), expectedSourceRevision: principalRevision(source) };
  const preview = await service.previewCopy(input);
  assert.deepEqual(preview.before.capabilities, ['appointment:view']); assert.deepEqual(preview.after.capabilities, ['appointment:view', 'booking:update']);
  assert.equal(preview.identityCopied, false); assert.equal(preview.credentialsCopied, false);
  const result = await service.copyAccess({ ...input, requestId: 'request_788_copy' });
  assert.equal(result.status, 'updated'); assert.deepEqual(fake.state.rows.get(20).permissions, { 'appointment:view': true, 'booking:update': true });
  assert.equal(fake.state.rows.get(20).display_name, 'Naomi'); assert.equal(fake.state.rows.get(20).staff_id, 7);
  assert.equal(fake.state.audits[0].metadata.sourcePrincipalId, 21); assert.equal(fake.state.audits[0].metadata.credentialMaterialChanged, false);
});

test('copy ambiguity fails before policy writes', async () => {
  const target = practitioner(20, 7, 'Naomi'); const source = practitioner(21, 8, 'ILince');
  const fake = fakeDb([target, source, practitioner(22, 7, 'Duplicate Naomi')]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  await assert.rejects(service.previewCopy({ adminId: 1, principalId: 20, sourcePrincipalId: 21, expectedRevision: principalRevision(target), expectedSourceRevision: principalRevision(source) }), error => error.code === 'WORKSPACE_ACCESS_AMBIGUOUS');
  assert.equal(fake.state.calls.some(call => call.sql.startsWith('UPDATE staff_admin_accounts')), false);
});

test('stale and unauthorized changes write nothing; reciprocal copy locks use canonical ID order', async () => {
  const source = practitioner(10, 8, 'ILince', { 'appointment:view': true, 'booking:update': true }); const target = practitioner(20, 7, 'Naomi');
  const fake = fakeDb([source, target]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  await assert.rejects(service.applyPreset({ adminId: 1, principalId: 20, expectedRevision: '0'.repeat(64), requestId: 'request_788_stale', preset: 'employee_practitioner_v1' }), error => error.code === 'WORKSPACE_ACCESS_STALE');
  await assert.rejects(service.applyPreset({ adminId: 2, principalId: 20, expectedRevision: principalRevision(target), requestId: 'request_788_denied', preset: 'employee_practitioner_v1' }), error => error.httpStatus === 403);
  assert.equal(fake.state.calls.some(call => call.sql.startsWith('UPDATE staff_admin_accounts')), false);
  await service.copyAccess({ adminId: 1, principalId: 20, sourcePrincipalId: 10, expectedRevision: principalRevision(target), expectedSourceRevision: principalRevision(source), requestId: 'request_788_lock_order' });
  const locks = fake.state.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).slice(-2).map(call => call.params[0]);
  assert.deepEqual(locks, [ACCESS_V2_LOCK_BASE + 10, ACCESS_V2_LOCK_BASE + 20]);
});

test('an Access administrator cannot alter their own canonical authority', async () => {
  const self = practitioner(1, 7, 'Access administrator'); const fake = fakeDb([self]);
  await assert.rejects(createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority }).applyPreset({ adminId: 1, principalId: 1, expectedRevision: principalRevision(self), requestId: 'request_788_self', preset: 'employee_practitioner_v1' }), error => error.code === 'WORKSPACE_ACCESS_SELF_CHANGE_FORBIDDEN');
  assert.equal(fake.state.calls.some(call => call.sql.startsWith('UPDATE staff_admin_accounts')), false);
});

test('disable and re-enable preserve stored identity and authority; protected principals fail closed', async () => {
  const target = practitioner(20, 7, 'Naomi'); const fake = fakeDb([target]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  const disabled = await service.setActive({ adminId: 1, principalId: 20, expectedRevision: principalRevision(target), requestId: 'request_788_disable', active: false });
  assert.equal(disabled.status, 'disabled'); assert.deepEqual(fake.state.rows.get(20).permissions, target.permissions);
  const reen = await service.setActive({ adminId: 1, principalId: 20, expectedRevision: principalRevision(fake.state.rows.get(20)), requestId: 'request_788_reenable', active: true });
  assert.equal(reen.status, 'enabled'); assert.deepEqual(fake.state.rows.get(20).permissions, target.permissions);
  const owner = reception({ id: 40, display_name: 'Owner', role: 'admin', business_role: 'owner', permissions: { 'staff_access:manage': true } }); fake.state.rows.set(40, owner);
  await assert.rejects(service.setActive({ adminId: 1, principalId: 40, expectedRevision: principalRevision(owner), requestId: 'request_788_owner', active: false }), error => error.code === 'WORKSPACE_ACCESS_STATUS_PROTECTED');
});

test('Reception creation is fixed, transactional, idempotent and audits no mobile or secret', async () => {
  const fake = fakeDb([]); const service = createWorkspaceAccessV2Service({ db: fake.db, accessService: accessAuthority });
  const created = await service.createReception({ adminId: 1, requestId: 'request_788_reception', whatsappNumber: '082 123 4567', identityConfirmed: true });
  assert.equal(created.status, 'created'); assert.equal(created.access.staffLinked, false); assert.equal(isReceptionPreset([...fake.state.rows.values()][0]), true);
  assert.doesNotMatch(JSON.stringify(fake.state.audits[0]), /27821234567|totp|recovery/i);
  const repeated = await service.createReception({ adminId: 1, requestId: 'request_788_reception_again', whatsappNumber: '082 123 4567', identityConfirmed: true });
  assert.equal(repeated.status, 'unchanged'); assert.equal(fake.state.rows.size, 1); assert.equal(fake.state.audits.length, 1);
});

test('Reception gets all-business Dashboard and Christel-equivalent finalization from explicit capabilities', () => {
  const principal = { ...reception(), calendarAuthority: { businessRole: 'booking_operator', calendarScope: 'all_business', capabilities: ['appointment:view'], linkedStaffId: null } };
  const authority = dashboardAuthority(principal);
  assert.equal(authority.mode, 'business_overview'); assert.equal(authority.canFinalize, true);
  assert.equal(operatorCanResolve(principal, { approver_staff_id: 99 }), true);
  const denied = { ...principal, permissions: { ...principal.permissions, 'appointment:create': false } };
  assert.equal(operatorCanResolve(denied, { approver_staff_id: 99 }), false);
});

test('Access V2 routes retain session, same-origin and CSRF and ignore arbitrary authority payloads', async () => {
  const calls = []; const app = express(); app.use(express.json());
  app.use('/calendar/team', createWorkspaceStaffMutationRouter({ env: ENV,
    sessionService: { validateSessionToken: async () => ({ ok: true, adminId: 1 }), validateCsrfToken: () => true },
    service: {}, accessService: {}, accessCompletionService: {}, accessPolicyService: {},
    accessV2Service: { applyPreset: async payload => { calls.push(payload); return { status: 'updated' }; } },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauthorized = await fetch(`${origin}/calendar/team/workspace-access/20/preset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(unauthorized.status, 403);
    const response = await fetch(`${origin}/calendar/team/workspace-access/20/preset`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: 'shiloh_staff_session=test', 'x-shiloh-csrf-token': 'test' }, body: JSON.stringify({ requestId: 'request_route_788', expectedRevision: 'a'.repeat(64), preset: 'employee_practitioner_v1', permissions: { 'staff_access:manage': true }, role: 'owner' }) });
    assert.equal(response.status, 200); assert.deepEqual(calls[0], { adminId: 1, principalId: '20', requestId: 'request_route_788', expectedRevision: 'a'.repeat(64), preset: 'employee_practitioner_v1' });
  } finally { await new Promise(resolve => server.close(resolve)); }
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/workspaceStaffMutations.js'), 'utf8');
  assert.match(source, /sameOriginGuard[\s\S]*csrfGuard/); assert.doesNotMatch(source, /req\.body\?\.permissions|req\.body\?\.role|req\.body\?\.businessRole/);
});