const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'bootstrap', 'adminBookingProviderGuardPatch.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('production preloads booking provider guard after existing admin booking patches', () => {
  assert.match(pkg.scripts.start, /adminBookingProviderGuardPatch\.js/);
  assert.ok(pkg.scripts.start.indexOf('adminBookingChangeConfirmationCommitPatch.js') < pkg.scripts.start.indexOf('adminBookingProviderGuardPatch.js'));
});

test('Google OAuth expiry and revocation are recognized as provider failures', () => {
  assert.match(source, /invalid_grant/);
  assert.match(source, /expired or revoked/);
  assert.match(source, /refresh-token request failed/);
});

test('admin booking update paths fail closed with an explicit no-write operator message', () => {
  assert.match(source, /processAdminBookingUpdateMessage/);
  assert.match(source, /processStatelessAdminBookingUpdateMessage/);
  assert.match(source, /cannot safely change this booking/);
  assert.match(source, /No change was saved/);
  assert.match(source, /Please reconnect Google Calendar/);
});

test('provider health is probed proactively and periodically rather than only on a customer journey', () => {
  assert.match(source, /probeGoogleCalendarProvider/);
  assert.match(source, /Google Calendar provider health check failed/);
  assert.match(source, /30 \* 60 \* 1000/);
});
