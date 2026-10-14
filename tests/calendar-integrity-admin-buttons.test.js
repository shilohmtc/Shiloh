const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const menu = fs.readFileSync(path.join(__dirname, '..', 'src/services/adminMobileMenu.js'), 'utf8');
const buttons = fs.readFileSync(path.join(__dirname, '..', 'src/services/adminEarningsButtons.js'), 'utf8');

test('ordinary staff menu does not expose Calendar integrity', () => {
  assert.doesNotMatch(menu, /key: 'calendar_integrity'|processAdminCalendarIntegrityMessage|calendarIntegrityButtons/);
});

test('stale integrity buttons normalize to internal-only retirement', () => {
  assert.match(buttons, /admin_calendar_integrity_scan: 'admin_retired_internal_action'/);
  assert.match(buttons, /admin_calendar_integrity_issues: 'admin_retired_internal_action'/);

});
