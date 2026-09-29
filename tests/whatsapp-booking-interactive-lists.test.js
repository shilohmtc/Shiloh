const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const whatsapp = fs.readFileSync(path.join(root, 'src/services/whatsapp.js'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'src/controllers/webhookController.js'), 'utf8');
const buttons = fs.readFileSync(path.join(root, 'src/services/adminEarningsButtons.js'), 'utf8');

test('WhatsApp transport supports Meta interactive list messages and enforces row bounds', () => {
  assert.match(whatsapp, /async function sendWhatsAppList/);
  assert.match(whatsapp, /type: "list"/);
  assert.match(whatsapp, /rows\.length < 1 \|\| rows\.length > 10/);
  assert.match(whatsapp, /title\.length > 24/);
  assert.match(whatsapp, /description\.length > 72/);
});

test('incoming list replies are parsed but ordinary admin booking flow is no longer dispatched', () => {
  assert.match(webhook, /message\.interactive\?\.type==="list_reply"/);
  assert.match(webhook, /message\.interactive\.list_reply\?\.id/);
  assert.match(webhook, /sendWhatsAppList/);
  assert.doesNotMatch(webhook, /activeMobileBooking|processAdminMobileBookingFlowMessage/);
  assert.match(webhook, /processAdminRetiredAuthorityMessage\(from,text\)/);
});

test('stale final booking buttons can only enter Calendar retirement', () => {
  assert.match(buttons, /admin_booking_confirm: 'admin_retired_calendar_action'/);
  assert.match(buttons, /admin_booking_cancel: 'admin_retired_calendar_action'/);
});
