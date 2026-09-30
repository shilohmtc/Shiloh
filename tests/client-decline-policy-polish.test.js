const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
function read(relativePath) { return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'); }
test('cannot-accommodate outcome preserves app status without a retired provider delivery claim', () => { const source = read('src/services/clientBookingApproval.js'); assert.match(source, /status_available_in_app_phone_alert_retired/); assert.doesNotMatch(source, /sendWhatsAppTemplate|WHATSAPP_BOOKING_DECLINED_TEMPLATE/); });
test('booking policy exposes one current client-facing version while preserving versioned acceptance evidence', () => { const source = read('src/services/bookingPolicy.js'); const authority = read('src/config/bookingPolicyAuthority.js'); assert.match(source, /BOOKING_POLICY_VERSION: POLICY_VERSION/); assert.match(source, /BOOKING_POLICY_TEXT: POLICY_TEXT/); assert.match(authority, /BOOKING_POLICY_VERSION = '2026-09-30-v5'/); assert.match(authority, /Policy updated:/); assert.match(authority, /Policy version:/); assert.match(source, /policy_version = \$2/); assert.match(source, /POLICY_VERSION/); });
