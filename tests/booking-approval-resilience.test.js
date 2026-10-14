const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('pending approval list and resend implementation is removed at cutover', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/services/adminPendingBookingApprovals.js')), false);

});

test('legacy staff decision IDs cannot reach a booking mutation', () => {
  const approval = source('src/services/clientBookingApproval.js');

  assert.doesNotMatch(approval, /booking_approval_(?:approve|decline)_/);

});
