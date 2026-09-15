const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WorkspaceServicesError,
  evaluateServicesReadAuthority,
  evaluateServicesManageAuthority,
  isTenantAssignedServicesAuthority,
  serviceRevision,
  createWorkspaceServicesService,
} = require('../src/services/workspaceServices');

function result(rows = []) { return { rows, rowCount: rows.length }; }

function marietjiePrincipal(overrides = {}) {
  return {
    id: 81,
    staff_id: 55,
    display_name: 'Marietjie',
    business_role: 'tenant_practitioner',
    service_scope: 'all_services',
    permissions: { 'services:view': true, 'services:manage': true },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function serviceRow(id = 7, privateOwnerStaffId = null) {
  return {
    id,
    name: 'Tenant Treatment',
    duration_minutes: 60,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    variable_price: false,
    price: '650.00',
    display_price: null,
    status: 'active',
    category_name: 'Massage',
    customer_description: null,
    booking_note: null,
    assigned_staff_count: 1,
    client_bookable_staff_count: 1,
    private_owner_staff_id: privateOwnerStaffId,
  };
}

test('126 grants only Marietjie explicit Services view/manage authority while preserving #903 scopes', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '126_marietjie_workspace_services_manage.sql'),
    'utf8'
  );
  assert.match(sql, /LOWER\(a\.display_name\) = 'marietjie'/);
  assert.match(sql, /a\.business_role = 'tenant_practitioner'/);
  assert.match(sql, /a\.calendar_scope = 'all_business'/);
  assert.match(sql, /a\.service_scope = 'all_services'/);
  assert.match(sql, /staff:services:view/);
  assert.match(sql, /service:pricing/);
  assert.match(sql, /"services:view":true/);
  assert.match(sql, /"services:manage":true/);
  assert.doesNotMatch(sql, /services:create/);
  assert.doesNotMatch(sql, /SET\s+(?:calendar_scope|service_scope)\s*=/i);
  assert.match(sql, /expected exactly one active Marietjie tenant practitioner/);
});

test('tenant Services authority requires linked active staff and is assignment-bounded independently of #903 service scope', () => {
  const principal = marietjiePrincipal();
  const read = evaluateServicesReadAuthority([principal]);
  const manage = evaluateServicesManageAuthority([principal]);

  assert.equal(read.linkedStaffId, 55);
  assert.equal(read.businessRole, 'tenant_practitioner');
  assert.equal(read.serviceScope, 'all_services');
  assert.equal(manage.linkedStaffId, 55);
  assert.equal(isTenantAssignedServicesAuthority(read), true);
  assert.equal(isTenantAssignedServicesAuthority(manage), true);

  const legacyOwnScope = evaluateServicesReadAuthority([marietjiePrincipal({ service_scope: 'own_services' })]);
  assert.equal(legacyOwnScope.serviceScope, 'own_services');
  assert.equal(isTenantAssignedServicesAuthority(legacyOwnScope), true);
  assert.equal(evaluateServicesManageAuthority([marietjiePrincipal({ staff_id: null, staff_status: null })]), null);
});

test('tenant Services list is SQL-scoped to services assigned to the linked practitioner', async () => {
  const calls = [];
  const db = {
    async query(text, params = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      if (sql.includes('workspaceServices:principal')) return result([marietjiePrincipal()]);
      if (sql.includes('workspaceServices:list')) return result([serviceRow(7)]);
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const model = await createWorkspaceServicesService({ db }).listServices({ adminId: 81, status: 'all' });
  assert.deepEqual(model.services.map(service => service.id), [7]);
  const listCall = calls.find(call => call.sql.includes('workspaceServices:list'));
  assert.match(listCall.sql, /EXISTS \( SELECT 1 FROM staff_services scoped WHERE scoped\.service_id=svc\.id AND scoped\.staff_id=\$1 \)/);
  assert.match(listCall.sql, /visibility\.owner_staff_id IS NULL OR visibility\.owner_staff_id=\$1/);
  assert.equal(listCall.params[0], 55);
});

test('tenant service detail requires the service assignment before subordinate reads', async () => {
  const calls = [];
  const db = {
    async query(text, params = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      if (sql.includes('workspaceServices:principal')) return result([marietjiePrincipal()]);
      if (sql.includes('workspaceServices:detail')) return result([serviceRow(7)]);
      if (sql.includes('workspaceServices:staff')) {
        return result([{ id: 55, display_name: 'Marietjie', resource_type: 'practitioner', status: 'active', client_bookable: true }]);
      }
      if (sql.includes('workspaceServices:practitioners')) return result([]);
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const detail = await createWorkspaceServicesService({ db }).getServiceDetail({ adminId: 81, serviceId: 7 });
  assert.equal(detail.service.id, 7);
  const detailCall = calls.find(call => call.sql.includes('workspaceServices:detail'));
  assert.match(detailCall.sql, /EXISTS \( SELECT 1 FROM staff_services scoped WHERE scoped\.service_id=svc\.id AND scoped\.staff_id=\$2 \)/);
  assert.deepEqual(detailCall.params, [7, 55]);
});

test('Marietjie management can change an assigned service but cannot mutate an unassigned service', async () => {
  const calls = [];
  const target = serviceRow(7);
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return result();
    if (sql.includes('workspaceServices:principal')) return result([marietjiePrincipal()]);
    if (sql.includes('pg_advisory_xact_lock')) return result([{}]);
    if (sql.includes('workspaceServices:mutation-service')) {
      return Number(params[0]) === 7 ? result([target]) : result([]);
    }
    if (sql.includes('workspaceServices:mutation-assignments')) return result([{ staff_id: 55 }]);
    if (sql.startsWith('UPDATE services')) return result([{ ...target, status: params[1] }]);
    if (sql.startsWith('INSERT INTO crm_audit_events')) return result();
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release() {} };
  const service = createWorkspaceServicesService({ db: { query, async connect() { return client; } } });

  const updated = await service.setServiceStatus({
    adminId: 81,
    serviceId: 7,
    expectedRevision: serviceRevision(target, [55]),
    requestId: 'marietjie_scope_001',
    status: 'inactive',
  });
  assert.equal(updated.status, 'updated');
  const mutationCall = calls.find(call => call.sql.includes('workspaceServices:mutation-service') && Number(call.params[0]) === 7);
  assert.match(mutationCall.sql, /EXISTS \( SELECT 1 FROM staff_services scoped WHERE scoped\.service_id=svc\.id AND scoped\.staff_id=\$2 \)/);
  assert.deepEqual(mutationCall.params, [7, 55]);

  const beforeDenied = calls.length;
  await assert.rejects(
    service.setServiceStatus({
      adminId: 81,
      serviceId: 99,
      expectedRevision: '0'.repeat(64),
      requestId: 'marietjie_scope_002',
      status: 'inactive',
    }),
    error => error instanceof WorkspaceServicesError
      && error.code === 'WORKSPACE_SERVICE_NOT_FOUND'
      && error.httpStatus === 404
  );
  const deniedCalls = calls.slice(beforeDenied);
  const deniedTarget = deniedCalls.find(call => call.sql.includes('workspaceServices:mutation-service'));
  assert.deepEqual(deniedTarget.params, [99, 55]);
  assert.equal(deniedCalls.some(call => call.sql.includes('workspaceServices:mutation-assignments')), false);
  assert.equal(deniedCalls.some(call => call.sql.startsWith('UPDATE services')), false);
  assert.equal(deniedCalls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')), false);
  assert.equal(deniedCalls.some(call => call.sql === 'ROLLBACK'), true);
});
