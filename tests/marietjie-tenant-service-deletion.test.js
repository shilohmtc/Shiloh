const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '158_delete_marietjie_tenant_services.sql'),
  'utf8',
);

test('tenant service deletion is scoped to offboarded practitioner-only offerings', () => {
  assert.match(sql, /st\.status='inactive'/);
  assert.match(sql, /saa\.business_role='tenant_practitioner'/);
  assert.match(sql, /saa\.active=FALSE/);
  assert.match(sql, /other_staff\.staff_id<>tenant_id/);
  assert.match(sql, /s\.status<>'inactive'/);
});

test('tenant service deletion refuses shared and unresolved appointments before deleting', () => {
  assert.match(sql, /FROM appointment_groups ag/);
  assert.match(sql, /FROM service_packages sp/);
  assert.match(sql, /approval\.status IN \('pending','awaiting_client_confirmation'\)/);
  assert.match(sql, /request\.status IN \('pending','notification_failed'\)/);
  assert.match(sql, /DELETE FROM services s/);
  assert.doesNotMatch(sql, /DELETE FROM (?:appointments|clients|crm_v2_clients)\b/i);
});
