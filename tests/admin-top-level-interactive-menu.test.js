const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getMenuOptions, processAdminMobileMenuMessage } = require('../src/services/adminMobileMenu');

test('retirement facades cannot advertise or route an operational Admin menu', async () => {
  assert.deepEqual(getMenuOptions({ business_role: 'owner' }), []);
  assert.deepEqual(await processAdminMobileMenuMessage('27720000000', 'Admin'), { handled: false });

});
