const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrations = fs.readFileSync(path.join(root, 'src', 'services', 'migrations.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApprovalSchema.js'), 'utf8');
const patch = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'clientRescheduleApprovalPatch.js'), 'utf8');

test('migration service supports one exact checksum-guarded migration without applying unrelated pending files', () => {
  assert.match(migrations, /async function applyMigrationFile\(filename, \{ db = pool \} = \{\}\)/);
  assert.match(migrations, /Unknown migration file/);
  assert.match(migrations, /Migration \$\{safeFilename\} has changed after being applied/);
  assert.match(migrations, /INSERT INTO schema_migrations/);
  assert.match(migrations, /applyMigrationFile,/);
});

test('reschedule schema bootstrap preserves migration 064 and verifies the bounded 087 identity expansion', () => {
  assert.match(schema, /064_client_reschedule_practitioner_approval\.sql/);
  assert.match(schema, /087_whatsapp_crm_v2_reschedule_compat\.sql/);
  assert.match(schema, /verifyMigrationFiles\(\[BASE_MIGRATION, MIGRATION\]\)/);
  assert.doesNotMatch(schema, /applyMigrationFile/);
  assert.match(schema, /to_regclass\('public\.appointment_reschedule_requests'\)/);
  assert.match(schema, /uq_appointment_reschedule_requests_pending_appointment/);
  assert.match(schema, /idx_appointment_reschedule_requests_pending_staff/);
  assert.match(schema, /legacy_identity_nullable/);
  assert.match(schema, /crm_v2_identity_column/);
  assert.match(schema, /crm_v2_restrict_fk/);
  assert.match(schema, /client_identity_xor/);
  assert.match(schema, /Client reschedule approval schema verification failed/);
});

test('startup evidence exposes only sanitized activation prerequisites', () => {
  assert.match(schema, /featureEnabled: clientRescheduleRequestsEnabled\(\)/);
  assert.match(schema, /approvalTemplateConfigured: String\(process\.env\.WHATSAPP_RESCHEDULE_APPROVAL_REQUEST_TEMPLATE/);
  assert.match(schema, /=== APPROVAL_TEMPLATE/);
  assert.match(schema, /declinedPhoneAlertRetired: true/);
  assert.doesNotMatch(schema, /WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE/);
  assert.doesNotMatch(schema, /approvalTemplateValue|declinedTemplateValue|DATABASE_URL/);
});

test('preload starts schema verification and gated table paths await it', () => {
  assert.match(patch, /const schemaReady = ensureClientRescheduleApprovalSchema\(\)/);
  assert.match(patch, /Client reschedule approval schema verified/);
  assert.match(patch, /Client reschedule approval schema initialization failed; feature remains unusable/);
  const awaits = patch.match(/await schemaReady;/g) || [];
  assert.ok(awaits.length >= 3, `expected retained gated paths to await schema readiness, found ${awaits.length}`);
});
