const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  SERVICES_VIEW_CAPABILITY,
  SERVICES_LIST_PAGE_SIZE,
  WorkspaceServicesError,
  evaluateServicesReadAuthority,
  projectBookingEligibility,
  createWorkspaceServicesService,
} = require('../src/services/workspaceServices');
const {
  renderServicesListPage,
  renderServiceDetailPage,
} = require('../src/presentation/workspaceServicesUx');
const { renderWorkspaceNavigation } = require('../src/presentation/workspaceShell');
const { createWorkspaceServicesRouter, navScript } = require('../src/routes/workspaceServices');

const ENABLED_ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function principal(overrides = {}) {
  return {
    id: 51,
    staff_id: null,
    display_name: 'Synthetic Admin',
    permissions: { 'services:view': true },
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

function fakeDb(handler) {
  return {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      if (typeof handler === 'function') return { rows: await handler(sql, values) };
      return { rows: handler || [] };
    },
  };
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

test('services:view is explicit current-principal authority and unrelated capabilities fail closed', () => {
  assert.equal(evaluateServicesReadAuthority([principal()]).capability, SERVICES_VIEW_CAPABILITY);
  assert.equal(evaluateServicesReadAuthority([principal({ permissions: { 'staff:view': true, 'client:lookup': true, 'schedule:manage': true } })]), null);
  assert.equal(evaluateServicesReadAuthority([principal({ admin_active: false })]), null);
  assert.equal(evaluateServicesReadAuthority([principal({ staff_id: 7, staff_status: 'inactive' })]), null);
  assert.equal(evaluateServicesReadAuthority([principal(), principal({ id: 52 })]), null);
});

test('migration expresses services:view only for existing active owner/business_admin principals', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '090_workspace_services_view_capability.sql'), 'utf8');
  assert.match(sql, /"services:view":true/);
  assert.match(sql, /business_role IN \('owner', 'business_admin'\)/);
  assert.match(sql, /active = TRUE/);
  assert.doesNotMatch(sql, /services:manage|staff:manage|schedule:manage/);
  assert.doesNotMatch(sql, /INSERT INTO staff_admin_accounts/i);
});

test('Services list is canonical, searchable, page-bounded and derives booking readiness from assigned staff', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    name: `Synthetic Service ${index + 1}`,
    duration_minutes: 60,
    processing_time_minutes: 0,
    extra_time_minutes: index === 0 ? 15 : 0,
    variable_price: false,
    price: '650.00',
    display_price: null,
    status: 'active',
    category_name: 'Massage',
    assigned_staff_count: 2,
    client_bookable_staff_count: index === 1 ? 0 : 1,
  }));
  const db = fakeDb(sql => sql.includes('workspaceServices:principal') ? [principal()] : rows);
  const service = createWorkspaceServicesService({ db });
  const model = await service.listServices({ adminId: 51, q: ' Synthetic ', status: 'active', offset: 999999 });
  assert.equal(model.services.length, SERVICES_LIST_PAGE_SIZE);
  assert.equal(model.hasMore, true);
  assert.equal(model.offset, 100000);
  assert.equal(model.services[0].total_minutes, 75);
  assert.equal(model.services[0].booking_eligibility.eligible, true);
  assert.equal(model.services[1].booking_eligibility.eligible, false);
  const query = db.calls[1];
  assert.match(query.sql, /FROM services svc/);
  assert.match(query.sql, /LEFT JOIN service_categories sc/);
  assert.match(query.sql, /FROM staff_services ss/);
  assert.match(query.sql, /JOIN staff st/);
  assert.match(query.sql, /st\.client_bookable=TRUE/);
  assert.match(query.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.ok(query.values.includes(SERVICES_LIST_PAGE_SIZE + 1));
});

test('booking readiness is a projection only and cannot override inactive service authority', () => {
  assert.equal(projectBookingEligibility({ status: 'active', category_name: 'Massage', variable_price: false, price: '650.00', client_bookable_staff_count: 1 }).eligible, true);
  assert.equal(projectBookingEligibility({ status: 'active', client_bookable_staff_count: 0 }).eligible, false);
  assert.equal(projectBookingEligibility({ status: 'inactive', client_bookable_staff_count: 4 }).eligible, false);
  assert.equal(projectBookingEligibility({ status: 'active' }, [{ status: 'active', client_bookable: true }]).authority, 'read_projection_only');
});

test('Service detail reads canonical offering and staff_services relationship without private authority fields', async () => {
  const db = fakeDb(sql => {
    if (sql.includes('workspaceServices:principal')) return [principal()];
    if (sql.includes('workspaceServices:detail')) return [{
      id: 9,
      name: 'Synthetic Massage',
      duration_minutes: 60,
      processing_time_minutes: 0,
      extra_time_minutes: 15,
      variable_price: false,
      price: '700.00',
      display_price: null,
      status: 'active',
      customer_description: 'Customer-safe description',
      booking_note: 'Arrive five minutes early',
      category_name: 'Massage',
    }];
    if (sql.includes('workspaceServices:staff')) return [
      { display_name: 'Synthetic Practitioner', resource_type: 'practitioner', status: 'active', client_bookable: true },
      { display_name: 'Internal Resource', resource_type: 'business_resource', status: 'active', client_bookable: false },
    ];
    return [];
  });
  const model = await createWorkspaceServicesService({ db }).getServiceDetail({ adminId: 51, serviceId: 9 });
  assert.equal(model.service.name, 'Synthetic Massage');
  assert.equal(model.service.total_minutes, 75);
  assert.equal(model.assignedStaff.length, 2);
  assert.equal(model.bookingEligibility.eligible, true);
  assert.equal(model.bookingEligibility.clientBookableStaffCount, 1);
  const serviceSql = db.calls.find(call => call.sql.includes('workspaceServices:detail')).sql;
  const staffSql = db.calls.find(call => call.sql.includes('workspaceServices:staff')).sql;
  assert.doesNotMatch(serviceSql, /external_source|external_id|created_at|updated_at/i);
  assert.doesNotMatch(staffSql, /whatsapp|mobile|permissions|calendar_scope|service_scope|totp|secret|recovery/i);
});

test('no browser session is unauthorized and Calendar/Clients/Staff authority does not grant Services', async () => {
  const app = express();
  app.use('/calendar/services', createWorkspaceServicesRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: false }; } },
    service: { async resolveAccess() { return null; }, async listServices() { throw new Error('must not run'); } },
  }));
  await withServer(app, async base => {
    const response = await fetch(`${base}/calendar/services`);
    assert.equal(response.status, 401);
  });

  const forbiddenApp = express();
  forbiddenApp.use('/calendar/services', createWorkspaceServicesRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: true, adminId: 51, viewer: { calendarScope: 'all_business' } }; } },
    service: {
      async resolveAccess() { return null; },
      async listServices() { throw new WorkspaceServicesError('WORKSPACE_SERVICES_FORBIDDEN', 'forbidden', 403); },
      async getServiceDetail() { throw new WorkspaceServicesError('WORKSPACE_SERVICES_FORBIDDEN', 'forbidden', 403); },
    },
  }));
  await withServer(forbiddenApp, async base => {
    const response = await fetch(`${base}/calendar/services`, { headers: { cookie: 'shiloh_staff_session=calendar-staff-clients-only' } });
    assert.equal(response.status, 403);
  });
});

test('Services nav stays disabled until same-origin authority check succeeds', () => {
  const html = renderWorkspaceNavigation({ active: 'calendar', calendarHref: '/calendar/read-only', clientsHref: '/calendar/clients', staffHref: '/calendar/team' });
  assert.match(html, /data-workspace-destination="services"/);
  assert.match(html, /class="workspace-link future"[^>]*>Services/);
  assert.match(html, /\/calendar\/workspace\/nav\.js/);
  const script = navScript();
  assert.match(script, /\/calendar\/services\/access/);
  assert.match(script, /a\.href='\/calendar\/services'/);
  assert.doesNotMatch(script, /console\.|localStorage|sessionStorage/);
});

test('Services presentation is responsive, read-only and excludes private/provenance fields', () => {
  const list = renderServicesListPage({
    services: [{
      id: 9, name: 'Synthetic Massage', duration_minutes: 60, total_minutes: 60,
      price: '700.00', display_price: null, variable_price: false, status: 'active',
      category_name: 'Massage', assigned_staff_count: 2,
      booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
    }],
    hasMore: false, offset: 0, pageSize: 30, query: '', status: 'active',
  }, {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  });
  assert.match(list, /data-services-list-view/);
  assert.match(list, /aria-current="page">Services/);
  assert.match(list, /Available for booking/);
  assert.match(list, /@media\(max-width:700px\)/);

  const detail = renderServiceDetailPage({
    service: {
      id: 9, name: 'Synthetic Massage', duration_minutes: 60, processing_time_minutes: 0,
      extra_time_minutes: 15, total_minutes: 75, price: '700.00', display_price: null,
      variable_price: false, status: 'active', category_name: 'Massage',
      customer_description: 'Customer-safe description', booking_note: 'Arrive early',
    },
    assignedStaff: [{ display_name: 'Synthetic Practitioner', resource_type: 'practitioner', status: 'active', client_bookable: true }],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 1, authority: 'read_projection_only' },
  }, {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  });
  assert.match(detail, /Booking status/);
  assert.match(detail, /Available for booking/);
  assert.doesNotMatch(detail, /external_source|external_id|whatsapp_number|normalized_whatsapp|totp|recovery|secret/i);
});

test('Workspace Services route is GET-only and existing Calendar/Staff mounts are preserved', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workspaceServices.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendar.js'), 'utf8');
  assert.match(source, /requireStaffSession/);
  assert.doesNotMatch(source, /router\.(?:post|put|patch|delete)\s*\(/i);
  assert.match(calendar, /router\.use\('\/staff', staffCalendarAccessUxRoutes\)/);
  assert.match(calendar, /router\.use\('\/team', createWorkspaceStaffRouter/);
  assert.match(calendar, /router\.use\('\/services', createWorkspaceServicesRouter/);
});
