const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isStaffPasskeyAuthEnabled,
  passkeyNavigationClientScript,
} = require('../src/routes/workspaceOperational');

test('Workspace passkey navigation is feature-flag bounded', () => {
  assert.equal(isStaffPasskeyAuthEnabled({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true' }), true);
  assert.equal(isStaffPasskeyAuthEnabled({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'TRUE' }), true);
  assert.equal(isStaffPasskeyAuthEnabled({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'false' }), false);
  assert.equal(isStaffPasskeyAuthEnabled({}), false);
});

test('enabled Workspace nav exposes authenticated Devices & sign-in destination without credential material', () => {
  const script = passkeyNavigationClientScript({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true' });
  assert.match(script, /Devices & sign-in/);
  assert.match(script, /\/calendar\/staff-auth\/passkeys\/manage/);
  assert.match(script, /data-workspace-account-footer/);
  assert.match(script, /data-shiloh-logout/);
  assert.doesNotMatch(script, /credentialId|publicKey|challenge|mobile|totp|recovery/i);
});

test('disabled Workspace nav emits no passkey management destination', () => {
  assert.equal(passkeyNavigationClientScript({ SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'false' }), '');
});
