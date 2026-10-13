const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateEnv } = require('../src/config/env');
const { channelReady } = require('../src/services/workspaceClientNotifications');

test('retired isolated Meta provisioning and audit entry points cannot be loaded', () => {
  for (const relative of [
    'scripts/provision-consultation-form-templates.js',
    'src/bootstrap/staffAuthTemplateProvisioningBootstrap.js',
    'src/bootstrap/metaWabaTemplatePermissionAuditBootstrap.js',
    'src/services/staffAuthTemplateProvisioning.js',
    'src/services/metaWabaTemplatePermissionAudit.js',
    'src/controllers/clientLifecycleTemplateController.js',
  ]) {
    assert.throws(() => require.resolve(path.join(__dirname, '..', relative)),
      { code: 'MODULE_NOT_FOUND' }, relative);
  }
});

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
