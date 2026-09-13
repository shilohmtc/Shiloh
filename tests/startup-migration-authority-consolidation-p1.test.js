const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrations = require('../src/services/migrations');

function reconciledLedger() {
  return migrations.migrationInventory().map(({ filename, checksum }) => ({
    filename,
    checksum,
    applied_at: '2026-08-29T00:00:00.000Z',
  }));
}

function verificationDb(ledger = reconciledLedger(), tableName = 'schema_migrations') {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^ROLLBACK$/.test(sql)) return { rows: [], rowCount: 0 };
      if (/to_regclass\('public\.schema_migrations'\)/.test(sql)) return { rows: [{ table_name: tableName }], rowCount: 1 };
      if (/SELECT filename, checksum, applied_at FROM schema_migrations/.test(sql)) return { rows: ledger, rowCount: ledger.length };
      throw new Error(`Unexpected verification SQL: ${sql}`);
    },
  };
}

test('production startup is verification-only and keeps runtime schedulers', () => {
  const pkg = JSON.parse(read('package.json'));
  const app = read('app.js');
  assert.match(pkg.scripts.start, /^node scripts\/verify-migrations\.js && node /);
  assert.doesNotMatch(pkg.scripts.start, /scripts\/ensure-/);
  assert.doesNotMatch(pkg.scripts.start, /TemplateProvisioningBootstrap|abigailJawReleaseMappingPatch/);
  assert.match(app, /verifyMigrationState\(\)/);
  assert.doesNotMatch(app, /applyMigrationFile|ensureMassagePackageSchema|ensureDemoClientPermissions|runDummyTestAppointmentCleanup/);
  assert.doesNotMatch(app, /submitStaffFinalizationTemplate|submitBookingConfirmationTemplate|submitClientLifecycleTemplate/);
  for (const scheduler of [
    'startConversationSessionCleanupScheduler',
    'startTemporarySessionCleanupScheduler',
    'startGoogleBusinessProfileSyncScheduler',
    'startAppointmentLifecycleScheduler',
    'startCustomerCareScheduler',
    'startBookingIntegrityScheduler',
    'startCustomerBookingConfirmationScheduler',
    'startMandatoryDemoCleanupScheduler',
    'startAttendanceFinalizationReminderScheduler',
    'startHistoricalFinalizationPromptScheduler',
  ]) assert.match(app, new RegExp(`${scheduler}\\(\\)`));
});

test('one supported production command owns migration application', () => {
  const pkg = JSON.parse(read('package.json'));
  const maintenance = read('scripts/maintenance.js');
  const runner = read('scripts/migrate.js');
  assert.equal(pkg.scripts['db:migrate'], 'node scripts/migrate.js');
  assert.doesNotMatch(maintenance, /db-migrate|applyPendingMigrations|applyMigrationFile/);
  assert.match(runner, /applyPendingMigrations/);
  assert.match(runner, /Unknown migration runner argument/);
});

test('reconciled startup verification is read-only and reports exact authority', async () => {
  const db = verificationDb();
  const state = await migrations.verifyMigrationState({ db });
  assert.equal(state.migrationFiles, migrations.migrationFiles().length);
  assert.equal(state.ledgerRows, migrations.migrationFiles().length);
  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.checksumMismatches, []);
  assert.deepEqual(state.ledgerRowsAbsentFromRelease, []);
  assert.equal(db.calls[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(db.calls.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)));
});

test('startup fails closed for pending, mismatch, unknown ledger file, and missing ledger', async () => {
  const ledger = reconciledLedger();
  await assert.rejects(
    migrations.verifyMigrationState({ db: verificationDb(ledger.slice(0, -1)) }),
    (error) => error.code === 'MIGRATION_PENDING'
  );
  const mismatch = ledger.map((row, index) => index === 0 ? { ...row, checksum: 'wrong' } : row);
  await assert.rejects(
    migrations.verifyMigrationState({ db: verificationDb(mismatch) }),
    (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH'
  );
  await assert.rejects(
    migrations.verifyMigrationState({ db: verificationDb([...ledger, { filename: '999_unknown.sql', checksum: 'x' }]) }),
    (error) => error.code === 'MIGRATION_LEDGER_UNKNOWN_FILE'
  );
  await assert.rejects(
    migrations.verifyMigrationState({ db: verificationDb([], null) }),
    (error) => error.code === 'MIGRATION_LEDGER_MISSING'
  );
});

test('controlled executor keeps migration SQL and ledger row atomic', async () => {
  const calls = [];
  const filename = migrations.migrationFiles().at(-1);
  const migrationSql = read(`migrations/${filename}`);
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/SELECT checksum, applied_at FROM schema_migrations/.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO schema_migrations/.test(sql)) return { rows: [{ applied_at: '2026-08-29T00:00:00Z' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await migrations.applyMigrationFile(filename, { db });
  assert.equal(result.applied, true);
  const begin = calls.findIndex(({ sql }) => sql === 'BEGIN');
  const body = calls.findIndex(({ sql }) => sql === migrationSql);
  const ledger = calls.findIndex(({ sql }) => /INSERT INTO schema_migrations/.test(sql));
  const commit = calls.findIndex(({ sql }) => sql === 'COMMIT');
  assert.ok(begin >= 0 && body > begin && ledger > body && commit > ledger);
  assert.equal(calls.some(({ sql }) => sql === 'ROLLBACK'), false);
});

test('canonical pending runner applies one valid additive release migration', async () => {
  const inventory = migrations.migrationInventory();
  const pending = inventory.at(-1);
  const applied = inventory.slice(0, -1).map((row) => ({ ...row, applied_at: '2026-08-29T00:00:00Z' }));
  const appliedMap = new Map(applied.map((row) => [row.filename, row]));
  const db = {
    async query(sql, values = []) {
      if (/to_regclass\('public\.schema_migrations'\)/.test(sql)) return { rows: [{ table_name: 'schema_migrations' }], rowCount: 1 };
      if (/SELECT filename, checksum, applied_at FROM schema_migrations/.test(sql)) return { rows: applied, rowCount: applied.length };
      if (/SELECT checksum, applied_at FROM schema_migrations/.test(sql)) {
        const row = appliedMap.get(values[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO schema_migrations/.test(sql)) return { rows: [{ applied_at: '2026-08-29T00:01:00Z' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await migrations.applyPendingMigrations({ db });
  assert.deepEqual(result.applied, [pending.filename]);
  assert.equal(result.skipped.length, inventory.length - 1);
});

test('controlled executor rolls back SQL and ledger together on migration failure', async () => {
  const calls = [];
  const filename = migrations.migrationFiles().at(-1);
  const migrationSql = read(`migrations/${filename}`);
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/SELECT checksum, applied_at FROM schema_migrations/.test(sql)) return { rows: [], rowCount: 0 };
      if (sql === migrationSql) throw new Error('synthetic migration failure');
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(migrations.applyMigrationFile(filename, { db }), /synthetic migration failure/);
  assert.equal(calls.includes('ROLLBACK'), true);
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.some((sql) => /INSERT INTO schema_migrations/.test(sql)), false);
});

test('unknown migration is rejected before database access', async () => {
  let touched = false;
  await assert.rejects(
    migrations.applyMigrationFile('999_not_released.sql', { db: { async query() { touched = true; } } }),
    (error) => error.code === 'MIGRATION_UNKNOWN_FILE'
  );
  assert.equal(touched, false);
});

test('startup-adjacent migration guards verify rather than apply', () => {
  for (const relative of [
    'src/services/clientRescheduleApprovalSchema.js',
    'src/services/clientRescheduleApprovedNotification.js',
    'src/services/juvanBookingApprovalPolicy.js',
    'scripts/ensure-client-identity-verification.js',
    'scripts/ensure-client-facing-name-authority.js',
    'scripts/ensure-staff-browser-sessions.js',
    'scripts/ensure-goldie-wave-a-publication.js',
    'scripts/ensure-goldie-wave-b-publication.js',
    'scripts/ensure-goldie-targeted-sports-name-correction.js',
  ]) {
    const source = read(relative);
    assert.match(source, /verifyMigrationFile/);
    assert.doesNotMatch(source, /applyMigrationFile/);
  }
  const delivery = read('src/services/customerBookingConfirmation.js');
  const verifier = delivery.slice(delivery.indexOf('async function ensureDeliveryTable'), delivery.indexOf('async function loadBookingConfirmationAuthority'));
  assert.match(verifier, /verifyMigrationFiles/);
  assert.doesNotMatch(verifier, /\b(?:CREATE|ALTER|UPDATE|DELETE|INSERT)\b/);
});
