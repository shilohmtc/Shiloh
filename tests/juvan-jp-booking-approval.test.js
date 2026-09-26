const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('historical Juvan approval migrations remain immutable evidence', () => {
  const migration065 = read('migrations/065_juvan_botha_jp_booking_approval.sql');
  const migration068 = read('migrations/068_juvan_primary_backup_booking_approval.sql');
  assert.match(migration065, /juvan_botha_jp_booking_approval/);
  assert.match(migration068, /controlled_juvan_primary_backup/);
  assert.match(migration068, /required_approver_admin_id := targeted_policy_admin_id/);
});

test('migration 095 retired future Juvan special-case authority without rewriting history', () => {
  const migration095 = read('migrations/095_retire_juvan_primary_backup_booking_approval.sql');
  assert.match(migration095, /CREATE OR REPLACE FUNCTION create_client_booking_approval_hold\(\)/);
  assert.doesNotMatch(migration095, /required_approval_mode := 'controlled_juvan_primary_backup'/);
  assert.doesNotMatch(migration095, /UPDATE appointment_booking_approvals/);
});

test('#765 future booking requests use canonical assignment snapshots with no person policy', () => {
  const migration108 = read('migrations/108_workspace_booking_request_resolution.sql');
  const schema = read('src/services/clientBookingApprovalSchema.js');
  const approval = read('src/services/clientBookingApproval.js');
  for (const source of [migration108, schema]) {
    assert.match(source, /requested_staff_id/);
    assert.match(source, /requested_service_id/);
    assert.doesNotMatch(source, /juvan|dummy test|jean-pierre|abigail|christel/i);
  }
  assert.doesNotMatch(approval, /resolveJuvanApprovalPolicy|resolveDummyTestApprovalPolicy|controlled_juvan_primary_backup/i);
  assert.match(approval, /BUSINESS_WIDE_ROLES\.has\(role\) && scope === 'all_business'/);
});

test('Reset Juvan and historical identity verification remain technical-only', () => {
  const menu = read('src/services/adminInteractiveMenu.js');
  const bootstrap = read('src/services/juvanBookingApprovalPolicy.js');
  const app = read('app.js');
  assert.doesNotMatch(menu, /Reset Juvan|reset_juvan|processAdminTestClientResetMessage/);
  assert.match(bootstrap, /verifyMigrationFiles/);
  assert.doesNotMatch(bootstrap, /applyMigrationFile/);
  assert.doesNotMatch(app, /ensureJuvanBookingApprovalPolicy/);
});
