'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function filesBelow(relative) {
  const root = path.join(ROOT, relative);
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(path.relative(ROOT, child)));
    else output.push(child);
  }
  return output;
}

function runtimeSource() {
  return [path.join(ROOT, 'app.js'), ...filesBelow('src'), ...filesBelow('scripts')]
    .filter(file => /\.(?:js|json)$/.test(file))
    .map(file => `${path.relative(ROOT, file)}\n${fs.readFileSync(file, 'utf8')}`)
    .join('\n');
}

test('#952 removes TOTP, recovery-code, and break-glass runtime authority', () => {
  const source = runtimeSource();
  for (const retired of [
    'SHILOH_STAFF_TOTP_AUTH_ENABLED',
    'SHILOH_STAFF_TOTP_PILOT_ADMIN_IDS',
    'SHILOH_STAFF_TOTP_ENCRYPTION_KEYS_JSON',
    'SHILOH_STAFF_TOTP_ACTIVE_KEY_VERSION',
    'providerIndependentStaffAuth',
    'staffAuthBrowserEnrollment',
    '/totp/',
    'staff_auth_break_glass_bootstraps',
    'staff_totp_credentials',
  ]) assert.doesNotMatch(source, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('#952 keeps canonical passkey and WhatsApp setup authority wired', () => {
  const calendar = fs.readFileSync(path.join(ROOT, 'src/routes/calendar.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(ROOT, 'src/services/staffWhatsAppPasskeyBootstrap.js'), 'utf8');
  const passkey = fs.readFileSync(path.join(ROOT, 'src/services/staffPasskeyAuth.js'), 'utf8');
  assert.match(calendar, /createStaffPasskeyBootstrapRouter/);
  assert.match(calendar, /createStaffPasskeyAuthRouter/);
  assert.match(bootstrap, /normalized_whatsapp/);
  assert.match(bootstrap, /device_replaced/);
  assert.match(passkey, /STRONG_AUTH_METHODS = new Set\(\['passkey'\]\)/);
});

test('#952 retires stale production selectors and startup-only inventory audit', () => {
  const source = runtimeSource();
  assert.doesNotMatch(source, /WHATSAPP_BOOKING_APPROVAL_(?:REQUEST|OUTCOME)_TEMPLATE/);
  assert.doesNotMatch(source, /META_TEMPLATE_INVENTORY_AUDIT_ON_START/);
});
