const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const {
  SERVICES_CREATE_CAPABILITY,
  evaluateCreatePrincipal,
  normalizeCreatePayload,
  createWorkspaceServiceCreationService,
} = require('../src/services/workspaceServiceCreation');

function principal(overrides = {}) {
  return {
    id: 40,
    staff_id: null,
    display_name: 'Operator',
    business_role: 'booking_operator',
    permissions: { 'services:create': true },
    admin_active: true,
    staff_status: null,
    staff_resource_type: null,
    ...overrides,
  };
}

function fakeDb({ role = 'booking_operator', linkedStaffId = null, practitionerIds = [11], tenantOwner = null, duplicate = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('workspaceServiceCreation:principal')) return { rows: [principal({
        business_role: role,
        staff_id: linkedStaffId,
        staff_status: linkedStaffId ? 'active' : null,
        staff_resource_type: linkedStaffId ? 'practitioner' : null,
      })] };
      if (sql.includes('workspaceServiceCreation:practitioners')) return { rows: practitionerIds.map(id => ({ id, display_name: `P${id}`, status: 'active', resource_type: 'practitioner' })) };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('LOWER(BTRIM(name))')) return { rows: duplicate ? [{ id: 8 }] : [] };
      if (sql.includes('INSERT INTO services(')) return { rows: [{ id: 99, name: values[0], duration_minutes: Number(values[1]), processing_time_minutes: 0, extra_time_minutes: 0, variable_price: values[2], price: values[3], display_price: values[4], customer_description: values[5], status: 'active' }] };
      if (sql.includes('INSERT INTO staff_services')) return { rows: [] };
      if (sql.includes("business_role='tenant_practitioner'")) return { rows: tenantOwner ? [{ staff_id: tenantOwner }] : [] };
      if (sql.includes('INSERT INTO service_visibility_policies')) return { rows: [] };
      if (sql.includes('INSERT INTO crm_audit_events')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { calls.push({ sql: 'RELEASE', values: [] }); },
  };
  return {
    calls,
    db: { query: client.query.bind(client), async connect() { return client; } },
  };
}

test('services:create is narrow canonical authority and does not depend on display name', () => {
  assert.equal(SERVICES_CREATE_CAPABILITY, 'services:create');
  for (const role of ['owner', 'business_admin', 'booking_operator']) {
    assert.equal(evaluateCreatePrincipal([principal({ business_role: role })])?.businessRole, role);
  }
  assert.equal(evaluateCreatePrincipal([principal({ display_name: 'Renamed operator' })])?.businessRole, 'booking_operator');
  assert.equal(evaluateCreatePrincipal([principal({ permissions: {} })]), null);
  assert.equal(evaluateCreatePrincipal([principal({ business_role: 'unknown' })]), null);
  assert.equal(evaluateCreatePrincipal([principal({ business_role: 'tenant_practitioner' })]), null);
  assert.equal(evaluateCreatePrincipal([principal({ business_role: 'tenant_practitioner', staff_id: 11, staff_status: 'active', staff_resource_type: 'practitioner' })])?.linkedStaffId, 11);
});

test('creation pricing validates fixed and variable price policy explicitly', () => {
  const description = 'A clear customer-facing description for this service.';
  assert.throws(() => normalizeCreatePayload({ name: 'A', durationMinutes: 60, staffIds: [1], price: '', variablePrice: false, customerDescription: description }), /requires a price/i);
  assert.throws(() => normalizeCreatePayload({ name: 'A', durationMinutes: 0, staffIds: [1], price: 100, variablePrice: false, customerDescription: description }), /between 1 and 1440/i);
  assert.throws(() => normalizeCreatePayload({ name: 'A', durationMinutes: 60, staffIds: [1], price: 100, variablePrice: false, customerDescription: 'Too short' }), /between 20 and 2000/i);
  const variable = normalizeCreatePayload({ name: 'Variable', durationMinutes: 45, staffIds: [1], price: '', displayPrice: 'From R500', variablePrice: true, customerDescription: description });
  assert.equal(variable.price, null);
  assert.equal(variable.displayPrice, 'From R500');
  assert.equal(variable.variablePrice, true);
});

test('tenant practitioner creates only own canonical tenant-private service', async () => {
  const { db, calls } = fakeDb({ role: 'tenant_practitioner', linkedStaffId: 11, practitionerIds: [11], tenantOwner: 11 });
  const service = createWorkspaceServiceCreationService({ db });
  const result = await service.createService({ adminId: 40, requestId: 'request_1234', name: 'Tenant Custom', durationMinutes: 50, price: '550', variablePrice: false, customerDescription: 'A tailored service with clear client-facing information.', staffIds: [11] });
  assert.equal(result.status, 'created');
  assert.equal(result.service.privateOwnerStaffId, 11);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO services(')));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO staff_services')));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO service_visibility_policies')));
  assert.ok(calls.some(call => call.sql.includes("'workspace.service_created'")));
  assert.equal(calls.filter(call => call.sql === 'COMMIT').length, 1);

  const denied = fakeDb({ role: 'tenant_practitioner', linkedStaffId: 11, practitionerIds: [12] });
  await assert.rejects(
    createWorkspaceServiceCreationService({ db: denied.db }).createService({ adminId: 40, requestId: 'request_5678', name: 'Wrong Target', durationMinutes: 50, price: '550', variablePrice: false, customerDescription: 'A tailored service with clear client-facing information.', staffIds: [12] }),
    error => error.code === 'WORKSPACE_SERVICES_CREATE_SCOPE_DENIED' && error.httpStatus === 403
  );
  assert.equal(denied.calls.some(call => call.sql.includes('INSERT INTO services(')), false);
  assert.equal(denied.calls.filter(call => call.sql === 'ROLLBACK').length, 1);
});

test('booking operator can create an ordinary shared service without gaining services:manage', async () => {
  const { db, calls } = fakeDb({ practitionerIds: [11, 12] });
  const service = createWorkspaceServiceCreationService({ db });
  const result = await service.createService({ adminId: 40, requestId: 'request_shared', name: 'Shared Custom', durationMinutes: 30, price: '300', variablePrice: false, customerDescription: 'A shared service ready for clients to discover online.', staffIds: [11, 12] });
  assert.equal(result.service.privateOwnerStaffId, null);
  assert.deepEqual(result.service.staffIds, [11, 12]);
  assert.equal(result.service.customerDescription, 'A shared service ready for clients to discover online.');
  const insert = calls.find(call => call.sql.includes('INSERT INTO services('));
  assert.match(insert.sql, /customer_description/);
  assert.match(insert.sql, /'active'/);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO service_visibility_policies')), false);
  const migration = read('migrations/098_workspace_service_create_capability.sql');
  const executableSql = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.match(executableSql, /services:create/);
  assert.match(executableSql, /booking_operator/);
  assert.match(executableSql, /tenant_practitioner/);
  assert.doesNotMatch(executableSql, /services:manage/);
});

test('duplicate canonical service name fails closed before any service write', async () => {
  const { db, calls } = fakeDb({ practitionerIds: [11], duplicate: true });
  await assert.rejects(
    createWorkspaceServiceCreationService({ db }).createService({ adminId: 40, requestId: 'request_duplicate', name: 'Existing', durationMinutes: 60, price: '600', variablePrice: false, customerDescription: 'An existing service description that will not be saved.', staffIds: [11] }),
    error => error.code === 'WORKSPACE_SERVICE_NAME_EXISTS' && error.httpStatus === 409
  );
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO services(')), false);
  assert.equal(calls.filter(call => call.sql === 'ROLLBACK').length, 1);
});

test('route and UX use one guarded creation endpoint from Workspace and Calendar', () => {
  const mutations = read('src/routes/workspaceServicesMutations.js');
  const workspaceRoute = read('src/routes/workspaceServices.js');
  const calendarRoute = read('src/routes/calendarCreateBooking.js');
  const ux = read('src/presentation/workspaceServiceCreationUx.js');
  assert.match(mutations, /router\.post\('\/create', \.\.\.mutationChain/);
  assert.match(mutations, /sameOrigin, requireSession, requireCsrf/);
  assert.match(mutations, /creationService\.createService/);
  assert.match(workspaceRoute, /router\.get\('\/new'/);
  assert.match(workspaceRoute, /router\.get\('\/create-options'/);
  assert.ok(workspaceRoute.indexOf("router.get('/create-options'") < workspaceRoute.indexOf("router.get('/:id'"));
  assert.match(ux, /\/calendar\/services\/new/);
  assert.match(calendarRoute, /injectCalendarInlineServiceCreation/);
  assert.match(ux, /var API='\/calendar\/services'/);
  assert.match(ux, /fetch\(API\+'\/create-options'/);
  assert.match(ux, /fetch\(API\+'\/create'/);
  assert.match(ux, /data-create-description/);
  assert.match(ux, /customerDescription/);
  assert.match(ux, /createdServiceId/);
  assert.doesNotMatch(ux, /localStorage|sessionStorage/);
});
