const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const identityPath = path.join(__dirname, '..', 'src', 'services', 'clientIdentityOnboarding.js');

const identity = fs.readFileSync(identityPath, 'utf8');

test('registration state preserves continuation without storing the original booking message', () => {
  assert.match(identity, /booking_requested/);
  assert.match(identity, /resumeBooking: true/);
  assert.doesNotMatch(identity, /booking_request_text|booking_payload|booking_json/);
});

test('ambiguous client identity remains fail closed', () => {
  assert.match(identity, /identity\.status\s*===\s*"ambiguous"/);
  assert.match(identity, /verify the correct profile|identity conflict/i);

});
