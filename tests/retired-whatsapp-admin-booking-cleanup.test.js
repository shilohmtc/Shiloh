const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('ordinary WhatsApp staff booking remains retired while client and approval routes stay connected', () => {
  const webhook = read('src/controllers/webhookController.js');
  const retirement = read('src/services/adminAuthorityRetirement.js');
  assert.match(webhook, /processAdminRetiredAuthorityMessage\(from,text\)/);
  assert.match(retirement, /'make a booking'/);
  assert.doesNotMatch(webhook, /processAdminMobileBookingFlowMessage|adminMobileBookingFlow/);
  assert.match(webhook, /processClientBookingProposalMessage\(from,text\)/);
  assert.match(webhook, /processRescheduleApprovalDecision\(from,text\)/);
  assert.match(webhook, /processBookingMessage\(from,text\)/);
  assert.match(webhook, /activeHumanHandoff/);
});

test('retired staff booking modules are not loaded at startup', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const script of [pkg.scripts.start, pkg.scripts.dev]) {
    assert.doesNotMatch(script, /adminProvisionalClientBookingPatch|adminBookingTypedTimePickerPatch|adminUxStandardizationPatch/);
    assert.match(script, /adminBookingProviderGuardPatch/);
    assert.match(script, /clientRescheduleApprovalPatch/);
  }
  for (const file of [
    'src/services/adminMobileBookingFlow.js',
    'src/services/adminMobileBookingSession.js',
    'src/bootstrap/adminProvisionalClientBookingPatch.js',
    'src/bootstrap/adminBookingTypedTimePickerPatch.js',
    'src/bootstrap/adminUxStandardizationPatch.js',
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
});
