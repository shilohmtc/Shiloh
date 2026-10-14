const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const assistant = read('src/services/adminAssistant.js');

const mobile = read('src/services/adminMobileMenu.js');

const { getMenuOptions, menu } = require('../src/services/adminMobileMenu');

const owner = {
  id: 1,
  staff_id: 10,
  display_name: 'Owner',
  business_role: 'owner',
  calendar_scope: 'all_business',
  service_scope: 'all_services',
  admin_active: true,
  staff_status: 'active',
  permissions: { 'appointment:view': true },
};

test('ordinary WhatsApp Admin menu is retired rather than retained as a parallel staff surface', () => {
  assert.deepEqual(getMenuOptions(owner), []);
  assert.match(menu(owner), /WhatsApp Admin has retired/);

  assert.doesNotMatch(mobile, /admin_action_today|admin_action_tomorrow|admin_action_reports|admin_action_earnings/);
});

test('legacy Assistant remains inert', () => {
  assert.doesNotMatch(assistant, /INSERT|UPDATE|DELETE|prepareAdminBooking|confirmAdminBooking|archiveClientForAdmin/);
  assert.match(assistant, /handled: false, retired: true/);
});
