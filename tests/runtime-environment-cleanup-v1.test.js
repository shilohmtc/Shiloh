const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('production startup does not preload retired #643 Meta reconnect or WABA audit hooks', () => {
  const pkg = JSON.parse(read('package.json'));
  const start = String(pkg.scripts?.start || '');
  assert.doesNotMatch(start, /metaProviderReconnectBootstrap/);
  assert.doesNotMatch(start, /metaWabaTemplatePermissionAuditBootstrap/);
  assert.match(start, /^node scripts\/verify-migrations\.js && /);
});

test('retired browser pilot authority variables stay absent from current Calendar authority', () => {
  const files = [
    'src/services/staffBrowserSession.js',
    'src/routes/calendar.js',
    'src/services/calendarAuthorization.js',
  ].map(read).join('\n');
  assert.doesNotMatch(files, /SHILOH_STAFF_BROWSER_PILOT_MODE_ENABLED/);
  assert.doesNotMatch(files, /SHILOH_STAFF_BROWSER_PILOT_ADMIN_IDS/);
  assert.doesNotMatch(files, /SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED/);
});

test('legacy followup and reminder Meta contracts remain retired', () => {
  const source = read('src/services/shilohMessageContracts.js');
  assert.match(source, /appointment_followup_legacy:\s*'retired'/);
  assert.match(source, /appointment_reminder_legacy:\s*'retired'/);
});

test('#952 retires the TOTP rollout and encryption environment contract', () => {
  const source = [read('app.js'), read('src/routes/calendar.js'), read('src/routes/staffBrowserSession.js')].join('\n');
  assert.doesNotMatch(source, /SHILOH_STAFF_TOTP_(?:PILOT_ADMIN_IDS|AUTH_ENABLED|ENCRYPTION_KEYS_JSON|ACTIVE_KEY_VERSION)/);
});
