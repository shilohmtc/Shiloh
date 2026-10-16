const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const { pool } = require('../src/db/pool');
const crmReadService = require('../src/services/crmReadService');
const {
  WorkspaceClientsError,
  CLIENT_LIST_PAGE_SIZE,
  CLIENT_HISTORY_PAGE_SIZE,
  evaluateClientReadAuthority,
  createWorkspaceClientsService,
} = require('../src/services/workspaceClients');
const {
  renderClientListPage,
  renderClientDetailPage,
} = require('../src/presentation/workspaceClientsUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');

const ENABLED_ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function authorityRow(overrides = {}) {
  return {
    id: 41,
    staff_id: 7,
    display_name: 'Synthetic Operator',
    business_role: 'business_admin',
    permissions: { 'client:lookup': true },
    admin_active: true,
    staff_status: 'active',
    calendar_scope: 'none',
    ...overrides,
  };
}

function canonicalClient(overrides = {}) {
  return {
    id: 912,
    name: 'Synthetic Client',
    normalized_mobile: '27821234567',
    date_of_birth: '1994-02-18',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-08-28T10:00:00.000Z',
    status: 'active',
    last_visit_at: '2026-08-29T08:00:00.000Z',
    ...overrides,
  };
}

function canonicalAppointment(overrides = {}) {
  return {
    starts_at: '2026-08-29T08:00:00.000Z',
    ends_at: '2026-08-29T09:00:00.000Z',
    status: 'completed',
    title: 'Historical appointment',
    services: [{ name: 'Therapeutic Massage' }],
    staff: [{ name: 'Synthetic Practitioner' }],
    ...overrides,
  };
}

function fakeDb(rows) {
  return {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      return { rows: typeof rows === 'function' ? rows(sql, values) : rows };
    },
  };
}

function fakeReadService({ clients = [canonicalClient()], client = canonicalClient(), appointments = [canonicalAppointment()] } = {}) {
  return {
    calls: [],
    async listClients(input) { this.calls.push({ method: 'listClients', input }); return clients; },
    async getClient(id, input) { this.calls.push({ method: 'getClient', id, input }); return client; },
    async getClientAppointments(id, input) { this.calls.push({ method: 'getClientAppointments', id, input }); return appointments; },
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

function calendarModel() {
  return {
    view: 'day',
    dateKey: '2026-08-30',
    todayKey: '2026-08-30',
    period: { dateKeys: ['2026-08-30'], previousAnchor: '2026-08-29', nextAnchor: '2026-08-31' },
    timeline: { appointments: [], blocks: [], leave: [], closures: [], externalBusy: [], staff: [], workingWindows: [], scheduleExceptions: [], recurringClosures: [] },
    permittedStaff: [],
    selectedStaffId: null,
    selectedFamily: 'all',
    search: '',
    summary: { appointments: 0, awaiting: 0, confirmed: 0, completed: 0, cancelled: 0 },
    readOnly: true,
    mutationCapability: { enabled: false },
  };
}

test('client:lookup is the sole current-principal authority and fails closed for missing or duplicate authority', () => {
  const allowed = evaluateClientReadAuthority([authorityRow()]);
  assert.equal(allowed.capability, 'client:lookup');
  assert.equal(allowed.operatorAdminId, 41);
  assert.ok(allowed, 'Calendar scope is deliberately irrelevant to Client read authority');
  assert.equal(evaluateClientReadAuthority([authorityRow({ permissions: { 'appointment:view': true } })]), null);
  assert.equal(evaluateClientReadAuthority([authorityRow({ admin_active: false })]), null);
  assert.equal(evaluateClientReadAuthority([authorityRow({ staff_status: 'inactive' })]), null);
  assert.equal(evaluateClientReadAuthority([authorityRow(), authorityRow({ id: 42 })]), null);
});

test('current authenticated admin permission is re-read server-side for every Client operation', async () => {
  const db = fakeDb([authorityRow()]);
  const reads = fakeReadService();
  const service = createWorkspaceClientsService({ db, readService: reads });
  const model = await service.listClients({ adminId: 41, q: '  Synthetic   Client ', status: 'active', offset: 0 });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM staff_admin_accounts a/);
  assert.deepEqual(db.calls[0].values, [41]);
  assert.equal(model.authority.capability, 'client:lookup');
  assert.deepEqual(reads.calls[0].input, {
    q: 'Synthetic Client', status: 'active', limit: 25, offset: 0,
    scope: { kind: 'clinic', ownerStaffId: null },
  });
});

test('list and history pagination are hard-bounded before reads reach the database', async () => {
  const manyClients = Array.from({ length: 40 }, (_, index) => canonicalClient({ id: index + 1, name: `Synthetic ${index + 1}` }));
  const manyAppointments = Array.from({ length: 30 }, (_, index) => canonicalAppointment({ starts_at: `2026-08-${String(29 - index).padStart(2, '0')}T08:00:00.000Z` }));
  const reads = fakeReadService({ clients: manyClients, appointments: manyAppointments });
  const service = createWorkspaceClientsService({ db: fakeDb([authorityRow()]), readService: reads });
  const list = await service.listClients({ adminId: 41, status: 'all', offset: 9999999 });
  assert.equal(list.clients.length, CLIENT_LIST_PAGE_SIZE);
  assert.equal(list.hasMore, true);
  assert.equal(reads.calls[0].input.limit, CLIENT_LIST_PAGE_SIZE + 1);
  assert.equal(reads.calls[0].input.offset, 100000);
  const detail = await service.getClientDetail({ adminId: 41, clientId: 912, historyOffset: -10 });
  assert.equal(detail.appointments.length, CLIENT_HISTORY_PAGE_SIZE);
  assert.equal(detail.hasMore, true);
  assert.deepEqual(reads.calls[2].input, {
    limit: CLIENT_HISTORY_PAGE_SIZE + 1,
    offset: 0,
    scope: { kind: 'clinic', ownerStaffId: null },
  });
});

test('search and detail resolve canonical CRM V2 clients only', async () => {
  const calls = [];
  const originalQuery = pool.query;
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [canonicalClient()] };
  };
  try {
    const listed = await crmReadService.listClients({ q: '082 123 4567', status: 'active', limit: 25, offset: 0 });
    const detailed = await crmReadService.getClient(912);
    assert.equal(listed[0].id, 912);
    assert.equal(detailed.id, 912);
  } finally {
    pool.query = originalQuery;
  }
  assert.match(calls[0].sql, /FROM crm_v2_clients c/);
  assert.doesNotMatch(calls[0].sql, /FROM clients c|client_contacts/i);
  assert.match(calls[0].sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.ok(calls[0].values.includes(25));
  assert.match(calls[1].sql, /FROM crm_v2_clients c/);
  assert.match(calls[1].sql, /WHERE c\.id=\$1/);
  assert.deepEqual(calls[1].values, [912]);
});

test('Workspace phone search finds equivalent SA numbers while preserving relationship and status scope', async (t) => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE crm_v2_clients(id BIGINT, name TEXT, normalized_mobile TEXT, date_of_birth DATE,
      gender TEXT, profile_status TEXT, mobile_verified_at TIMESTAMPTZ, status TEXT);
    CREATE TABLE crm_v2_client_relationships(client_id BIGINT, relationship_type TEXT,
      owner_staff_id BIGINT, status TEXT);
    CREATE TABLE appointments(id BIGINT, crm_v2_client_id BIGINT, client_id BIGINT, starts_at TIMESTAMPTZ, status TEXT);
    CREATE TABLE appointment_services(appointment_id BIGINT, service_id BIGINT);
    CREATE TABLE service_visibility_policies(service_id BIGINT, visibility_scope TEXT, owner_staff_id BIGINT);
    INSERT INTO crm_v2_clients VALUES
      (1,'Synthetic Phone Client','27821234567',NULL,NULL,'minimal',NULL,'active'),
      (2,'Synthetic Tenant Client','27821234568',NULL,NULL,'minimal',NULL,'active');
    INSERT INTO crm_v2_client_relationships VALUES
      (1,'clinic',NULL,'active'), (2,'tenant_staff',7,'active');
  `);
  const originalQuery = pool.query;
  pool.query = (sql, values) => pg.query(sql, values);
  t.after(() => { pool.query = originalQuery; });
  const scope = { kind: 'clinic', ownerStaffId: null };
  for (const q of ['0821234567', '082 123 4567', '27821234567', '+27 82 123 4567', '0027 82 123 4567']) {
    const rows = await crmReadService.listClients({ q, status: 'active', scope });
    assert.equal(rows.length, 1, q);
    assert.equal(Number(rows[0].id), 1);
  }
  assert.equal((await crmReadService.listClients({ q: '0821234568', status: null, scope })).length, 0);
  await pg.exec("UPDATE crm_v2_client_relationships SET status='archived' WHERE client_id=1");
  assert.equal((await crmReadService.listClients({ q: '0821234567', status: 'active', scope })).length, 0);
  assert.equal((await crmReadService.listClients({ q: '0821234567', status: null, scope })).length, 1);
  assert.equal((await crmReadService.listClients({ q: 'Synthetic Phone', status: null, scope })).length, 1);
  await pg.exec(`INSERT INTO appointments VALUES
    (10,1,NULL,NOW()-INTERVAL '10 days','completed'),
    (11,1,NULL,NOW()-INTERVAL '9 days','no_charge'),
    (12,1,NULL,NOW()-INTERVAL '8 days','scheduled'),
    (13,1,NULL,NOW()-INTERVAL '7 days','no_show'),
    (14,1,NULL,NOW()-INTERVAL '6 days','cancelled'),
    (15,1,NULL,NOW()+INTERVAL '1 day','scheduled'),
    (16,1,NULL,NOW()+INTERVAL '2 days','confirmed'),
    (17,1,NULL,NOW()+INTERVAL '3 days','completed'),
    (18,NULL,1,NOW()-INTERVAL '1 day','completed');`);
  const summary=(await crmReadService.listClients({q:'Synthetic Phone',status:null,scope}))[0];
  const expected=await pg.query('SELECT starts_at FROM appointments WHERE id IN (11,15) ORDER BY id');
  assert.equal(new Date(summary.last_visit_at).toISOString(),new Date(expected.rows[0].starts_at).toISOString());
  assert.equal(new Date(summary.next_appointment_at).toISOString(),new Date(expected.rows[1].starts_at).toISOString());

});

test('CRM V2 appointment history follows the canonical XOR key and cannot cross-link an equal legacy ID', async () => {
  let captured;
  const originalQuery = pool.query;
  pool.query = async (sql, values) => {
    captured = { sql, values };
    return { rows: [canonicalAppointment()] };
  };
  try {
    const rows = await crmReadService.getClientAppointments(912, { limit: 21, offset: 0 });
    assert.equal(rows.length, 1);
  } finally {
    pool.query = originalQuery;
  }
  assert.match(captured.sql, /JOIN crm_v2_clients c ON c\.id=a\.crm_v2_client_id/);
  assert.match(captured.sql, /SELECT a\.id, a\.starts_at/);
  assert.match(captured.sql, /a\.crm_v2_client_id=\$1/);
  assert.match(captured.sql, /a\.client_id IS NULL/);
  assert.doesNotMatch(captured.sql, /a\.client_id\s*=\s*\$1|\bOR\b[^;]*client_id/is);
  assert.deepEqual(captured.values, [912, 21, 0]);
});

test('no browser session is unauthorized at the mounted Clients router', async () => {
  const app = express();
  app.use('/calendar/clients', createWorkspaceClientsRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: false }; } },
    service: createWorkspaceClientsService({ db: fakeDb([authorityRow()]), readService: fakeReadService() }),
  }));
  await withServer(app, async base => {
    const response = await fetch(`${base}/calendar/clients`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /json/);
  });
});

test('authenticated staff with client:lookup can open list and exact detail', async () => {
  const app = express();
  app.use('/calendar/clients', createWorkspaceClientsRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken(token) { return token === 'authorized' ? { ok: true, adminId: 41, viewer: { calendarScope: 'none' } } : { ok: false }; } },
    service: createWorkspaceClientsService({ db: fakeDb([authorityRow()]), readService: fakeReadService() }),
  }));
  await withServer(app, async base => {
    const headers = { cookie: 'shiloh_staff_session=authorized' };
    const list = await fetch(`${base}/calendar/clients?q=Synthetic`, { headers });
    assert.equal(list.status, 200);
    assert.match(await list.text(), /Synthetic Client/);
    const detail = await fetch(`${base}/calendar/clients/912`, { headers });
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /Therapeutic Massage/);
  });
});

test('Calendar session/view authority alone does not grant Clients', async () => {
  const app = express();
  const forbiddenService = {
    async listClients() { throw new WorkspaceClientsError('WORKSPACE_CLIENTS_FORBIDDEN', 'forbidden', 403); },
    async getClientDetail() { throw new WorkspaceClientsError('WORKSPACE_CLIENTS_FORBIDDEN', 'forbidden', 403); },
  };
  app.use('/calendar/clients', createWorkspaceClientsRouter({
    env: ENABLED_ENV,
    sessionService: { async validateSessionToken() { return { ok: true, adminId: 41, viewer: { calendarScope: 'all_business' } }; } },
    service: forbiddenService,
  }));
  await withServer(app, async base => {
    const response = await fetch(`${base}/calendar/clients`, { headers: { cookie: 'shiloh_staff_session=calendar-only' } });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /does not permit client lookup/i);
  });
});

test('list presentation is compact, bounded and masks mobile contact', () => {
  const html = renderClientListPage({
    clients: [canonicalClient()], hasMore: false, offset: 0, pageSize: 24, query: '', status: 'active',
  }, { calendarNavigationAllowed: true });
  assert.match(html, /data-clients-list-view/);
  assert.match(html, /Mobile ending 4567/);
  assert.doesNotMatch(html, /27821234567|082 123 4567/);
  assert.doesNotMatch(html, /Results are bounded/);
  assert.match(html, /href="\/calendar\/read-only">Calendar/);
  assert.match(html, /aria-current="page">Clients/);
  assert.match(html, /@media\(max-width:700px\)/);
});

test('detail shows authorized profile/contact and immutable historical snapshots without internal provenance', () => {
  const html = renderClientDetailPage({
    client: canonicalClient(), appointments: [canonicalAppointment(), canonicalAppointment({ status: 'cancelled' })],
    hasMore: false, historyOffset: 0, pageSize: 20,
  }, { calendarNavigationAllowed: true });
  assert.match(html, /Synthetic Client/);
  assert.match(html, /18 Feb 1994/);
  assert.match(html, /082 123 4567/);
  assert.match(html, /Therapeutic Massage/);
  assert.match(html, /Synthetic Practitioner/);
  assert.match(html, /cancelled/);
  assert.doesNotMatch(html, /provenance|source|created_at|updated_at|audit/i);
  assert.match(html, /Only appointments linked to this client are shown/);
});

test('Calendar and Clients share capability-driven navigation without making Calendar scope a shortcut', () => {
  const enabled = renderCalendarPage(calendarModel(), { clientNavigationAllowed: true, clientsPath: '/calendar/clients' });
  assert.match(enabled, /href="\/calendar\/clients">Clients/);
  const denied = renderCalendarPage(calendarModel());
  assert.match(denied, /workspace-link future[^>]*aria-disabled="true"[^>]*>Clients/);
  assert.doesNotMatch(denied, /href="\/calendar\/clients"/);
});

test('Clients surface is GET-only and introduces no public CRM or mutation route', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workspaceClients.js'), 'utf8');
  const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendar.js'), 'utf8');
  assert.match(routeSource, /requireStaffSession/);
  assert.match(routeSource, /router\.get\('\/'/);
  assert.match(routeSource, /router\.get\('\/:id'/);
  assert.doesNotMatch(routeSource, /router\.(?:post|put|patch|delete)\s*\(/i);
  assert.doesNotMatch(routeSource, /logger|console\.|normalized_mobile|client_contacts/i);
  assert.match(calendarSource, /router\.use\('\/clients'/);
});
