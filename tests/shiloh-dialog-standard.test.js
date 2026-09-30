const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);
}
test('Shiloh app presentation cannot introduce native confirm or alert popups', () => {
  for (const file of [...files('src/presentation'), ...files('src/routes'), ...files('public')]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\bwindow\.(?:confirm|alert)\s*\(|(?<!function )(?<![\w.])(?:confirm|alert)\s*\((?!\?)/, file);
  }
});
test('all migrated confirmation scripts compile with awaited explicit decisions', () => {
  const scripts = {
    workspaceConfirmation: 'confirmationClientScript', workspaceStaffUx: 'workspaceStaffManageClientScript',
    workspaceAccessV2Ux: 'workspaceAccessV2ClientScript', workspaceStaffAccessProfilesUx: 'clientScript',
    workspaceClientsManageUx: 'workspaceClientsManageClientScript', workspaceDashboardUx: 'dashboardClientScript',
    operatorContactAuthorityUx: 'operatorContactAuthorityClientScript', calendarPaymentsUx: 'calendarPaymentsClientScript',
    workspaceClientNotificationsUx: 'bookingConfirmationClientScript', shilohRewardsUx: 'clientRewardsScript',
    calendarOperationalMutationsUx: 'calendarOperationalMutationsClientScript', inPersonBookingPolicyUx: 'inPersonBookingPolicyClientScript',
  };
  for (const [file, method] of Object.entries(scripts)) {
    const script = require('../src/presentation/' + file)[method]();
    assert.doesNotThrow(() => new Function(script), file);
  }
});
