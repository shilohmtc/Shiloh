const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const liveConfirmation = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'customerBookingConfirmation.js'), 'utf8');

test('booking confirmation v2 provider provisioning is not attached to ordinary startup', () => {
  assert.doesNotMatch(appSource, /META_BOOKING_CONFIRMATION_V2_PROVISION_ON_START/);
  assert.doesNotMatch(appSource, /submitBookingConfirmationV2Template/);
  assert.match(appSource, /verifyMigrationState\(\)/);
});

test('booking confirmation v1 remains an explicit fallback while v2 is selected only by configuration', () => {
  assert.match(liveConfirmation, /WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE/);
  assert.match(liveConfirmation, /LIVE_BOOKING_CONFIRMATION_V1 = 'shiloh_booking_confirmation_v1'/);
  assert.match(liveConfirmation, /LIVE_BOOKING_CONFIRMATION_V2 = 'shiloh_booking_confirmation_v2'/);
  assert.match(liveConfirmation, /bookingConfirmationV2QuickReplyPayloads\(appointmentId\)/);
  assert.match(liveConfirmation, /bodyParameters:\[clientName\|\|'there',serviceName,staffName,date,time\]/);
  assert.match(liveConfirmation, /bodyParameters:\[clientName\|\|'there',serviceName,staffName,date,time,google,ics\|\|google\]/);
});

test('#952 retires the startup-only Meta inventory audit hook', () => {
  assert.doesNotMatch(appSource, /META_TEMPLATE_INVENTORY_AUDIT_ON_START/);
  assert.doesNotMatch(appSource, /inspectMetaTemplateInventory/);
  assert.doesNotMatch(appSource, /Sanitized Meta template inventory audit completed/);
});


test('booking confirmation delivery evidence schema is initialized before startup delivery', () => {
  assert.match(appSource, /ensureDeliveryTable: ensureBookingConfirmationDeliverySchema/);
  assert.match(appSource, /await ensureBookingConfirmationDeliverySchema\(\)/);
  assert.match(appSource, /071_booking_confirmation_template_evidence\.sql/);
  assert.match(appSource, /Booking confirmation delivery evidence schema verified/);
});
