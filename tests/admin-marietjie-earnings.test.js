const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const buttons = fs.readFileSync('src/services/adminEarningsButtons.js', 'utf8');
const menu = fs.readFileSync('src/services/adminInteractiveMenu.js', 'utf8');

test('offboarded practitioner earnings module is absent and stale buttons fail closed', () => {
  assert.equal(fs.existsSync('src/services/adminMarietjieEarnings.js'), false);
  assert.match(buttons, /admin_marietjie_earnings_today: 'admin_retired_named_earnings'/);
  assert.doesNotMatch(menu, /marietjie_earnings|processAdminMarietjieEarningsMessage|earningsInteractive/);
  assert.match(menu, /processRetiredAdminAuthorityMessage/);
});
