const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('production no longer starts automated staff finalization WhatsApp reminders', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /attendanceFinalizationReminders|historicalFinalizationPrompt/);
  assert.equal(fs.existsSync(path.join(root, 'src/services/attendanceFinalizationReminders.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src/services/historicalFinalizationPrompt.js')), false);
});

test('staff can still finalize visits through the protected Workspace route', () => {
  const route = read('src/routes/workspaceOperational.js');
  assert.match(route, /router\.post\('\/appointments\/:appointmentId\/finalize', sameOrigin, requireCsrf/);
  assert.match(route, /dashboardService\.finalizeVisit\(\{/);
  assert.match(route, /req\.staffBrowserSession\?\.adminId/);
});
