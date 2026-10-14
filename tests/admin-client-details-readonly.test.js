const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lookupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminClientLookup.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminMobileMenu.js'), 'utf8');

test('underlying client lookup helper remains read-only if needed by another bounded surface later', () => {
  assert.match(lookupSource, /maskContact/);
  assert.match(lookupSource, /async function getClientDetails\(/);
  assert.match(lookupSource, /function formatClientDetailsReply\(/);
  assert.doesNotMatch(lookupSource, /\b(?:UPDATE|INSERT|DELETE)\s+(?:clients|client_contacts)\b/i);
});

test('ordinary WhatsApp Admin no longer routes client lookup/details', () => {
  assert.doesNotMatch(menuSource, /findClients|filterClientsForAdminScope|scopedClientLookup|client_lookup/);

});

test('client lookup helper retains masked ambiguity handling even though it is no longer an ordinary Admin action', () => {
  assert.match(lookupSource, /Refine the name or number to narrow the lookup/);
  assert.match(lookupSource, /maskContact/);
});
