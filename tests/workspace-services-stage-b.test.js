const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  SERVICES_MANAGE_CAPABILITY,
  WorkspaceServicesError,
  evaluateServicesManageAuthority,
  serviceRevision,
  createWorkspaceServicesService,
} = require('../src/services/workspaceServices');
const { createWorkspaceServicesMutationRouter } = require('../src/routes/workspaceServicesMutations');
const { renderServiceDetailPage, workspaceServicesManageClientScript } = require('../src/presentation/workspaceServicesUx');

function principal(overrides = {}) {
  return {
    id: 51,
    staff_id: null,
    display_name: 'Synthetic Admin',
    permissions: { 'services:view': true, 'services:manage': true },
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function canonicalService(overrides = {}) {
  return {
    id: 9,
    name: 'Synthetic Massage',
    duration_minutes: 60,
    processing_time_minutes: 10,
    extra_time_minutes: 5,
    variable_price: false,
    price: '700.00',
    display_price: 'R700',
    customer_description: 'A clear, approved description for the public website.',
    status: 'active',
    ...overrides,
  };
}

function transactionalDb(handler, { admin = principal(), service = canonicalService(), assignments = [11] } = {}) {
  const calls = [];
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return result();
    if (sql.includes('workspaceServices:principal')) return result(admin ? [admin] : []);
    if (sql.includes('pg_advisory_xact_lock')) return result([{}]);
    if (sql.includes('workspaceServices:mutation-service')) return result(service ? [service] : []);
    if (sql.includes('workspaceServices:mutation-assignments')) return result(assignments.map(staff_id => ({ staff_id })));
    if (sql.startsWith('INSERT INTO crm_audit_events')) return result([{ id: 901 }]);
    return handler(sql, params, calls);
  };
  const client = { query, release() { calls.push({ sql: 'RELEASE', params: [] }); } };
  return { db: { query, async connect() { return client; } }, calls };
}

async function withServer(app, work) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    return await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('services:manage is explicit canonical mutation authority and view/role-adjacent scopes do not grant it', () => {
  assert.equal(evaluateServicesManageAuthority([principal()]).capability, SERVICES_MANAGE_CAPABILITY);
  assert.equal(evaluateServicesManageAuthority([principal({ permissions: { 'services:view': true, 'staff:manage': true, 'schedule:manage': true } })]), null);
  assert.equal(evaluateServicesManageAuthority([principal({ admin_active: false })]), null);
  assert.equal(evaluateServicesManageAuthority([principal({ staff_id: 7, staff_status: 'inactive' })]), null);
  assert.equal(evaluateServicesManageAuthority([principal(), principal({ id: 52 })]), null);
});

test('view-only principal fails closed before any canonical Services mutation', async () => {
  const current = canonicalService();
  const fake = transactionalDb(async sql => { throw new Error(`Unexpected mutation SQL: ${sql}`); }, {
    admin: principal({ permissions: { 'services:view': true } }),
    service: current,
  });
  const service = createWorkspaceServicesService({ db: fake.db });
  await assert.rejects(service.updateService({
    adminId: 51,
    serviceId: 9,
    expectedRevision: serviceRevision(current, [11]),
    requestId: 'request_001',
    name: 'Changed',
    durationMinutes: 60,
    processingTimeMinutes: 10,
    extraTimeMinutes: 5,
    price: '700.00',
    displayPrice: 'R700',
    variablePrice: false,
  }), error => error instanceof WorkspaceServicesError && error.code === 'WORKSPACE_SERVICES_MANAGE_FORBIDDEN' && error.httpStatus === 403);
  assert.equal(fake.calls.some(call => call.sql.startsWith('UPDATE services')), false);
  assert.equal(fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')), false);
});

test('service edit mutates only canonical editable columns while preserving independent timing and price semantics', async () => {
  const current = canonicalService();
  const fake = transactionalDb(async (sql, params) => {
    if (sql.startsWith('UPDATE services') && sql.includes('duration_minutes=')) {
      assert.deepEqual(params, [9, 'Synthetic Massage Plus', 70, 12, 8, '725.50', 'From R725.50', true]);
      return result([canonicalService({
        name: 'Synthetic Massage Plus', duration_minutes: 70, processing_time_minutes: 12,
        extra_time_minutes: 8, price: '725.50', display_price: 'From R725.50', variable_price: true,
      })]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, { service: current, assignments: [11, 12] });
  const service = createWorkspaceServicesService({ db: fake.db });
  const response = await service.updateService({
    adminId: 51,
    serviceId: 9,
    expectedRevision: serviceRevision(current, [11, 12]),
    requestId: 'request_002',
    name: ' Synthetic   Massage Plus ',
    durationMinutes: '70',
    processingTimeMinutes: '12',
    extraTimeMinutes: '8',
    price: '725.5',
    displayPrice: ' From   R725.50 ',
    variablePrice: true,
  });
  assert.equal(response.status, 'updated');
  const update = fake.calls.find(call => call.sql.startsWith('UPDATE services'));
  assert.match(update.sql, /duration_minutes=\$3/);
  assert.match(update.sql, /processing_time_minutes=\$4/);
  assert.match(update.sql, /extra_time_minutes=\$5/);
  assert.match(update.sql, /price=\$6::numeric/);
  assert.match(update.sql, /display_price=\$7/);
  assert.match(update.sql, /variable_price=\$8/);
  assert.doesNotMatch(update.sql, /customer_description\s*=|booking_note|category_id|client_bookable/i);
  const audit = fake.calls.find(call => call.sql.startsWith('INSERT INTO crm_audit_events'));
  assert.equal(audit.params[1], 'workspace.service_updated');
  const metadata = JSON.parse(audit.params[3]);
  assert.equal(metadata.before.processingTimeMinutes, 10);
  assert.equal(metadata.after.processingTimeMinutes, 12);
  assert.equal(metadata.before.variablePrice, false);
  assert.equal(metadata.after.variablePrice, true);
});

test('approved website description updates only canonical customer copy with audit evidence', async () => {
  const current = canonicalService();
  const approved = 'A warm, client-friendly description of what to expect from this service.';
  const fake = transactionalDb(async (sql, params) => {
    if (sql.startsWith('UPDATE services') && sql.includes('customer_description=')) {
      assert.deepEqual(params, [9, approved]);
      assert.doesNotMatch(sql, /booking_note|status=|price=/i);
      return result([canonicalService({ customer_description: approved })]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, { service: current, assignments: [11] });
  const service = createWorkspaceServicesService({ db: fake.db });
  const response = await service.updateCustomerDescription({
    adminId: 51,
    serviceId: 9,
    expectedRevision: serviceRevision(current, [11]),
    requestId: 'request_description',
    customerDescription: `  ${approved}  `,
  });
  assert.equal(response.status, 'updated');
  const audit = fake.calls.find(call => call.sql.startsWith('INSERT INTO crm_audit_events'));
  assert.equal(audit.params[1], 'workspace.service_description_updated');
  const metadata = JSON.parse(audit.params[3]);
  assert.equal(metadata.before.customerDescription, current.customer_description);
  assert.equal(metadata.after.customerDescription, approved);
  assert.equal(metadata.publicWebsiteSourceUpdated, true);
  assert.equal(metadata.bookingNoteUntouched, true);
});

test('stale service revision fails closed before update or audit', async () => {
  const current = canonicalService();
  const fake = transactionalDb(async sql => { throw new Error(`Unexpected SQL after stale revision: ${sql}`); }, { service: current, assignments: [11] });
  const service = createWorkspaceServicesService({ db: fake.db });
  await assert.rejects(service.setServiceStatus({
    adminId: 51, serviceId: 9, expectedRevision: '0'.repeat(64), requestId: 'request_003', status: 'inactive',
  }), error => error.code === 'WORKSPACE_SERVICES_STALE_REVISION' && error.httpStatus === 409);
  assert.equal(fake.calls.some(call => call.sql.startsWith('UPDATE services')), false);
  assert.equal(fake.calls.some(call => call.sql.startsWith('INSERT INTO crm_audit_events')), false);
  assert.equal(fake.calls.some(call => call.sql === 'ROLLBACK'), true);
});

test('ordinary deactivation is status-only and preserves practitioner mappings and appointment history', async () => {
  const current = canonicalService();
  const fake = transactionalDb(async (sql, params) => {
    if (sql.startsWith('UPDATE services') && sql.includes('SET status=')) {
      assert.deepEqual(params, [9, 'inactive']);
      return result([canonicalService({ status: 'inactive' })]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, { service: current, assignments: [11, 12] });
  const service = createWorkspaceServicesService({ db: fake.db });
  await service.setServiceStatus({
    adminId: 51,
    serviceId: 9,
    expectedRevision: serviceRevision(current, [11, 12]),
    requestId: 'request_004',
    status: 'inactive',
  });
  assert.equal(fake.calls.some(call => /DELETE FROM staff_services/i.test(call.sql)), false);
  assert.equal(fake.calls.some(call => /appointments|appointment_services|appointment_staff/i.test(call.sql)), false);
  const audit = fake.calls.find(call => call.sql.startsWith('INSERT INTO crm_audit_events'));
  const metadata = JSON.parse(audit.params[3]);
  assert.equal(metadata.assignmentsPreserved, true);
  assert.equal(metadata.historicalAppointmentsUntouched, true);
});

test('practitioner assignment is idempotent add and exact canonical mapping removal', async () => {
  const current = canonicalService();
  const addFake = transactionalDb(async (sql, params) => {
    if (sql.includes('workspaceServices:canonical-practitioner')) return result([{ id: 12, display_name: 'Practitioner Two', status: 'active', client_bookable: true }]);
    if (sql.startsWith('INSERT INTO staff_services')) {
      assert.deepEqual(params, [12, 9]);
      assert.match(sql, /ON CONFLICT\(staff_id,service_id\) DO NOTHING/);
      return result();
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, { service: current, assignments: [11] });
  await createWorkspaceServicesService({ db: addFake.db }).assignPractitioner({
    adminId: 51, serviceId: 9, staffId: 12,
    expectedRevision: serviceRevision(current, [11]), requestId: 'request_005',
  });
  assert.equal(addFake.calls.some(call => /client_bookable.*INSERT|INSERT.*client_bookable/i.test(call.sql)), false);

  const removeFake = transactionalDb(async (sql, params) => {
    if (sql.includes('workspaceServices:canonical-practitioner')) return result([{ id: 12, display_name: 'Practitioner Two', status: 'active', client_bookable: true }]);
    if (sql.startsWith('DELETE FROM staff_services')) {
      assert.deepEqual(params, [12, 9]);
      assert.match(sql, /WHERE staff_id=\$1 AND service_id=\$2/);
      return result([{ staff_id: 12 }]);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }, { service: current, assignments: [11, 12] });
  await createWorkspaceServicesService({ db: removeFake.db }).unassignPractitioner({
    adminId: 51, serviceId: 9, staffId: 12,
    expectedRevision: serviceRevision(current, [11, 12]), requestId: 'request_006',
  });
  assert.equal(removeFake.calls.some(call => /appointments|appointment_services|appointment_staff/i.test(call.sql)), false);
});

test('mutation HTTP boundary requires staff session, same-origin JSON and CSRF before service execution', async () => {
  let executions = 0;
  const sessionService = {
    async validateSessionToken(token) { return token === 'session-ok' ? { ok: true, adminId: 51 } : { ok: false }; },
    validateCsrfToken(_session, token) { return token === 'csrf-ok'; },
  };
  const mutationService = {
    async updateService() { executions += 1; return { status: 'updated', serviceId: 9, revision: 'a'.repeat(64) }; },
  };
  const app = express();
  app.use(express.json());
  app.use('/calendar/services', createWorkspaceServicesMutationRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService,
    service: mutationService,
  }));
  await withServer(app, async base => {
    const noSession = await fetch(`${base}/calendar/services/9/update`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(noSession.status, 401);

    const crossOrigin = await fetch(`${base}/calendar/services/9/update`, {
      method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json', cookie: 'shiloh_staff_session=session-ok', 'x-shiloh-csrf-token': 'csrf-ok' }, body: '{}',
    });
    assert.equal(crossOrigin.status, 403);

    const noCsrf = await fetch(`${base}/calendar/services/9/update`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: 'shiloh_staff_session=session-ok' }, body: '{}',
    });
    assert.equal(noCsrf.status, 403);

    const allowed = await fetch(`${base}/calendar/services/9/update`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json', cookie: 'shiloh_staff_session=session-ok', 'x-shiloh-csrf-token': 'csrf-ok' }, body: '{}',
    });
    assert.equal(allowed.status, 200);
    assert.equal(executions, 1);
  });
});

test('Workspace Services manage UX exposes only bounded service/status/practitioner controls and secure JSON client', () => {
  const model = {
    service: {
      ...canonicalService(), total_minutes: 75, revision: 'b'.repeat(64), category_name: 'Massage',
      customer_description: 'Customer-safe description', booking_note: 'Arrive early',
    },
    assignedStaff: [
      { id: 11, display_name: 'Practitioner One', resource_type: 'practitioner', status: 'active', client_bookable: true },
      { id: 20, display_name: 'Internal Resource', resource_type: 'business_resource', status: 'active', client_bookable: false },
    ],
    practitioners: [
      { id: 11, display_name: 'Practitioner One', status: 'active', client_bookable: true, assigned: true },
      { id: 12, display_name: 'Practitioner Two', status: 'active', client_bookable: true, assigned: false },
    ],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 1, authority: 'read_projection_only' },
  };
  const baseOptions = {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  };
  const managed = renderServiceDetailPage(model, { ...baseOptions, manageAllowed: true });
  assert.match(managed, /data-service-edit-form/);
  assert.match(managed, /name="durationMinutes"/);
  assert.match(managed, /name="processingTimeMinutes"/);
  assert.match(managed, /name="extraTimeMinutes"/);
  assert.match(managed, /name="price"/);
  assert.match(managed, /name="displayPrice"/);
  assert.match(managed, /name="variablePrice"/);
  assert.match(managed, /data-service-status-form/);
  assert.match(managed, /data-service-description-form/);
  assert.match(managed, /name="customerDescription"/);
  assert.match(managed, /Website preview/);
  assert.match(managed, /Approve and publish wording/);
  assert.match(managed, /Private booking note/);
  assert.match(managed, /data-service-assign-form/);
  assert.match(managed, /data-service-unassign-form/);
  assert.match(managed, /\/calendar\/services\/manage\.js/);
  assert.doesNotMatch(managed, /name="client_bookable"|Create service|Delete service|Generic settings/i);

  const viewOnly = renderServiceDetailPage(model, { ...baseOptions, manageAllowed: false });
  assert.match(viewOnly, /View only/);
  assert.doesNotMatch(viewOnly, /data-service-edit-form|data-service-description-form|data-service-status-form|data-service-assign-form|data-service-unassign-form|\/calendar\/services\/manage\.js/);

  const client = workspaceServicesManageClientScript();
  assert.match(client, /AUTH='\/calendar\/staff-auth'/);
  assert.match(client, /AUTH\+'\/csrf'/);
  assert.match(client, /x-shiloh-csrf-token/);
  assert.match(client, /Content-Type':'application\/json/);
  assert.match(client, /window\.location\.reload/);
  assert.match(client, /\/description/);
  assert.match(client, /data-description-preview/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|services:view/);
});
