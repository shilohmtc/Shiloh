const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createWorkspaceServiceCategories } = require('../src/services/workspaceServiceCategories');
const { createWorkspaceServicesMutationRouter } = require('../src/routes/workspaceServicesMutations');
const { renderServicesListPage, workspaceServicesManageClientScript } = require('../src/presentation/workspaceServicesUx');

function fakeDb({ used = 0, duplicate = false } = {}) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('WHERE id=$1 FOR UPDATE')) return { rows: [{ id: 7, name: 'Massage', display_order: 2, status: 'active' }] };
    if (sql.includes('LOWER(name)=LOWER($1)')) return { rows: duplicate ? [{ id: 8 }] : [] };
    if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: used }] };
    if (sql.includes('workspaceCategories:list')) return { rows: [{ id: 7, name: 'Massage', display_order: 2, status: 'active', service_count: used }] };
    if (/^(INSERT INTO|UPDATE|DELETE FROM) service_categories/.test(sql)) return { rows: [{ id: 7, name: params[0] || 'Massage', display_order: 2, status: 'active' }] };
    return { rows: [] };
  };
  return { db: { query, async connect() { return { query, release() {} }; } }, calls };
}

const reception = { operatorAdminId: 51, businessRole: 'booking_operator', displayName: 'Shiloh Reception', serviceScope: 'all_services' };
const christel = { operatorAdminId: 2, businessRole: 'owner', displayName: 'Christel', serviceScope: 'all_services' };

test('only the two named Workspace principals with service management authority can manage categories', async () => {
  const fake = fakeDb();
  let principal = reception;
  const service = createWorkspaceServiceCategories({ db: fake.db, manageAccess: async () => principal });
  assert.equal((await service.list(51))[0].name, 'Massage');
  principal = christel;
  assert.equal((await service.list(2))[0].id, 7);
  for (const denied of [null, { ...reception, displayName: 'Other receptionist' }, { ...christel, serviceScope: 'assigned_services' }, { ...christel, businessRole: 'tenant_practitioner' }]) {
    principal = denied;
    await assert.rejects(service.mutate({ adminId: 10, action: 'delete', id: 7 }), { code: 'CATEGORY_FORBIDDEN', httpStatus: 403 });
  }
  assert.equal(fake.calls.some(call => call.sql.startsWith('DELETE FROM service_categories')), false);
});

test('create and edit use canonical categories with audit and refuse duplicate names', async () => {
  const fake = fakeDb();
  const service = createWorkspaceServiceCategories({ db: fake.db, manageAccess: async () => christel });
  await service.mutate({ adminId: 2, action: 'create', name: 'Body Treatments', order: '4' });
  await service.mutate({ adminId: 2, action: 'edit', id: 7, name: 'Massages', order: '3' });
  assert.equal(fake.calls.filter(call => call.sql === 'COMMIT').length, 2);
  assert.equal(fake.calls.filter(call => call.sql.includes('INSERT INTO crm_audit_events')).length, 2);
  assert.equal(fake.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).length, 2);
  const dup = fakeDb({ duplicate: true });
  const other = createWorkspaceServiceCategories({ db: dup.db, manageAccess: async () => reception });
  await assert.rejects(other.mutate({ adminId: 51, action: 'create', name: 'massage', order: 1 }), { code: 'CATEGORY_DUPLICATE' });
  assert.equal(dup.calls.some(call => call.sql.startsWith('INSERT INTO service_categories')), false);
});

test('delete refuses categories with any service, including inactive services; empty delete audits', async () => {
  const occupied = fakeDb({ used: 1 });
  const service = createWorkspaceServiceCategories({ db: occupied.db, manageAccess: async () => reception });
  await assert.rejects(service.mutate({ adminId: 51, action: 'delete', id: 7 }), { code: 'CATEGORY_IN_USE', httpStatus: 409 });
  assert.equal(occupied.calls.some(call => call.sql.startsWith('DELETE FROM service_categories')), false);
  assert.equal(occupied.calls.some(call => call.sql === 'ROLLBACK'), true);
  const empty = fakeDb();
  const safe = createWorkspaceServiceCategories({ db: empty.db, manageAccess: async () => reception });
  await safe.mutate({ adminId: 51, action: 'delete', id: 7 });
  assert.equal(empty.calls.some(call => call.sql.startsWith('DELETE FROM service_categories')), true);
  assert.equal(empty.calls.some(call => call.sql === 'COMMIT'), true);
});

test('category UI appears for authorized list and supports create, edit, delete on phone', () => {
  const model = { authority: { displayName: 'Christel' }, services: [], categories: [{ id: 7, name: 'Massage', displayOrder: 2, serviceCount: 1, status: 'active' }], offset: 0, pageSize: 30 };
  const html = renderServicesListPage(model, { manageAllowed: true });
  assert.match(html, /data-category-create/);
  assert.match(html, /data-category-edit/);
  assert.match(html, /data-category-delete[^>]*[\s\S]*disabled title="Move the services first"/);
  assert.match(html, /@media\(max-width:700px\)/);
  assert.doesNotMatch(renderServicesListPage({ ...model, categories: undefined }, { manageAllowed: false }), /data-category-create/);
  const script = workspaceServicesManageClientScript();
  for (const action of ['create', 'edit', 'delete']) assert.match(script, new RegExp('data-category-' + action));
});

test('category HTTP changes require session, same origin and CSRF', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/calendar/services', createWorkspaceServicesMutationRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService: {
      async validateSessionToken(token) { return token === 'session-ok' ? { ok: true, adminId: 51 } : { ok: false }; },
      validateCsrfToken(_session, token) { return token === 'csrf-ok'; },
    },
    categoryService: { async mutate(payload) { calls.push(payload); return { category: { id: 7 } }; } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = `${base}/calendar/services/categories/create`;
    const headers = { origin: base, 'content-type': 'application/json' };
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://elsewhere.invalid', cookie: 'shiloh_staff_session=session-ok', 'x-shiloh-csrf-token': 'csrf-ok' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, cookie: 'shiloh_staff_session=session-ok' }, body: '{}' })).status, 403);
    const response = await fetch(url, { method: 'POST', headers: { ...headers, cookie: 'shiloh_staff_session=session-ok', 'x-shiloh-csrf-token': 'csrf-ok' }, body: JSON.stringify({ name: 'Body Treatments', displayOrder: 4 }) });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [{ adminId: 51, id: undefined, name: 'Body Treatments', order: 4, action: 'create' }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
