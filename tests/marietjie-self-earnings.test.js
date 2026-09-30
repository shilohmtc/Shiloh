const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const retiredEarningsPath = path.join(__dirname, '..', 'src', 'services', 'adminMarietjieEarnings.js');
const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminInteractiveMenu.js'), 'utf8');

test('offboarded practitioner earnings implementation is removed from staff routing', () => {
  assert.equal(fs.existsSync(retiredEarningsPath), false);
  assert.doesNotMatch(menu, /earningsInteractive|adminMarietjieEarnings|marietjieEarningsButtons/);
  assert.match(menu, /processRetiredAdminAuthorityMessage/);
});
