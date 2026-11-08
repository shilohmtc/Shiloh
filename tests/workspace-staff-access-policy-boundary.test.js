const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { finalizeAppointment } = require('../src/services/adminAppointmentFinalization');
const { canCertifyAppointment } = require('../src/services/attendanceFinalizationAuthority');
const { createWorkspaceDashboardService } = require('../src/services/workspaceDashboard');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');
const { renderStaffDetailPage } = require('../src/presentation/workspaceStaffUx');
const { decorateStaffDetailAccessHtml, workspaceStaffAccessClientScript } = require('../src/presentation/workspaceStaffAccessUx');
const {
  PRACTITIONER_POLICY_CAPABILITIES,
  accessPolicyRevision,
  normalizeRequestedCapabilities,
  incompatibleReason,
  policyProjection,
  createWorkspaceStaffAccessPolicyService,
} = require('../src/services/workspaceStaffAccessPolicy');

const revision = '2026-09-05T06:30:00.000Z';
const practitionerStaff = { id: 17, display_name: 'Synthetic Practitioner', status: 'active', resource_type: 'practitioner', business_role: 'employee_practitioner' };
function practitionerAccess(permissions = { 'appointment:view': true }) {
  return { id: 201, staff_id: 17, role: 'practitioner', active: true, permissions, business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services' };
}
function principal(capability = true) {
  return { id: 91, staff_id: 17, display_name: 'Synthetic Practitioner', admin_active: true, staff_status: 'active',
    business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services',
    permissions: { 'appointment:view': true, 'booking:update': capability },
    calendarAuthority: { capabilities: ['appointment:view'], linkedStaffId: 17, businessRole: 'employee_practitioner', calendarScope: 'own_appointments', serviceScope: 'own_services' } };
}
function backupPrincipal() {
  return { id: 92, staff_id: null, display_name: 'Synthetic Owner', admin_active: true, staff_status: 'active',
    business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services',
    permissions: { 'appointment:view': true, 'booking:update': true } };
}
function finalizationDatabase(assigned) {
  const calls = [];
  const query = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    if (sql.startsWith('SELECT a.id FROM appointments a')) {
      assert.match(sql, /FOR UPDATE OF a/);
      assert.deepEqual(params, [51, null]);
      return { rows: [{ id: 51 }] };
    }
    if (sql.includes('FROM appointments a')) {
      assert.match(sql, /FOR UPDATE OF a/);
      assert.equal(params[0], false);
      assert.equal(params[1], 17);
      return { rows: [{ id: 51, client_id: 81, status: 'confirmed', updated_at: revision, starts_at: '2026-09-05T07:00:00Z', ends_at: '2026-09-05T08:00:00Z', total_price: 500 }] };
    }
    if (sql.includes('FROM staff')) return { rows: [{ id: 17 }] };
    if (sql.includes('FROM appointment_staff')) {
      const ids = sql.includes('staff_id IS NOT NULL') ? assigned.filter(id => id !== null) : assigned;
      return { rows: [...new Set(ids)].map(staff_id => ({ staff_id })) };
    }
    return { rows: [], rowCount: 1 };
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}
async function runFinalization(assigned, capability = true) {
  const db = finalizationDatabase(assigned);
  const service = createWorkspaceDashboardService({
    resolvePrincipal: async () => principal(capability),
    finalizeAppointmentFn: (admin, id, outcome, options) => finalizeAppointment(admin, id, outcome, { ...options, connectionPool: db }),
  });
  try {
    const result = await service.finalizeVisit({ adminId: 91, viewer: { calendarScope: 'own_staff', staffId: 17 }, appointmentId: 51, expectedRevision: revision, outcome: 'completed', paymentDecision: { choice: 'outstanding' }, now: new Date('2026-09-05T10:00:00Z') });
    return { result, db };
  } catch (error) { return { error, db }; }
}

function policyDatabase({ row = practitionerAccess(), staff = practitionerStaff } = {}) {
  const calls = [];
  let current = { ...row, permissions: { ...(row.permissions || {}) } };
  const query = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim(); calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('workspaceStaffAccessPolicy:target')) return { rows: staff ? [staff] : [], rowCount: staff ? 1 : 0 };
    if (sql.includes('workspaceStaffAccessPolicy:linked')) return { rows: current ? [current] : [], rowCount: current ? 1 : 0 };
    if (sql.startsWith('UPDATE staff_admin_accounts')) {
      const patch = JSON.parse(params[1]);
      current = { ...current, permissions: { ...current.permissions, ...patch } };
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO crm_audit_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected policy SQL: ${sql}`);
  };
  const client = { query, release() {} };
  return { calls, query, connect: async () => client, current: () => current };
}

const manageAccess = {
  requireManageAccess: async (adminId) => {
    if (Number(adminId) !== 61) {
      const error = new Error('Staff access management is not permitted.');
      error.code = 'WORKSPACE_STAFF_ACCESS_FORBIDDEN'; error.httpStatus = 403; throw error;
    }
    return { operatorAdminId: 61 };
  },
};

test('global Workspace finalizer retains own success and independently rejects other/shared/missing assignments', async () => {
  assert.equal((await runFinalization([17])).result.ok, true);
  for (const assigned of [[18], [17, 18], [], [null]]) {
    const { error, db } = await runFinalization(assigned);
    assert.equal(error.httpStatus, 403);
    assert.equal(db.calls.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
  }
});

test('lack of booking:update denies the real Dashboard-to-finalizer path before writes', async () => {
  const { error, db } = await runFinalization([17], false);
  assert.equal(error.httpStatus, 400);
  assert.equal(db.calls.length, 0);
});

test('#747 fails closed when own-practitioner finalization contains unresolved assignment evidence', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/005_crm_appointments_calendar.sql'), 'utf8');
  assert.match(migration, /staff_id BIGINT REFERENCES staff\(id\) ON DELETE SET NULL/);
  const { error, db } = await runFinalization([17, null]);
  assert.equal(error.httpStatus, 403);
  const authorityQuery = db.calls.find(c => c.sql.includes('FROM appointment_staff'));
  assert.ok(authorityQuery);
  assert.doesNotMatch(authorityQuery.sql, /staff_id IS NOT NULL/);
  assert.equal(db.calls.some(c => /^(UPDATE|INSERT)/.test(c.sql)), false);
});

test('#747 preserves owner/business-admin backup semantics while own-practitioner NULL evidence fails closed', async () => {
  for (const assigned of [[17], [18], [17, 18], [17, null], [18, null]]) {
    const db = finalizationDatabase(assigned);
    assert.equal(await canCertifyAppointment(backupPrincipal(), 51, db, { workspace: true, allowBusinessBackup: true }), true);
  }
  for (const assigned of [[], [null]]) {
    const db = finalizationDatabase(assigned);
    assert.equal(await canCertifyAppointment(backupPrincipal(), 51, db, { workspace: true, allowBusinessBackup: true }), false);
  }
});

test('#749 exposes only appointment:view plus booking:update and keeps appointment:view mandatory', () => {
  assert.deepEqual(PRACTITIONER_POLICY_CAPABILITIES, ['appointment:view', 'booking:update']);
  assert.deepEqual(normalizeRequestedCapabilities([]), ['appointment:view']);
  assert.deepEqual(normalizeRequestedCapabilities(['booking:update']), ['appointment:view', 'booking:update']);
  for (const forbidden of ['appointment:create', 'client:lookup', 'calendar:booking:reschedule', 'calendar:booking:cancel', 'calendar:booking:reassign', 'schedule:manage', 'staff:manage', 'staff_access:manage']) {
    assert.throws(() => normalizeRequestedCapabilities([forbidden]), error => error.code === 'WORKSPACE_STAFF_ACCESS_POLICY_CAPABILITY_FORBIDDEN' && error.httpStatus === 400);
  }
});

test('#749 renders the finalization toggle only for one compatible employee-practitioner principal', () => {
  const row = practitionerAccess();
  const policy = policyProjection(practitionerStaff, [row]);
  assert.equal(policy.supported, true);
  const model = {
    staff: { ...practitionerStaff, revision }, services: [],
    access: { businessRole: row.business_role, calendarScope: row.calendar_scope, serviceScope: row.service_scope, capabilities: ['appointment:view'] },
    accessManageAllowed: true, accessPolicy: policy,
  };
  const html = decorateStaffDetailAccessHtml(renderStaffDetailPage(model), model);
  assert.match(html, /data-access-policy-editor/);
  assert.match(html, /Complete \/ No-show visits/);
  assert.match(html, /value="booking:update"/);
  assert.match(html, /value="appointment:view" checked disabled/);
  assert.doesNotMatch(html, /value="(appointment:create|client:lookup|calendar:booking:reschedule|calendar:booking:cancel|calendar:booking:reassign|schedule:manage|staff:manage|staff_access:manage)"/);
  assert.match(workspaceStaffAccessClientScript(), /access\/policy/);
  assert.doesNotMatch(workspaceStaffAccessClientScript(), /window\.confirm|\bconfirm\(/);
});

test('#749 keeps business-admin, broader and incompatible principals read-only', () => {
  const broad = practitionerAccess({ 'appointment:view': true, 'staff:manage': true });
  broad.business_role = 'business_admin'; broad.calendar_scope = 'all_business'; broad.service_scope = 'all_services';
  assert.match(incompatibleReason(practitionerStaff, [broad]), /different role or scope/);
  const protectedCapability = practitionerAccess({ 'appointment:view': true, 'staff:manage': true });
  assert.match(incompatibleReason(practitionerStaff, [protectedCapability]), /protected or broader authority/);
  for (const row of [broad, protectedCapability]) {
    const policy = policyProjection(practitionerStaff, [row]);
    const model = { staff: { ...practitionerStaff, revision }, services: [], access: { businessRole: row.business_role, calendarScope: row.calendar_scope, serviceScope: row.service_scope, capabilities: Object.keys(row.permissions).filter(key => row.permissions[key]) }, accessManageAllowed: true, accessPolicy: policy };
    const html = decorateStaffDetailAccessHtml(renderStaffDetailPage(model), model);
    assert.match(html, /data-staff-access-readonly/);
    assert.doesNotMatch(html, /data-access-policy-editor|Save access/);
  }
});

test('#749 authorized policy mutation changes only the bounded permission keys and records audit evidence', async () => {
  const db = policyDatabase();
  const service = createWorkspaceStaffAccessPolicyService({ db, accessService: manageAccess });
  const expectedAccessRevision = accessPolicyRevision(practitionerAccess());
  const result = await service.updatePolicy({ adminId: 61, staffId: 17, expectedAccessRevision, requestId: 'req-749-allow', capabilities: ['booking:update'] });
  assert.equal(result.status, 'updated');
  assert.equal(db.current().permissions['appointment:view'], true);
  assert.equal(db.current().permissions['booking:update'], true);
  const update = db.calls.find(c => c.sql.startsWith('UPDATE staff_admin_accounts'));
  assert.ok(update);
  assert.match(update.sql, /SET permissions=/);
  assert.doesNotMatch(update.sql, /business_role|calendar_scope|service_scope|whatsapp|role=/);
  assert.deepEqual(JSON.parse(update.params[1]), { 'appointment:view': true, 'booking:update': true });
  const audit = db.calls.find(c => c.sql.startsWith('INSERT INTO crm_audit_events'));
  assert.ok(audit);
  const metadata = JSON.parse(audit.params[2]);
  assert.equal(metadata.requestId, 'req-749-allow');
  assert.deepEqual(metadata.beforeCapabilities, ['appointment:view']);
  assert.deepEqual(metadata.afterCapabilities, ['appointment:view', 'booking:update']);
  assert.equal(metadata.credentialMaterialChanged, false);
  assert.equal(metadata.whatsappIdentityChanged, false);
});

test('#749 unauthorized operator and stale revision fail closed before permission update', async () => {
  const staleRevision = '0'.repeat(64);
  for (const [adminId, expected] of [[77, accessPolicyRevision(practitionerAccess())], [61, staleRevision]]) {
    const db = policyDatabase();
    const service = createWorkspaceStaffAccessPolicyService({ db, accessService: manageAccess });
    await assert.rejects(
      service.updatePolicy({ adminId, staffId: 17, expectedAccessRevision: expected, requestId: `req-749-${adminId}`, capabilities: ['booking:update'] }),
      error => [403, 409].includes(error.httpStatus)
    );
    assert.equal(db.calls.some(c => c.sql.startsWith('UPDATE staff_admin_accounts')), false);
  }
});

test('#749 policy endpoint preserves session/origin/CSRF chain and delegates only bounded policy payload', async () => {
  const calls = [];
  const app = express(); app.use(express.json());
  app.use('/calendar/team', createWorkspaceStaffMutationRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService: { validateSessionToken: async () => ({ ok: true, adminId: 61 }), validateCsrfToken: () => true },
    service: {}, accessService: {}, accessCompletionService: {},
    accessPolicyService: { updatePolicy: async payload => { calls.push(payload); return { status: 'updated' }; } },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/calendar/team/17/access/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie: 'shiloh_staff_session=synthetic', 'x-shiloh-csrf-token': 'synthetic' },
      body: JSON.stringify({ requestId: 'req-route-749', expectedAccessRevision: 'rev-749', capabilities: ['booking:update'], business_role: 'owner', calendar_scope: 'all_business' }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { adminId: 61, staffId: '17', expectedAccessRevision: 'rev-749', requestId: 'req-route-749', capabilities: ['booking:update'] });
  } finally { await new Promise(r => server.close(r)); }
});
