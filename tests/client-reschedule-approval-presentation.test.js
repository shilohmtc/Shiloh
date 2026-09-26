const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const patch = fs.readFileSync(path.join(__dirname, '..', 'src', 'bootstrap', 'clientRescheduleApprovalPatch.js'), 'utf8');

test('enabled reschedule approval flow presents a request rather than an immediate mutation', () => {
  assert.match(patch, /approvalAwareReschedulePresentation/);
  assert.match(patch, /\*Request this reschedule\?\*/);
  assert.match(patch, /title: 'Request change'/);
  assert.match(patch, /current appointment remains confirmed/i);
  assert.match(patch, /only replace it after the clinic confirms the change/i);
});

test('legacy confirmation presentation remains untouched while the feature gate is off', () => {
  assert.match(patch, /if \(!featureEnabled\(\) \|\| result\?\.interactive\?\.type !== 'button'\) return result/);
});
