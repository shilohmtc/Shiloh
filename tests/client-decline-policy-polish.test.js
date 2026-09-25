const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
function read(relativePath) { return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'); }
test('cannot-accommodate outcome uses the retained client template and canonical restart payload', () => { const source = read('src/services/clientBookingApproval.js'); const interactive = read('src/services/clientBookingInteractive.js'); assert.match(source, /shiloh_booking_declined_v1/); assert.match(source, /\['client_booking_start'\]/); assert.match(interactive, /client_booking_start: 'services'/); });
test('booking policy exposes one current client-facing version while preserving versioned acceptance evidence', () => { const source = read('src/services/bookingPolicy.js'); const authority = read('src/config/bookingPolicyAuthority.js'); assert.match(source, /BOOKING_POLICY_VERSION: POLICY_VERSION/); assert.match(source, /BOOKING_POLICY_TEXT: POLICY_TEXT/); assert.match(authority, /BOOKING_POLICY_VERSION = '2026-09-25-v3'/); assert.match(authority, /Policy updated:/); assert.match(authority, /Policy version:/); assert.match(source, /policy_version = \$2/); assert.match(source, /POLICY_VERSION/); });
