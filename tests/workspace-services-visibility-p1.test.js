const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WorkspaceServicesError,
  evaluateServicesReadAuthority,
  evaluateServicesManageAuthority,
  serviceRevision,
  createWorkspaceServicesService,
} = require('../src/services/workspaceServices');

function result(rows = []) { return { rows, rowCount: rows.length }; }

function principal({
  role = 'owner',
  staffId = null,
  serviceScope = role === 'tenant_practitioner' ? 'own_services' : 'all_services',
  permissions = { 'services:view': true, 'services:manage': true },
} = {}) {
  return {
    id: 71,
    staff_id: staffId,
    display_name: 'Visibility Operator',
    business_role: role,
    service_scope: serviceScope,
    permissions,
    admin_active: true,
    staff_status: staffId ? 'active' : null,
  };
}

function serviceRow(id, privateOwnerStaffId = null) {
  return {
    id,
    name: `Service ${id}`,
    duration_minutes: 45,
    processing_time_minutes: 0,
    extra_time_minutes: 0,
    variable_price: false,
    price: '450.00',
    display_price: 'R450',
    status: 'active',
    category_name: 'Massage',
    assigned_staff_count: 1,
    client_bookable_staff_count: 1,
    private_owner_staff_id: privateOwnerStaffId,
  };
}

function readDb({ admin, listRows = [], detailRow = null } = {}) {
  const calls = [];
  const db = {
    async query(text, params = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      if (sql.includes('workspaceServices:principal')) return result(admin ? [admin] : []);
      if (sql.includes('workspaceServices:list')) return result(listRows);
      if (sql.includes('workspaceServices:detail')) return result(detailRow ? [detailRow] : []);
      if (sql.includes('workspaceServices:staff')) return result([]);
      if (sql.includes('workspaceServices:practitioners')) return result([]);
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { db, calls };
}

function mutationDb({ admin, target } = {}) {
  const calls = [];
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return result();
    if (sql.includes('workspaceServices:principal')) return result(admin ? [admin] : []);
    if (sql.includes('pg_advisory_xact_lock')) return result([{}]);
    if (sql.includes('workspaceServices:mutation-service')) return result(target ? [target] : []);
    if (sql.includes('workspaceServices:mutation-assignments')) return result([{ staff_id: 11 }]);
    if (sql.startsWith('UPDATE services')) throw new Error('Target mutation must not execute in visibility-denial test');
    if (sql.startsWith('INSERT INTO crm_audit_events')) throw new Error('Audit must not execute in visibility-denial test');
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release() {} };
  return { db: { query, async connect() { return client; } }, calls };
}

test('Workspace Services authority carries canonical business role, service scope and linked staff context', () => {
  const tenant = principal({ role: 'tenant_practitioner', staffId: 11 });
  const read = evaluateServicesReadAuthority([tenant]);
  const manage = evaluateServicesManageAuthority([tenant]);
  assert.equal(read.businessRole, 'tenant_practitioner');
  assert.equal(read.serviceScope, 'own_services');
  assert.equal(read.linkedStaffId, 11);
  assert.equal(manage.businessRole, 'tenant_practitioner');
  assert.equal(manage.serviceScope, 'own_services');
  assert.equal(manage.linkedStaffId, 11);
});

test('Workspace Services list preserves visibility and SQL-scopes tenant practitioners to assigned services', async () => {
  const rows = [serviceRow(1, null), serviceRow(2, 11), serviceRow(3, 12)];

  const owner = readDb({ admin: principal({ role: 'owner' }), listRows: rows });
  const ownerList = await createWorkspaceServicesService({ db: owner.db }).listServices({ adminId: 71, status: 'all' });
  assert.deepEqual(ownerList.services.map(row => row.id), [1]);
  assert.match(owner.calls.find(call => call.sql.includes('workspaceServices:list')).sql, /visibility\.owner_staff_id IS NULL/);

  const booking = readDb({ admin: principal({ role: 'booking_operator' }), listRows: rows });
  const bookingList = await createWorkspaceServicesService({ db: booking.db }).listServices({ adminId: 71, status: 'all' });
  assert.deepEqual(bookingList.services.map(row => row.id), [1, 2, 3]);

  const tenant = readDb({ admin: principal({ role: 'tenant_practitioner', staffId: 11 }), listRows: rows });
  const tenantList = await createWorkspaceServicesService({ db: tenant.db }).listServices({ adminId: 71, status: 'all' });
  assert.deepEqual(tenantList.services.map(row => row.id), [1, 2]);
  const tenantSql = tenant.calls.find(call => call.sql.includes('workspaceServices:list'));
  assert.match(tenantSql.sql, /EXISTS \( SELECT 1 FROM staff_services scoped WHERE scoped\.service_id=svc\.id AND scoped\.staff_id=\$1 \)/);
  assert.match(tenantSql.sql, /visibility\.owner_staff_id=\$1/);
  assert.equal(tenantSql.params[0], 11);

  for (const model of [ownerList, bookingList, tenantList]) {
    assert.equal(model.services.some(row => Object.prototype.hasOwnProperty.call(row, 'private_owner_staff_id')), false);
  }
});

test('tenant-private detail is hidden from unrelated principals and missing tenant linkage fails before any service read', async () => {
  const unrelated = readDb({ admin: principal({ role: 'business_admin' }), detailRow: serviceRow(2, 11) });
  await assert.rejects(
    createWorkspaceServicesService({ db: unrelated.db }).getServiceDetail({ adminId: 71, serviceId: 2 }),
    error => error instanceof WorkspaceServicesError && error.code === 'WORKSPACE_SERVICE_NOT_FOUND' && error.httpStatus === 404
  );
  assert.equal(unrelated.calls.some(call => call.sql.includes('workspaceServices:staff')), false);
  assert.equal(unrelated.calls.some(call => call.sql.includes('workspaceServices:practitioners')), false);

  const missingLink = readDb({ admin: principal({ role: 'tenant_practitioner' }), detailRow: serviceRow(2, 11) });
  await assert.rejects(
    createWorkspaceServicesService({ db: missingLink.db }).getServiceDetail({ adminId: 71, serviceId: 2 }),
    error => error instanceof WorkspaceServicesError && error.code === 'WORKSPACE_SERVICES_FORBIDDEN' && error.httpStatus === 403
  );
  assert.equal(missingLink.calls.some(call => call.sql.includes('workspaceServices:detail')), false);
  assert.equal(missingLink.calls.some(call => call.sql.includes('workspaceServices:staff')), false);
  assert.equal(missingLink.calls.some(call => call.sql.includes('workspaceServices:practitioners')), false);

  const own = readDb({ admin: principal({ role: 'tenant_practitioner', staffId: 11 }), detailRow: serviceRow(2, 11) });
  const detail = await createWorkspaceServicesService({ db: own.db }).getServiceDetail({ adminId: 71, serviceId: 2 });
  assert.equal(detail.service.id, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(detail.service, 'private_owner_staff_id'), false);
  const ownDetailSql = own.calls.find(call => call.sql.includes('workspaceServices:detail'));
  assert.match(ownDetailSql.sql, /EXISTS \( SELECT 1 FROM staff_services scoped WHERE scoped\.service_id=svc\.id AND scoped\.staff_id=\$2 \)/);
  assert.deepEqual(ownDetailSql.params, [2, 11]);
});

test('crafted mutation against invisible tenant-private service fails before revision, assignment read, mutation or audit', async () => {
  const target = serviceRow(9, 11);
  const fake = mutationDb({ admin: principal({ role: 'owner' }), target });
  const service = createWorkspaceServicesService({ db: fake.db });
  await assert.rejects(
    service.setServiceStatus({
      adminId: 71,
      serviceId: 9,
      expectedRevision: serviceRevision(target, [11]),
      requestId: 'visibility_001',
      status: 'inactive',
    }),
    error => error.code === 'WORKSPACE_SERVICE_NOT_FOUND' && error.httpStatus === 404
  );
  assert.equal(fake.calls.some(call => call.sql.includes('workspaceServices:mutation-assignments')), false);
  assert.equal(fake.calls.some(call => call.sql.startsWith('UPDATE services')), false);
  assert.equal(fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')), false);
  assert.equal(fake.calls.some(call => call.sql === 'ROLLBACK'), true);
});

test('visibility never grants mutation authority: visible booking operator without services:manage is denied before target read', async () => {
  const fake = mutationDb({
    admin: principal({ role: 'booking_operator', permissions: { 'services:view': true } }),
    target: serviceRow(9, 11),
  });
  await assert.rejects(
    createWorkspaceServicesService({ db: fake.db }).setServiceStatus({
      adminId: 71,
      serviceId: 9,
      expectedRevision: '0'.repeat(64),
      requestId: 'visibility_002',
      status: 'inactive',
    }),
    error => error.code === 'WORKSPACE_SERVICES_MANAGE_FORBIDDEN' && error.httpStatus === 403
  );
  assert.equal(fake.calls.some(call => call.sql.includes('workspaceServices:mutation-service')), false);
});
