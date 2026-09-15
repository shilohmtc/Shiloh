const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  STAFF_VIEW_CAPABILITY,
  STAFF_LIST_PAGE_SIZE,
  WorkspaceStaffError,
  evaluateStaffReadAuthority,
  createWorkspaceStaffService,
} = require('../src/services/workspaceStaff');
const {
  renderStaffListPage,
  renderStaffDetailPage,
} = require('../src/presentation/workspaceStaffUx');
const { renderWorkspaceNavigation } = require('../src/presentation/workspaceShell');
const { createWorkspaceStaffRouter, navScript } = require('../src/routes/workspaceStaff');

const ENABLED_ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function principal(overrides = {}) {
  return {
    id: 41,
    staff_id: null,
    display_name: 'Synthetic Admin',
    permissions: { 'staff:view': true },
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

test('staff:view is explicit current-principal authority and unrelated capabilities fail closed', () => {
  assert.equal(evaluateStaffReadAuthority([principal()]).capability, STAFF_VIEW_CAPABILITY);
  assert.equal(evaluateStaffReadAuthority([principal({ permissions: { 'client:lookup': true, 'schedule:manage': true } })]), null);
  assert.equal(evaluateStaffReadAuthority([principal({ admin_active: false })]), null);
  assert.equal(evaluateStaffReadAuthority([principal({ staff_id: 7, staff_status: 'inactive' })]), null);
  assert.equal(evaluateStaffReadAuthority([principal(), principal({ id: 42 })]), null);
});

test('migration expresses staff:view only for existing active owner/business_admin principals', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '089_workspace_staff_view_capability.sql'), 'utf8');
  assert.match(sql, /"staff:view":true/);
  assert.match(sql, /business_role IN \('owner', 'business_admin'\)/);
  assert.match(sql, /active = TRUE/);
  assert.doesNotMatch(sql, /staff:manage|appointment:create|schedule:manage/);
  assert.doesNotMatch(sql, /INSERT INTO staff_admin_accounts/i);
});

test('Staff list is canonical, name-bounded and page-bounded', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    display_name: `Synthetic ${index + 1}`,
    resource_type: 'practitioner',
    status: 'active',
    scheduling_type: 'regular',
    client_bookable: true,
    service_count: 2,
    active_admin_count: 1,
    business_role: 'employee_practitioner',
  }));
  const db = fakeDb((sql) => sql.includes('workspaceStaff:principal') ? [principal()] : rows);
  const service = createWorkspaceStaffService({ db });
  const model = await service.listStaff({ adminId: 41, q: ' Synthetic ', status: 'active', offset: 999999 });
  assert.equal(model.staff.length, STAFF_LIST_PAGE_SIZE);
  assert.equal(model.hasMore, true);
  assert.equal(model.offset, 100000);
  const query = db.calls.find(call => call.sql.includes('workspaceStaff:list'));
  assert.ok(query);
  assert.match(query.sql, /FROM staff s/);
  assert.match(query.sql, /FROM staff_services ss/);
  assert.match(query.sql, /JOIN services svc/);
  assert.match(query.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.ok(query.values.includes(STAFF_LIST_PAGE_SIZE + 1));
});

test('Staff detail reads canonical services and safe linked access only', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('workspaceStaff:principal')) return [principal()];
    if (sql.includes('workspaceStaff:detail')) return [{ id: 7, display_name: 'Synthetic Practitioner', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true }];
    if (sql.includes('workspaceStaff:services')) return [{ name: 'Swedish Massage', duration_minutes: 60, status: 'active' }];
    if (sql.includes('workspaceStaff:linked_access')) return [{ business_role: 'employee_practitioner', calendar_scope: 'own_appointments', service_scope: 'own_services', permissions: { 'appointment:view': true, 'staff:view': false } }];
    return [];
  });
  const model = await createWorkspaceStaffService({ db }).getStaffDetail({ adminId: 41, staffId: 7 });
  assert.equal(model.staff.display_name, 'Synthetic Practitioner');
  assert.deepEqual(model.services.map(service => service.name), ['Swedish Massage']);
  assert.deepEqual(model.access.capabilities, ['appointment:view']);
  assert.equal(model.access.calendarScope, 'own_appointments');
  const accessSql = db.calls.find(call => call.sql.includes('workspaceStaff:linked_access')).sql;
  assert.doesNotMatch(accessSql, /whatsapp|normalized_whatsapp|totp|secret|recovery/i);
});

test('ambiguous linked staff-admin authority fails closed', async () => {
  const db = fakeDb((sql) => {
    if (sql.includes('workspaceStaff:principal')) return [principal()];
    if (sql.includes('workspaceStaff:detail')) return [{ id: 7, display_name: 'Synthetic', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true }];
    if (sql.includes('workspaceStaff:services')) return [];
    if (sql.includes('workspaceStaff:linked_access')) return [
      { business_role: 'business_admin', permissions: {} },
      { business_role: 'employee_practitioner', permissions: {} },
    ];
    return [];
  });
  await assert.rejects(
    () => createWorkspaceStaffService({ db }).getStaffDetail({ adminId: 41, staffId: 7 }),
    error => error instanceof WorkspaceStaffError && error.code === 'WORKSPACE_STAFF_ACCESS_AMBIGUOUS' && error.httpStatus === 409
  );
});

test('no browser session is unauthorized and Calendar/Clients capabilities do not grant Staff', async () => {
  const app = express();
  app.use('/calendar/team', createWorkspaceStaffRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: false }; } },
    service: { async resolveAccess() { return null; }, async listStaff() { throw new Error('must not run'); } },
  }));
  await withServer(app, async base => {
    const response = await fetch(`${base}/calendar/team`);
    assert.equal(response.status, 401);
  });

  const forbiddenApp = express();
  forbiddenApp.use('/calendar/team', createWorkspaceStaffRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: true, adminId: 41, viewer: { calendarScope: 'all_business' } }; } },
    service: {
      async resolveAccess() { return null; },
      async listStaff() { throw new WorkspaceStaffError('WORKSPACE_STAFF_FORBIDDEN', 'forbidden', 403); },
      async getStaffDetail() { throw new WorkspaceStaffError('WORKSPACE_STAFF_FORBIDDEN', 'forbidden', 403); },
    },
  }));
  await withServer(forbiddenApp, async base => {
    const response = await fetch(`${base}/calendar/team`, { headers: { cookie: 'shiloh_staff_session=calendar-only' } });
    assert.equal(response.status, 403);
  });
});

test('Staff nav stays disabled until same-origin authority check succeeds and then opens Staff access', () => {
  const html = renderWorkspaceNavigation({ active: 'calendar', calendarHref: '/calendar/read-only', clientsHref: '/calendar/clients' });
  assert.match(html, /data-workspace-destination="staff"/);
  assert.match(html, /class="workspace-link future"[^>]*>Staff/);
  assert.match(html, /\/calendar\/workspace\/nav\.js/);
  const script = navScript();
  assert.match(script, /\/calendar\/team\/access/);
  assert.match(script, /a\.href='\/calendar\/team\/staff-access'/);
  assert.match(script, /a\.textContent='Staff access'/);
  assert.doesNotMatch(script, /console\.|localStorage|sessionStorage/);
});

test('Staff presentation is responsive, read-only and excludes private/security fields', () => {
  const list = renderStaffListPage({
    staff: [{ id: 7, display_name: 'Synthetic Practitioner', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 1, active_admin_count: 1, business_role: 'employee_practitioner' }],
    hasMore: false, offset: 0, pageSize: 30, query: '', status: 'active',
  }, { calendarNavigationAllowed: true, clientsNavigationAllowed: true, staffAccessScriptPath: '/calendar/staff/client.js' });
  assert.match(list, /data-staff-list-view/);
  assert.match(list, /aria-current="page">Staff/);
  assert.match(list, /@media\(max-width:700px\)/);

  const detail = renderStaffDetailPage({
    staff: { id: 7, display_name: 'Synthetic Practitioner', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true },
    services: [{ name: 'Swedish Massage', status: 'active' }],
    access: { businessRole: 'employee_practitioner', calendarScope: 'own_appointments', serviceScope: 'own_services', capabilities: ['appointment:view'] },
  }, { calendarNavigationAllowed: true, clientsNavigationAllowed: true, staffAccessScriptPath: '/calendar/staff/client.js' });
  assert.match(detail, /Current access/);
  assert.match(detail, /appointment:view/);
  assert.match(detail, /Access settings are view only here/);
  assert.doesNotMatch(detail, /whatsapp_number|normalized_whatsapp|totp_secret|recovery_code|compensation/i);
});

test('Workspace Staff route is GET-only and existing /calendar/staff auth mount is preserved', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workspaceStaff.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendar.js'), 'utf8');
  assert.match(source, /requireStaffSession/);
  assert.doesNotMatch(source, /router\.(?:post|put|patch|delete)\s*\(/i);
  assert.match(calendar, /router\.use\('\/staff', staffCalendarAccessUxRoutes\)/);
  assert.match(calendar, /router\.use\('\/team', createWorkspaceStaffRouter/);
});
