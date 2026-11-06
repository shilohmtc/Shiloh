const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { inspect, validate, eligible } = require('../src/services/retentionCoverageDiagnostic');
const now = () => new Date('2026-11-06T08:00:00Z');
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
 CREATE TABLE staff_admin_accounts(id bigint,active boolean,business_role text,display_name text,permissions jsonb,calendar_scope text,service_scope text,staff_id bigint);
 CREATE TABLE staff(id bigint,display_name text,status text);
 INSERT INTO staff_admin_accounts VALUES(1,true,'owner','PRIVATE STAFF NAME','{"staff_earnings:manage":true,"appointment:view":true,"payment:view":true,"voucher:view":true}','all_business','all_services',NULL);
 CREATE TABLE clients(id bigint); INSERT INTO clients VALUES(7),(8);
 CREATE TABLE crm_v2_clients(id bigint); INSERT INTO crm_v2_clients VALUES(101),(102),(103),(104),(105);
 CREATE TABLE appointments(id bigint,status text,starts_at timestamptz,ends_at timestamptz,created_at timestamptz,client_id bigint,crm_v2_client_id bigint,source text,notes text);
 CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint);
 CREATE TABLE appointment_status_history(id bigint,appointment_id bigint,from_status text,to_status text,changed_by text,reason text,changed_at timestamptz);
 CREATE TABLE crm_audit_events(id bigint,action text,metadata jsonb,created_at timestamptz);
 INSERT INTO appointments VALUES
 (1,'completed','2026-01-31 22:30Z','2026-01-31 23:30Z','2026-02-01',NULL,101,'shiloh','PRIVATE TREATMENT NOTE'),
 (2,'completed','2026-03-01 10:00Z','2026-03-01 11:00Z','2026-03-01',7,NULL,'goldie','PRIVATE TREATMENT NOTE'),
 (3,'no_charge','2026-03-02 10:00Z','2026-03-02 11:00Z','2026-03-02',8,102,'shiloh','PRIVATE TREATMENT NOTE'),
 (4,'cancelled','2026-03-03 10:00Z','2026-03-03 11:00Z','2026-03-03',NULL,NULL,'PRIVATE SOURCE NAME','PRIVATE TREATMENT NOTE'),
 (5,'scheduled','2026-05-01 10:00Z','2026-05-01 11:00Z','2026-05-01',NULL,103,'shiloh','PRIVATE TREATMENT NOTE'),
 (6,'completed','2026-12-01 10:00Z','2026-12-01 11:00Z','2026-06-01',NULL,104,'shiloh','PRIVATE TREATMENT NOTE'),
 (7,'PRIVATE STATUS NAME',NULL,NULL,'2026-01-01',NULL,105,'shiloh','PRIVATE TREATMENT NOTE'),
 (8,'completed','2026-04-01 10:00Z','2026-04-01 11:00Z','2026-04-01',NULL,999,'shiloh','PRIVATE TREATMENT NOTE');
 INSERT INTO appointment_group_members VALUES(1,1),(2,1),(1,3);`);
  const calls = [];
  let held;
  const query = async (sql, args) => {
    calls.push(sql);
    if (held) await held(sql);
    return pg.query(sql, args);
  };
  const db = { connect: async () => ({ query, release() {} }) };
  return {
    pg,
    db,
    calls,
    setHook: (fn) => {
      held = fn;
    },
  };
}
test('live-shaped aggregate query separates namespaces, excludes identifiers, and uses a bounded read-only snapshot', async (t) => {
  const { pg, db, calls, setHook } = await fixture(t);
  setHook(async (sql) => {
    if (sql.startsWith('SELECT COUNT(*)::int AS count'))
      assert.equal(
        (await pg.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
        'on',
      );
  });
  const { assessment: r, asOf } = await inspect({ db, now });
  assert.equal(asOf, now().toISOString());
  assert.equal(r.totals.appointment_records, 8);
  assert.equal(r.totals.modern_only_records, 5);
  assert.equal(r.totals.legacy_only_records, 1);
  assert.equal(r.totals.dual_link_records, 1);
  assert.equal(r.totals.missing_link_records, 1);
  assert.equal(r.totals.missing_reference_records, 1);
  assert.equal(r.totals.multiple_membership_records, 1);
  assert.equal(r.totals.future_completed_records, 1);
  assert.equal(r.totals.missing_start_records, 1);
  assert.equal(r.totals.observed_modern_completed_profiles, 1);
  assert.equal(r.totals.observed_legacy_completed_profiles, 1);
  assert.equal(r.totals.earliest_observed_date, '2026-02-01');
  assert.ok(r.monthly_records.some((x) => x.status === 'other'));
  assert.ok(r.source_buckets.some((x) => x.source_bucket === 'other'));
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|notes|client_id|phone|mobile/);
  assert.ok(calls.includes("SET LOCAL statement_timeout='5000ms'"));
  assert.ok(calls.includes("SET LOCAL lock_timeout='1000ms'"));
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS count FROM appointments')).rows[0].count,
    8,
  );
  await pg.exec('DELETE FROM appointments; DELETE FROM appointment_group_members');
  const empty = (await inspect({ db, now })).assessment;
  assert.equal(empty.totals.appointment_records, 0);
  assert.equal(empty.totals.earliest_observed_date, null);
  assert.deepEqual(empty.monthly_records, []);
});
test('canonical owner financial permissions deny revoked, scoped and ambiguous authority before any appointment read', async (t) => {
  const { pg, db, calls } = await fixture(t);
  for (const sql of [
    "UPDATE staff_admin_accounts SET permissions=permissions-'payment:view'",
    "UPDATE staff_admin_accounts SET permissions=permissions||'{\"payment:view\":true}',service_scope='own_services'",
    "UPDATE staff_admin_accounts SET service_scope='all_services',calendar_scope='own_staff'",
    "UPDATE staff_admin_accounts SET calendar_scope='all_business',active=false",
  ]) {
    await pg.exec(sql);
    calls.length = 0;
    await assert.rejects(inspect({ db, now }));
    assert.ok(!calls.some((s) => s.includes('FROM appointments')));
    assert.equal(calls.at(-1), 'ROLLBACK');
  }
  await pg.exec(
    'UPDATE staff_admin_accounts SET active=true; INSERT INTO staff_admin_accounts SELECT 2,active,business_role,display_name,permissions,calendar_scope,service_scope,staff_id FROM staff_admin_accounts',
  );
  await assert.rejects(inspect({ db, now }), { code: 'OWNER_AUTHORITY_UNAVAILABLE' });
});
test('reset provenance requires exact run audit and transaction time, deduplicates history, and never infers attendance', async (t) => {
  const { pg, db } = await fixture(t);
  await pg.exec(`INSERT INTO crm_audit_events VALUES(1,'control.calendar_occupancy_reset','{"runId":"calendar-reset-2026-08-30-v1","private":"SECRET"}','2026-08-30T10:00Z');
    INSERT INTO appointment_status_history VALUES
    (1,2,'completed','cancelled','control:00','Authorized clean-calendar occupancy reset #584','2026-08-30T10:00Z'),
    (2,1,'scheduled','cancelled','control:00','Authorized clean-calendar occupancy reset #584','2026-08-30T10:00Z'),
    (3,3,'confirmed','cancelled','control:00','Authorized clean-calendar occupancy reset #584','2026-08-30T10:00Z');`);
  let r = (await inspect({ db, now })).assessment.reset_provenance;
  assert.equal(r.legacy_records, 1);
  assert.equal(r.matched_records, 1);
  assert.deepEqual(r.status_counts, [
    { prior_status: 'completed', current_status: 'completed', appointment_records: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(r), /SECRET|appointment_id|changed_by|reason/);
  await pg.exec(
    'INSERT INTO appointment_status_history SELECT 4,appointment_id,from_status,to_status,changed_by,reason,changed_at FROM appointment_status_history WHERE id=1',
  );
  r = (await inspect({ db, now })).assessment.reset_provenance;
  assert.equal(r.matched_records, 1);
  assert.equal(r.ambiguous_records, 1);
  assert.equal(r.status_counts[0].prior_status, 'ambiguous');
  await pg.exec(
    "DELETE FROM appointment_status_history WHERE id=4; UPDATE appointment_status_history SET changed_at='2026-08-30T10:01Z' WHERE id=1",
  );
  r = (await inspect({ db, now })).assessment.reset_provenance;
  assert.equal(r.marker_records, 1);
  assert.equal(r.matched_records, 0);
  assert.equal(r.unmatched_marker_records, 1);
  await pg.exec(
    "UPDATE appointment_status_history SET changed_at='2026-08-30T10:00Z'; INSERT INTO crm_audit_events SELECT 2,action,metadata,created_at FROM crm_audit_events",
  );
  r = (await inspect({ db, now })).assessment.reset_provenance;
  assert.equal(r.audit_events, 2);
  assert.equal(r.matched_records, 0);
  await pg.exec(
    "DELETE FROM crm_audit_events; INSERT INTO crm_audit_events VALUES(3,'control.calendar_occupancy_reset','{\"runId\":\"another-run\"}','2026-08-30T10:00Z')",
  );
  r = (await inspect({ db, now })).assessment.reset_provenance;
  assert.equal(r.audit_events, 0);
  assert.equal(r.matched_records, 0);
});
test('record limits and database cancellation fail closed without partial diagnostic output', async (t) => {
  const { db, calls } = await fixture(t);
  const bounded = {
    connect: async () => {
      const client = await db.connect();
      const query = client.query;
      client.query = (sql, args) =>
        sql.includes('LIMIT 50001')
          ? Promise.resolve({ rows: [{ count: 50001 }] })
          : query(sql, args);
      return client;
    },
  };
  await assert.rejects(inspect({ db: bounded, now }), { code: 'RECORD_LIMIT' });
  assert.ok(!calls.some((s) => s.includes('WITH facts')));
  const historyBounded = {
    connect: async () => {
      const client = await db.connect(),
        query = client.query;
      client.query = (sql, args) =>
        sql.includes('FROM appointment_status_history LIMIT 50001')
          ? Promise.resolve({ rows: [{ count: 50001 }] })
          : query(sql, args);
      return client;
    },
  };
  await assert.rejects(inspect({ db: historyBounded, now }), { code: 'RECORD_LIMIT' });
  assert.ok(!calls.some((s) => s.includes('WITH facts')));
  const denied = {
    connect: async () => {
      const client = await db.connect();
      const query = client.query;
      client.query = (sql, args) =>
        sql.includes('WITH facts')
          ? Promise.reject(Object.assign(Error('PRIVATE SQL DETAIL'), { code: '57014' }))
          : query(sql, args);
      return client;
    },
  };
  await assert.rejects(inspect({ db: denied, now }), { code: '57014' });
  assert.equal(calls.at(-1), 'ROLLBACK');
});
test('strict output validation rejects extra identifying fields, unknown values and truncated groups', async (t) => {
  const { db } = await fixture(t);
  const r = (await inspect({ db, now })).assessment;
  for (const change of [
    (x) => {
      x.client_name = 'PRIVATE';
    },
    (x) => {
      x.monthly_records[0].name = 'PRIVATE';
    },
    (x) => {
      x.monthly_records[0].status = 'PRIVATE';
    },
    (x) => {
      x.source_buckets[0].source_bucket = 'PRIVATE';
    },
    (x) => {
      x.monthly_records = [];
    },
    (x) => {
      x.totals.appointment_records = -1;
    },
    (x) => {
      x.monthly_records = Array(1201).fill(x.monthly_records[0]);
    },
    (x) => {
      x.reset_provenance.client_name = 'PRIVATE';
    },
    (x) => {
      x.reset_provenance.matched_records = 1;
    },
    (x) => {
      x.reset_provenance.status_counts = [
        { prior_status: 'PRIVATE', current_status: 'cancelled', appointment_records: 1 },
      ];
    },
  ]) {
    const x = structuredClone(r);
    change(x);
    assert.throws(() => validate(x));
  }
});
const env = {
  RENDER_SERVICE_ID: 'srv-d9qbfmk9v7es73emgam0',
  RENDER_GIT_BRANCH: 'main',
  IS_PULL_REQUEST: 'false',
  RENDER_GIT_COMMIT: 'a'.repeat(40),
};
function fresh() {
  delete require.cache[require.resolve('../src/services/retentionCoverageDiagnostic')];
  return require('../src/services/retentionCoverageDiagnostic');
}
test('execution is restricted to the approved service/main/time window, no endpoint, and once per process', async (t) => {
  for (const overrides of [
    { RENDER_SERVICE_ID: 'other' },
    { RENDER_GIT_BRANCH: 'feature' },
    { IS_PULL_REQUEST: 'true' },
    { RENDER_GIT_COMMIT: 'secret' },
  ])
    assert.equal(eligible({ ...env, ...overrides }, now().getTime()), false);
  assert.equal(eligible(env, Date.parse('2026-11-07T06:00Z')), false);
  assert.equal(eligible(env, Date.parse('2026-11-06T05:59Z')), false);
  const mod = fresh();
  let pools = 0,
    closed = 0;
  const { db } = await fixture(t);
  const messages = [];
  const options = {
    env,
    now,
    logger: { info: (o) => messages.push(o), warn: (o) => messages.push(o) },
    poolFactory: () => {
      pools++;
      return {
        ...db,
        end: async () => {
          closed++;
        },
      };
    },
  };
  assert.equal((await mod.runConfiguredDiagnostic({ ...options, env: {} })).enabled, false);
  assert.equal(pools, 0);
  assert.equal((await mod.runConfiguredDiagnostic(options)).ok, true);
  assert.equal((await mod.runConfiguredDiagnostic(options)).enabled, false);
  assert.equal(pools, 1);
  assert.equal(closed, 1);
  assert.equal(messages[0].retentionCalculated, false);
  assert.equal(messages[0].completeCoverageVerified, false);
  assert.equal(messages[0].chunkCount, messages.length - 1);
  assert.equal(messages[0].version, 2);
  const reconstructed = {
    totals: messages[0].totals,
    source_buckets: messages[0].sourceBuckets,
    monthly_records: messages.slice(1).flatMap((m) => m.rows),
    reset_provenance: messages[0].resetProvenance,
  };
  assert.equal(
    require('node:crypto').createHash('sha256').update(JSON.stringify(reconstructed)).digest('hex'),
    messages[0].digest,
  );
  assert.doesNotMatch(
    JSON.stringify(messages),
    /PRIVATE|client_id|notes|connectionString|DATABASE_URL/,
  );
  assert.match(
    fs.readFileSync('app.js', 'utf8'),
    /server = app.listen[\s\S]*runConfiguredDiagnostic/,
  );
});
test('execution sanitizes failures without logging SQL, credentials or arbitrary exception text', async () => {
  const messages = [];
  const result = await fresh().runConfiguredDiagnostic({
    env,
    now,
    poolFactory: () => ({ end: async () => {} }),
    inspectImpl: async () => {
      throw Object.assign(Error('postgres://PRIVATE:SECRET@host/client'), { code: 'PRIVATE SQL' });
    },
    logger: { info: (o) => messages.push(o), warn: (o) => messages.push(o) },
  });
  assert.equal(result.code, 'DIAGNOSTIC_UNAVAILABLE');
  assert.equal(messages.length, 1);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE|SECRET|postgres:/);
});

test('read-only snapshot rejects writes at the database boundary', async (t) => {
  const { pg, db, setHook } = await fixture(t);
  setHook(async (sql) => {
    if (sql.includes('LIMIT 50001')) {
      await pg.query('SAVEPOINT readonly_probe');
      await assert.rejects(pg.query('INSERT INTO clients(id) VALUES (9999)'), { code: '25006' });
      await pg.query('ROLLBACK TO SAVEPOINT readonly_probe');
    }
  });
  await inspect({ db, now });
  assert.equal(
    (await pg.query('SELECT COUNT(*)::int AS count FROM clients WHERE id=9999')).rows[0].count,
    0,
  );
});
