'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootstrapScript } = require('../src/presentation/staffPasskeyBootstrapUx');

test('#842 Reception bootstrap retries once without stale excludeCredentials after InvalidStateError', () => {
  const script = bootstrapScript();
  assert.match(script, /receptionRecovery=String\(b\.displayName\|\|''\)==='Shiloh Reception'/);
  assert.match(script, /InvalidStateError'&&receptionRecovery&&!staleCredentialRetryUsed/);
  assert.match(script, /staleCredentialRetryUsed=true/);
  assert.match(script, /if\(receptionRecovery&&staleCredentialRetryUsed\)o\.excludeCredentials=\[\]/);
});

test('#842 stale-credential retry does not remove server-side duplicate credential rejection', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'staffPasskeyDeviceBootstrap.js'), 'utf8');
  assert.match(service, /SELECT id FROM staff_auth_passkey_credentials WHERE credential_id = \$1 LIMIT 1 FOR UPDATE/);
  assert.match(service, /reason: 'credential_exists'/);
  assert.match(service, /return \{ ok: false, code: 'STAFF_PASSKEY_BOOTSTRAP_INVALID' \}/);
});
