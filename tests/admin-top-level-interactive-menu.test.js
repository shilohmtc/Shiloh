const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { processAdminInteractiveMenuMessage } = require('../src/services/adminInteractiveMenu');
const { getMenuOptions, processAdminMobileMenuMessage } = require('../src/services/adminMobileMenu');

test('retirement facades cannot advertise or route an operational Admin menu', async () => {
  assert.deepEqual(getMenuOptions({ business_role: 'owner' }), []);
  assert.deepEqual(await processAdminMobileMenuMessage('27720000000', 'Admin'), { handled: false });
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminInteractiveMenu.js'), 'utf8');
  assert.doesNotMatch(source, /Today|Tomorrow|Reports|Earnings|Pending approvals/);
  assert.match(source, /processRetiredAdminAuthorityMessage/);
  assert.equal(typeof processAdminInteractiveMenuMessage, 'function');
});
