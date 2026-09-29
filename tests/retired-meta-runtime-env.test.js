const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validateEnv } = require('../src/config/env');
const { channelReady } = require('../src/services/workspaceClientNotifications');

test('Shiloh starts without retired outbound Meta credentials', () => {
  assert.doesNotThrow(() => validateEnv({ OPENAI_API_KEY: 'app-ai', DATABASE_URL: 'postgres://test' }));
  assert.throws(() => validateEnv({ DATABASE_URL: 'postgres://test' }), /OPENAI_API_KEY/);
});

test('Workspace never offers the retired booking confirmation send in production', () => {
  assert.equal(channelReady(process.env), false);
  const startup = fs.readFileSync('app.js', 'utf8');
  assert.doesNotMatch(startup, /META_WORKSPACE_BOOKING_REQUEST_ALERT_PROVISION_ON_START|META_PROBLEM_REPORT_RESOLVED_PROVISION_ON_START/);
  assert.doesNotMatch(startup, /submitWorkspaceBookingRequestAlertTemplate|submitProblemReportResolvedTemplate/);
});
