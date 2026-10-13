const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getMenuOptions } = require('../src/services/adminMobileMenu');

const rollout = fs.readFileSync(path.join(__dirname, '..', 'migrations', '037_p2_staff_rollout_permissions.sql'), 'utf8');
const demoAccess = fs.readFileSync(path.join(__dirname, '..', 'migrations', '043_demo_client_staff_access.sql'), 'utf8');

function rolloutBlock(name) {
  return rollout.split(/(?=UPDATE staff_admin_accounts)/)
    .find((block) => block.includes(`WHERE LOWER(display_name)='${name}';`)) || '';
}

const common = {
  staff_id: 1,
  permissions: {
    'appointment:view': true,
    'client:lookup': true,
    'walkin:create': true,
    'staff:services:view': true,
    'service:pricing': true,
  },
};

test('checked-in production role contracts remain unchanged', () => {
  assert.match(rolloutBlock('christel'), /business_role='owner'/);
  assert.match(rolloutBlock('christel'), /calendar_scope='all_business'/);
  assert.match(rolloutBlock('marietjie'), /business_role='tenant_practitioner'/);
  assert.match(rolloutBlock('abigail'), /business_role='employee_practitioner'/);
  assert.match(demoAccess, /permissions = COALESCE\(permissions, '\{\}'::jsonb\) - 'demo:client'/);
});

test('named roles advertise only retained and capability-gated actions', () => {
  for (const admin of [
    { ...common, display_name: 'Christel', business_role: 'owner', calendar_scope: 'all_business' },
    { ...common, display_name: 'Abigail', business_role: 'employee_practitioner', calendar_scope: 'own_appointments' },
    { ...common, display_name: 'Marietjie', business_role: 'tenant_practitioner', calendar_scope: 'own_services' },
  ]) {
    const keys = getMenuOptions(admin).map((option) => option.key);
    for (const key of keys) assert.ok(actionForId(`admin_action_${key}`), `${admin.display_name}: ${key}`);
    for (const retired of ['availability', 'demo_client', 'booking', 'manage_booking', 'schedule', 'calendar_integrity', 'finalize']) {
      assert.equal(keys.includes(retired), false, `${admin.display_name}: ${retired}`);
    }
  }
});

test('named-person earnings shortcuts are not stable top-level actions', () => {
  const interactive = fs.readFileSync(path.join(__dirname, '..', 'src/services/adminInteractiveMenu.js'), 'utf8');
  assert.doesNotMatch(interactive, /christel_earnings|abigail_earnings|marietjie_earnings|admin_action_earnings/);
  assert.match(interactive, /processRetiredAdminAuthorityMessage/);
});
