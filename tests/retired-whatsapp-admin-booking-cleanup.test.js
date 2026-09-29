const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the mounted WhatsApp route acknowledges messages without loading the retired staff controller', () => {
  const app = read('app.js');
  const webhook = read('src/routes/webhook.js');
  assert.match(app, /require\("\.\/src\/routes\/webhook"\)/);
  assert.match(webhook, /processWhatsAppStatusWebhook/);
  assert.match(webhook, /\(_req, res\) => res\.sendStatus\(200\)/);
  assert.doesNotMatch(app + webhook, /webhookController|adminMobileBookingFlow|processAdminMobileBookingFlowMessage/);
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
