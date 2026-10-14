const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { commandForAdminButton } = require('../src/services/adminEarningsButtons');

const { getMenuOptions } = require('../src/services/adminMobileMenu');

test('legacy Demo and Appointments controls normalize only to retirement dispositions', () => {
  assert.equal(commandForAdminButton('admin_menu_appointments'), 'admin_menu_appointments');
  assert.equal(commandForAdminButton('admin_demo_client_start'), 'admin_retired_internal_action');

});

test('ordinary staff menu never exposes Demo or an alternate Appointments panel', () => {
  const admin = {
    display_name: 'Christel',
    business_role: 'owner',
    calendar_scope: 'all_business',
    permissions: {
      'appointment:view': true,
      'appointment:create': true,
      'booking:update': true,
      'demo:client': true,
    },
  };
  const keys = getMenuOptions(admin).map((option) => option.key);
  assert.equal(keys.includes('demo_client'), false);
  assert.equal(keys.includes('appointments'), false);
  assert.equal(keys.includes('booking'), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/services/adminAppointmentsMenu.js')), false);
});
