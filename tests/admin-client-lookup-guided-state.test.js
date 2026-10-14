const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobile = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminMobileMenu.js'), 'utf8');

test('ordinary Admin no longer creates or resumes guided client lookup state', () => {
  assert.doesNotMatch(mobile, /CLIENT_LOOKUP_TTL_MS|client_lookup|scopedClientLookup|filterClientsForAdminScope|findClients/);

});

test('underlying CRM lookup implementation is not deleted by menu retirement', () => {
  const lookup = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminClientLookup.js'), 'utf8');
  assert.match(lookup, /findClients/);
  assert.match(lookup, /formatClientLookupReply/);
});
