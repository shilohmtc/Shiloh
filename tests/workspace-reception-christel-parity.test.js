'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RECEPTION_PRESET, expectedPermissions } = require('../src/services/workspaceReceptionAccess');
const { dashboardAuthority } = require('../src/services/workspaceDashboard');
const { canAccessWorkspaceBackupFinalization } = require('../src/services/attendanceFinalizationAuthority');

const EXPECTED_CHRISTEL_CAPABILITIES = [
  'appointment:view', 'appointment:create', 'appointment:record_past', 'appointment:adjust_end',
  'calendar:booking:reschedule', 'calendar:booking:cancel', 'calendar:booking:reassign',
  'client:lookup', 'client:delete', 'client:manage', 'client:notify', 'walkin:create',
  'booking:update', 'loyalty:redeem', 'service:pricing', 'appointment:couples:discount', 'staff:services:view',
  'services:view', 'services:manage', 'services:create', 'schedule:manage',
  'staff:view', 'staff:manage', 'staff_access:manage', 'staff_auth:reset',
];

test('#845 permanent Reception preset equals Christel reviewed canonical capabilities', () => {
  assert.deepEqual([...RECEPTION_PRESET.capabilities].sort(), [...EXPECTED_CHRISTEL_CAPABILITIES].sort());
  assert.deepEqual(Object.keys(expectedPermissions()).sort(), [...EXPECTED_CHRISTEL_CAPABILITIES].sort());
  assert.equal(RECEPTION_PRESET.role, 'receptionist');
  assert.equal(RECEPTION_PRESET.businessRole, 'booking_operator');
});

test('#845 all-business booking:update is effective for Reception Dashboard finalization', () => {
  const permissions = expectedPermissions();
  const row = { active: true, admin_active: true, staff_id: null, display_name: 'Shiloh Reception', business_role: 'booking_operator', calendar_scope: 'all_business', permissions };
  const authority = dashboardAuthority({ permissions, calendarAuthority: { linkedStaffId: null, businessRole: row.business_role, calendarScope: row.calendar_scope, capabilities: Object.keys(permissions) } });
  assert.equal(authority.mode, 'business_overview');
  assert.equal(authority.canFinalizeAllBusiness, true);
  assert.equal(canAccessWorkspaceBackupFinalization(row), true);
});

test('#845 migration fails closed on identity or capability drift and changes permissions only', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/115_reception_christel_access_parity.sql'), 'utf8');
  assert.match(migration, /expected exactly one active canonical Christel owner/);
  assert.match(migration, /expected exactly one active canonical Shiloh Reception principal/);
  assert.match(migration, /Christel capability authority drifted/);
  assert.match(migration, /Reception has unreviewed enabled authority/);
  assert.match(migration, /SET permissions=expected_permissions/);
  assert.doesNotMatch(migration, /SET[^;]*(whatsapp|normalized_whatsapp|credential|passkey|session)/i);
  assert.match(migration, /workspace\.reception_access_parity_approved/);
  assert.match(migration, /COUNT\(\*\) FROM jsonb_object_keys\(expected_permissions\)/);
  assert.match(migration, /'credentialMaterialChanged',FALSE/);
  assert.match(migration, /'sessionMaterialChanged',FALSE/);
});
