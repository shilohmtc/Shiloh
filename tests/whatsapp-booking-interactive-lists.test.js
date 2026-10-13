const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const whatsapp = fs.readFileSync(path.join(root, 'src/services/whatsapp.js'), 'utf8');

const buttons = fs.readFileSync(path.join(root, 'src/services/adminEarningsButtons.js'), 'utf8');

test('retired list entry point has no provider sender or credential dependency', () => {
  assert.match(whatsapp, /async function sendWhatsAppList/);
  assert.doesNotMatch(whatsapp, /axios|graph\.facebook|WHATSAPP_TOKEN|PHONE_NUMBER_ID/);
});

test('stale final booking buttons can only enter Calendar retirement', () => {
  assert.match(buttons, /admin_booking_confirm: 'admin_retired_calendar_action'/);
  assert.match(buttons, /admin_booking_cancel: 'admin_retired_calendar_action'/);
});
