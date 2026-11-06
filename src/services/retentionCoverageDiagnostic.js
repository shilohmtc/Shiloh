'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createWorkspaceFinancialReportsService } = require('./workspaceFinancialReports');
const SQL = fs.readFileSync(path.join(__dirname, '../sql/retentionCoverage.sql'), 'utf8');
const WINDOW_START = Date.parse('2026-11-06T06:00:00Z'),
  EXPIRES = Date.parse('2026-11-07T06:00:00Z');
const SERVICE = 'srv-d9qbfmk9v7es73emgam0',
  MAX_RECORDS = 50000;
const countKeys = [
  'appointment_records',
  'modern_only_records',
  'legacy_only_records',
  'dual_link_records',
  'missing_link_records',
  'missing_reference_records',
  'multiple_membership_records',
  'missing_start_records',
  'invalid_end_records',
  'recorded_completed_records',
  'future_completed_records',
  'completed_not_ended_records',
  'observed_modern_completed_profiles',
  'observed_legacy_completed_profiles',
];
const dateKeys = [
  'earliest_observed_date',
  'latest_observed_date',
  'earliest_recorded_completed_date',
];
function failure(code) {
  return Object.assign(new Error(code), { code });
}
function exactKeys(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw failure('INVALID_AGGREGATE');
}
function count(v) {
  if (!Number.isSafeInteger(v) || v < 0 || v > MAX_RECORDS) throw failure('INVALID_AGGREGATE');
}
function date(v) {
  if (v !== null && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)))
    throw failure('INVALID_AGGREGATE');
}
function validate(report) {
  exactKeys(report, ['totals', 'monthly_records', 'source_buckets', 'reset_provenance']);
  exactKeys(report.totals, [...countKeys, ...dateKeys]);
  countKeys.forEach((k) => count(report.totals[k]));
  dateKeys.forEach((k) => date(report.totals[k]));
  if (
    !Array.isArray(report.monthly_records) ||
    report.monthly_records.length > 1200 ||
    !Array.isArray(report.source_buckets) ||
    report.source_buckets.length > 3
  )
    throw failure('OUTPUT_LIMIT');
  for (const r of report.monthly_records) {
    exactKeys(r, ['month', 'linkage', 'status', 'appointment_records']);
    date(r.month);
    if (
      !['modern', 'legacy', 'dual', 'missing'].includes(r.linkage) ||
      ![
        'scheduled',
        'confirmed',
        'completed',
        'no_charge',
        'cancelled',
        'no_show',
        'unknown',
        'other',
      ].includes(r.status)
    )
      throw failure('INVALID_AGGREGATE');
    count(r.appointment_records);
  }
  for (const r of report.source_buckets) {
    exactKeys(r, [
      'source_bucket',
      'appointment_records',
      'recorded_completed_records',
      'earliest_record_created_date',
      'latest_record_created_date',
    ]);
    if (!['imported_goldie', 'shiloh', 'other'].includes(r.source_bucket))
      throw failure('INVALID_AGGREGATE');
    count(r.appointment_records);
    count(r.recorded_completed_records);
    date(r.earliest_record_created_date);
    date(r.latest_record_created_date);
  }
  if (
    report.monthly_records.reduce((n, r) => n + r.appointment_records, 0) !==
      report.totals.appointment_records ||
    report.source_buckets.reduce((n, r) => n + r.appointment_records, 0) !==
      report.totals.appointment_records
  )
    throw failure('INCOMPLETE_AGGREGATE');
  if (
    [
      'modern_only_records',
      'legacy_only_records',
      'dual_link_records',
      'missing_link_records',
    ].reduce((n, k) => n + report.totals[k], 0) !== report.totals.appointment_records ||
    countKeys.some((k) => report.totals[k] > report.totals.appointment_records)
  )
    throw failure('INCOMPLETE_AGGREGATE');
  const reset = report.reset_provenance;
  const resetKeys = [
    'audit_events',
    'legacy_records',
    'marker_records',
    'matched_records',
    'unmatched_marker_records',
    'ambiguous_records',
  ];
  exactKeys(reset, [...resetKeys, 'status_counts']);
  resetKeys.forEach((k) => count(reset[k]));
  if (
    reset.audit_events > 2 ||
    !Array.isArray(reset.status_counts) ||
    reset.status_counts.length > 72
  )
    throw failure('INVALID_AGGREGATE');
  const statuses = [
    'scheduled',
    'confirmed',
    'completed',
    'no_charge',
    'cancelled',
    'no_show',
    'unknown',
    'other',
  ];
  for (const row of reset.status_counts) {
    exactKeys(row, ['prior_status', 'current_status', 'appointment_records']);
    if (
      ![...statuses, 'ambiguous'].includes(row.prior_status) ||
      !statuses.includes(row.current_status)
    )
      throw failure('INVALID_AGGREGATE');
    count(row.appointment_records);
  }
  if (
    reset.legacy_records !== report.totals.legacy_only_records ||
    reset.marker_records > reset.legacy_records ||
    reset.matched_records + reset.unmatched_marker_records !== reset.marker_records ||
    reset.ambiguous_records > reset.matched_records ||
    (reset.audit_events !== 1 && reset.matched_records !== 0) ||
    reset.status_counts.reduce((n, r) => n + r.appointment_records, 0) !== reset.matched_records
  )
    throw failure('INCOMPLETE_AGGREGATE');
  return report;
}
async function inspect({
  db,
  now = () => new Date(),
  access = (client) => createWorkspaceFinancialReportsService({ db: client }),
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5000ms'");
    await client.query("SET LOCAL lock_timeout='1000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='8000ms'");
    // No principal is invented or logged. Require a unique active owner with the existing whole-clinic financial authority.
    const owners = await client.query(
      "SELECT id FROM staff_admin_accounts WHERE active=TRUE AND business_role='owner' ORDER BY id LIMIT 2",
    );
    if (owners.rows.length !== 1) throw failure('OWNER_AUTHORITY_UNAVAILABLE');
    await access(client).requireAccess(Number(owners.rows[0].id));
    const bound = await client.query(
      'SELECT COUNT(*)::int AS count FROM (SELECT 1 FROM appointments LIMIT 50001) bounded',
    );
    if (
      bound.rows.length !== 1 ||
      !Number.isSafeInteger(bound.rows[0].count) ||
      bound.rows[0].count < 0
    )
      throw failure('INVALID_AGGREGATE');
    if (bound.rows[0].count > MAX_RECORDS) throw failure('RECORD_LIMIT');
    const historyBound = await client.query(
      'SELECT COUNT(*)::int AS count FROM (SELECT 1 FROM appointment_status_history LIMIT 50001) bounded',
    );
    if (!Number.isSafeInteger(historyBound.rows[0]?.count) || historyBound.rows[0].count < 0)
      throw failure('INVALID_AGGREGATE');
    if (historyBound.rows[0].count > MAX_RECORDS) throw failure('RECORD_LIMIT');
    const asOf = now().toISOString();
    const result = await client.query(SQL, [asOf]);
    if (result.rows.length !== 1) throw failure('INVALID_AGGREGATE');
    const assessment = validate(result.rows[0].assessment);
    await client.query('ROLLBACK');
    return { asOf, assessment };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
let attempted = false;
function eligible(env, at) {
  return (
    env.RENDER_SERVICE_ID === SERVICE &&
    env.RENDER_GIT_BRANCH === 'main' &&
    env.IS_PULL_REQUEST === 'false' &&
    /^[a-f0-9]{40}$/.test(env.RENDER_GIT_COMMIT || '') &&
    at >= WINDOW_START &&
    at < EXPIRES
  );
}
function makePool() {
  const { Pool } = require('pg'),
    { pool } = require('../db/pool');
  const db = new Pool({
    ...pool.options,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6500,
    idle_in_transaction_session_timeout: 8000,
    application_name: 'shiloh_retention_coverage_diagnostic',
  });
  db.on('error', () => {});
  return db;
}
async function runConfiguredDiagnostic({
  env = process.env,
  now = () => new Date(),
  logger = console,
  poolFactory = makePool,
  inspectImpl = inspect,
} = {}) {
  if (attempted || !eligible(env, now().getTime())) return { enabled: false };
  attempted = true;
  const runId = crypto.randomUUID(),
    sourceCommit = env.RENDER_GIT_COMMIT;
  let db;
  try {
    db = poolFactory();
    const { asOf, assessment } = await inspectImpl({ db, now });
    validate(assessment);
    const digest = crypto.createHash('sha256').update(JSON.stringify(assessment)).digest('hex');
    const chunkCount = Math.ceil(assessment.monthly_records.length / 20);
    logger.info(
      {
        event: 'retention_coverage_summary',
        version: 2,
        runId,
        sourceCommit,
        asOf,
        digest,
        monthlyRows: assessment.monthly_records.length,
        chunkCount,
        totals: assessment.totals,
        sourceBuckets: assessment.source_buckets,
        resetProvenance: assessment.reset_provenance,
        completeCoverageVerified: false,
        stableCrossNamespaceLinkageVerified: false,
        retentionCalculated: false,
      },
      'Aggregate-only retention coverage diagnostic',
    );
    for (let i = 0; i < chunkCount; i++)
      logger.info(
        {
          event: 'retention_coverage_months',
          version: 2,
          runId,
          sourceCommit,
          digest,
          chunk: i + 1,
          chunkCount,
          rows: assessment.monthly_records.slice(i * 20, (i + 1) * 20),
        },
        'Aggregate-only retention coverage diagnostic',
      );
    return { enabled: true, ok: true };
  } catch (e) {
    const allowed = [
      'OWNER_AUTHORITY_UNAVAILABLE',
      'RECORD_LIMIT',
      'OUTPUT_LIMIT',
      'INVALID_AGGREGATE',
      'INCOMPLETE_AGGREGATE',
      '57014',
      '55P03',
      '25006',
    ];
    const code =
      e.httpStatus === 403
        ? 'ACCESS_DENIED'
        : allowed.includes(e.code)
          ? e.code
          : 'DIAGNOSTIC_UNAVAILABLE';
    logger.warn(
      { event: 'retention_coverage_unavailable', version: 2, runId, sourceCommit, code },
      'Aggregate retention coverage unavailable',
    );
    return { enabled: true, ok: false, code };
  } finally {
    if (db) await db.end().catch(() => {});
  }
}
module.exports = { SQL, inspect, validate, eligible, runConfiguredDiagnostic };
