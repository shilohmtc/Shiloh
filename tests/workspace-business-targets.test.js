'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {
  monthPeriod,
  validateTarget,
  comparison,
} = require('../src/domain/workspaceBusinessTargets');
const {
  createWorkspaceBusinessTargetsService,
} = require('../src/services/workspaceBusinessTargets');
const migration = fs.readFileSync('migrations/200_workspace_monthly_targets.sql', 'utf8');
const input = (extra = {}) => ({
  adminId: 1,
  month: '2026-11',
  metric: 'net_receipts',
  action: 'set',
  target: '1500.10',
  revision: 0,
  operationId: crypto.randomUUID(),
  ...extra,
});
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(
    `CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY,display_name text);INSERT INTO staff_admin_accounts VALUES(1,'Synthetic owner'),(2,'Synthetic admin');CREATE TABLE crm_audit_events(id bigserial,actor_admin_id bigint,action text,entity_type text,entity_id bigint,metadata jsonb);CREATE TABLE appointments(id bigint,status text,starts_at timestamptz);INSERT INTO appointments VALUES(1,'completed','2026-11-01 08:00Z'),(2,'no_charge','2026-11-02 08:00Z'),(3,'cancelled','2026-11-02 08:00Z'),(4,'scheduled','2026-11-03 08:00Z'),(5,'completed','2026-12-01 08:00Z');`,
  );
  await pg.exec(migration);
  const state = {
    denied: false,
    failAudit: false,
    reads: 0,
    receipts: [
      {
        id: 1,
        created_at: '2026-11-01T08:00Z',
        entry_type: 'payment',
        amount: '100',
        method: 'cash',
        source: 'booking',
      },
      {
        id: 2,
        created_at: '2026-11-02T08:00Z',
        entry_type: 'refund',
        amount: '150',
        method: 'cash',
        source: 'booking',
      },
    ],
  };
  const query = async (sql, params) => {
    if (sql.includes('FinancialReports:receipts')) return { rows: state.receipts };
    if (state.failAudit && sql.includes('INSERT INTO crm_audit_events'))
      throw Error('Synthetic audit failure');
    return pg.query(sql, params);
  };
  const db = { query, connect: async () => ({ query, release() {} }) },
    access = () => ({
      requireAccess: async (id) => {
        state.reads++;
        if (state.denied || ![1, 2].includes(id))
          throw Object.assign(Error('Denied'), { httpStatus: 403 });
      },
    });
  return {
    pg,
    state,
    db,
    service: createWorkspaceBusinessTargetsService({
      db,
      access,
      now: () => new Date('2026-11-06T04:00:00Z'),
    }),
  };
}
test('targets distinguish unset and zero, validate month/units, and retain negative net receipts', () => {
  assert.equal(monthPeriod('2024-02').end, '2024-03-01');
  for (const m of ['2026-13', '1999-12', '2100-01', '2026-1', null])
    assert.throws(() => monthPeriod(m));
  for (const target of ['', null, '-1', '1e2', '1.001'])
    assert.throws(() => validateTarget(input({ target })));
  assert.equal(validateTarget(input({ target: '0' })).value, 0);
  assert.equal(validateTarget(input({ metric: 'completed_visits', target: '24' })).value, 24);
  assert.throws(() => validateTarget(input({ metric: 'completed_visits', target: '1.5' })));
  assert.deepEqual(comparison(-5000, null), {
    actual: -5000,
    target: null,
    remaining: null,
    percent: null,
  });
  assert.equal(comparison(-5000, 10000).percent, -50);
  assert.equal(comparison(100, 0).percent, null);
  assert.equal(comparison(NaN, 100).actual, null);
});
test('migration is empty/additive, constrained, transactional, and preserves existing records', async (t) => {
  const { pg } = await fixture(t);
  assert.equal(
    Number(
      (await pg.query('SELECT COUNT(*) n FROM workspace_business_target_revisions')).rows[0].n,
    ),
    0,
  );
  assert.equal(Number((await pg.query('SELECT COUNT(*) n FROM appointments')).rows[0].n), 5);
  for (const [metric, date, action, value] of [
    ['other', '2026-11-01', 'set', 1],
    ['net_receipts', '2026-11-02', 'set', 1],
    ['net_receipts', '2026-11-01', 'clear', 1],
    ['net_receipts', '2026-11-01', 'set', null],
    ['completed_visits', '2026-11-01', 'set', -1],
  ])
    await assert.rejects(
      pg.query(
        'INSERT INTO workspace_business_target_revisions(operation_id,metric,period_start,revision,action,target_value,created_by_admin_id) VALUES($1,$2,$3,1,$4,$5,1)',
        [crypto.randomUUID(), metric, date, action, value],
      ),
    );
  const rollbackDb = new PGlite();
  try {
    await rollbackDb.exec(
      'CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY); CREATE TABLE schema_migrations(filename text,checksum text)',
    );
    await rollbackDb.exec('BEGIN');
    await rollbackDb.exec(migration);
    await rollbackDb.query('INSERT INTO schema_migrations VALUES($1,$2)', [
      '200_workspace_monthly_targets.sql',
      'synthetic-checksum',
    ]);
    await rollbackDb.exec('ROLLBACK');
    assert.equal(
      (
        await rollbackDb.query(
          "SELECT to_regclass('workspace_business_target_revisions') AS relation",
        )
      ).rows[0].relation,
      null,
    );
    assert.equal(
      (await rollbackDb.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0]
        .count,
      0,
    );
  } finally {
    await rollbackDb.close();
  }
});
test('save and clear preserve revisions, idempotency, history, month boundaries and audit without financial writes', async (t) => {
  const { pg, service } = await fixture(t);
  let model = await service.build({ adminId: 1 });
  assert.equal(model.month, '2026-11');
  assert.equal(model.metrics[0].target, null);
  assert.equal(model.metrics[0].actual, -5000);
  assert.equal(model.metrics[1].actual, 2);
  const a = input();
  const first = await service.save(a);
  assert.equal(first.revision, 1);
  assert.equal((await service.save(a)).replayed, true);
  await assert.rejects(service.save({ ...a, target: '999' }), { httpStatus: 409 });
  await assert.rejects(service.save(input()), { httpStatus: 409 });
  await service.save(input({ revision: 1, action: 'clear' }));
  model = await service.build({ adminId: 1, month: '2026-11' });
  assert.equal(model.metrics[0].target, null);
  assert.equal(model.metrics[0].revision, 2);
  assert.equal(model.history.length, 2);
  await service.save(input({ revision: 2, target: '0' }));
  assert.equal((await service.build({ adminId: 1 })).metrics[0].target, 0);
  await service.save(input({ metric: 'completed_visits', target: '10' }));
  assert.equal((await service.build({ adminId: 1 })).metrics[1].percent, 20);
  const future = await service.build({ adminId: 1, month: '2026-12' });
  assert.equal(future.metrics[0].target, null);
  assert.equal(future.metrics[1].actual, 0);
  assert.equal(Number((await pg.query('SELECT COUNT(*) n FROM crm_audit_events')).rows[0].n), 4);
  assert.equal(Number((await pg.query('SELECT COUNT(*) n FROM appointments')).rows[0].n), 5);
});
test('audit failure rolls back the target, and revoked authority prevents reads and writes', async (t) => {
  const { pg, state, service } = await fixture(t);
  state.failAudit = true;
  await assert.rejects(service.save(input()), /audit failure/);
  assert.equal(
    Number(
      (await pg.query('SELECT COUNT(*) n FROM workspace_business_target_revisions')).rows[0].n,
    ),
    0,
  );
  state.failAudit = false;
  state.denied = true;
  await assert.rejects(service.save(input()), { httpStatus: 403 });
  await assert.rejects(service.build({ adminId: 1 }), { httpStatus: 403 });
});
test('permission is checked again inside a save transaction and conflicting revision inserts cannot overwrite', async (t) => {
  const { pg, db } = await fixture(t);
  let checks = 0;
  const service = createWorkspaceBusinessTargetsService({
    db,
    access: () => ({
      requireAccess: async () => {
        if (++checks === 2) throw Object.assign(Error('Revoked'), { httpStatus: 403 });
      },
    }),
  });
  await assert.rejects(service.save(input()), { httpStatus: 403 });
  assert.equal(checks, 2);
  const args = [crypto.randomUUID(), 'net_receipts', '2026-11-01', 1, 'set', 100, 1];
  const sql =
    'INSERT INTO workspace_business_target_revisions(operation_id,metric,period_start,revision,action,target_value,created_by_admin_id) VALUES($1,$2,$3,$4,$5,$6,$7)';
  await pg.query(sql, args);
  await assert.rejects(
    pg.query(sql, [crypto.randomUUID(), ...args.slice(1)]),
    (e) => e.code === '23505',
  );
});
test('target HTTP routes protect reads and writes, bind actor, and preserve conflict and replay responses', async (t) => {
  const express = require('express');
  const { once } = require('node:events');
  const { createWorkspaceReportsRouter } = require('../src/routes/workspaceReports');
  let allowed = true,
    writes = 0,
    replayed = false,
    conflict = false;
  const requireAccess = async () => {
    if (!allowed) throw Object.assign(Error('Denied'), { httpStatus: 403 });
  };
  const app = express();
  app.use(
    '/calendar/reports',
    createWorkspaceReportsRouter({
      env: {
        SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
        SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
      },
      service: {},
      sessionService: {
        validateSessionToken: async (token) => ({ ok: token === 'test', adminId: 4 }),
        validateCsrfToken: (_s, token) => token === 'valid',
      },
      targetsService: {
        requireAccess,
        build: async ({ adminId }) => {
          await requireAccess();
          assert.equal(adminId, 4);
          return { metrics: [] };
        },
        save: async (input) => {
          await requireAccess();
          assert.equal(input.adminId, 4);
          if (conflict) throw Object.assign(Error('Refresh and review'), { httpStatus: 409 });
          writes++;
          return { replayed };
        },
      },
    }),
  );
  app.use((error, _req, res, _next) => res.sendStatus(error.status || 500));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`,
    url = origin + '/calendar/reports/targets',
    headers = {
      Cookie: 'shiloh_staff_session=test',
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Shiloh-CSRF-Token': 'valid',
    };
  const post = (h = headers, body = { adminId: 999 }) =>
    fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await post({ ...headers, Cookie: '' })).status, 401);
  assert.equal((await post({ ...headers, Origin: 'https://other.test' })).status, 403);
  assert.equal((await post({ ...headers, 'X-Shiloh-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await post(headers, { extra: 'x'.repeat(5000) })).status, 413);
  assert.equal(writes, 0);
  assert.equal((await post()).status, 201);
  replayed = true;
  assert.equal((await post()).status, 200);
  conflict = true;
  assert.equal((await post()).status, 409);
  assert.equal(writes, 2);
  let response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  allowed = false;
  assert.equal((await fetch(url, { headers })).status, 403);
  assert.equal((await fetch(url + '.js', { headers })).status, 403);
  assert.equal((await post()).status, 403);
});

test('actual canonical receipt SQL counts shared payments once, refunds, voucher and package sales within SAST month only', async (t) => {
  const { pg } = await fixture(t);
  await pg.exec(`
 CREATE TABLE booking_payment_accounts(id bigint,appointment_id bigint,appointment_group_id bigint);
 CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint);
 CREATE TABLE payment_ledger_entries(id bigint,payment_account_id bigint,created_at timestamptz,entry_type text,amount numeric,method text);
 CREATE TABLE gift_voucher_payment_entries(id bigint,created_at timestamptz,amount numeric,method text,order_id bigint);
 CREATE TABLE gift_vouchers(id bigint,order_id bigint);
 CREATE TABLE gift_voucher_ledger_entries(id bigint,created_at timestamptz,entry_type text,amount numeric,voucher_id bigint,operation_key text);
 CREATE TABLE client_package_entitlements(id bigint,purchased_at timestamptz,purchase_price numeric,payment_method text,payment_status text);
 INSERT INTO booking_payment_accounts VALUES(1,NULL,10);
 INSERT INTO appointment_group_members VALUES(10,1),(10,2);
 INSERT INTO payment_ledger_entries VALUES(1,1,'2026-10-31 22:00Z','payment',200,'cash'),(2,1,'2026-11-02 12:00Z','refund',50,'cash'),(3,1,'2026-10-31 21:59:59Z','payment',999,'cash'),(4,1,'2026-11-06 04:01Z','payment',999,'cash');
 INSERT INTO gift_voucher_payment_entries VALUES(1,'2026-11-03 12:00Z',100,'card_machine',10);
 INSERT INTO gift_vouchers VALUES(1,11);
 INSERT INTO gift_voucher_ledger_entries VALUES(1,'2026-11-03 13:00Z','issue',100,1,'issue:ozow:123'),(2,'2026-11-03 14:00Z','redemption',100,1,'redeem:123');
 INSERT INTO client_package_entitlements VALUES(1,'2026-11-04 12:00Z',250,'manual_eft','paid'),(2,'2026-11-04 12:00Z',999,'manual_eft','pending');
 INSERT INTO appointments VALUES(6,'completed','2026-10-31 22:00Z'),(7,'completed','2026-10-31 21:59:59Z');
 `);
  const query = (...args) => pg.query(...args),
    db = { query, connect: async () => ({ query, release() {} }) };
  const service = createWorkspaceBusinessTargetsService({
    db,
    now: () => new Date('2026-11-06T04:00Z'),
    access: () => ({ requireAccess: async () => {} }),
  });
  const model = await service.build({ adminId: 1, month: '2026-11' });
  assert.equal(model.metrics[0].actual, 60000);
  assert.equal(model.metrics[1].actual, 3);
});
