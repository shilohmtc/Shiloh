const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getShilohMessageContract } = require('../src/services/shilohMessageContracts');
const { buildMetaTemplateRegistrationPayload } = require('../src/services/metaTemplateAdapter');

test('retired problem report sender has no scheduler, route hook, or new legacy outbox writes', () => {
  assert.equal(fs.existsSync('src/services/problemReportNotifications.js'), false);
  assert.doesNotMatch(fs.readFileSync('app.js', 'utf8'), /startProblemReportNotificationScheduler/);
  assert.doesNotMatch(fs.readFileSync('src/routes/workspaceProblemReports.js', 'utf8'), /dispatchProblemReportNotifications/);
  const service = fs.readFileSync('src/services/problemReports.js', 'utf8');
  assert.doesNotMatch(service, /INSERT INTO problem_report_notifications/);
  assert.match(service, /INSERT INTO problem_report_status_events/);
  assert.match(service, /problem_report.status_changed/);
  assert.match(fs.readFileSync('public/my-shiloh/assets/app.js', 'utf8'), /report.resolutionNote/);
});

test('historical report message cannot regain provider registration authority', () => {
  const contract = getShilohMessageContract('problem_report_resolved');
  assert.equal(contract.lifecycle, 'retired');
  assert.equal(contract.sendable, false);
  assert.throws(() => buildMetaTemplateRegistrationPayload(contract.id), /Retired/);
  assert.doesNotMatch(fs.readFileSync('src/services/problemReportResolvedTemplateProvisioning.js', 'utf8'), /axios|submitProblemReport|graph\.facebook/);
});

test('Workspace completion copy describes My Shiloh and never promises retired WhatsApp delivery', () => {
  const {problemReportsClientScript} = require('../src/presentation/workspaceProblemReportsUx');
  const script = problemReportsClientScript();
  assert.doesNotMatch(script,/receive a WhatsApp message/);
  assert.match(script,/My Shiloh updates/);
  assert.doesNotMatch(script,/Phone notifications are attempted|Codex conversation/);
  assert.match(script,/staff member can see the update/);
});
