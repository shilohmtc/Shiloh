const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApprovedNotification.js'), 'utf8');
const patchSource = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'clientRescheduleApprovedNotificationPatch.js'), 'utf8');
const approvalSource = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApproval.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'migrations', '065_client_reschedule_approved_confirmation.sql'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const { canonicalOutcomeState } = require('../src/services/clientRescheduleApprovedNotification');

function futureContext(overrides = {}) {
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return {
    request_status: 'approved',
    request_client_id: 41,
    request_crm_v2_client_id: null,
    appointment_client_id: 41,
    appointment_crm_v2_client_id: null,
    requested_by_phone: '27820000000',
    client_notified_at: null,
    client_notification_suppressed_at: null,
    appointment_status: 'confirmed',
    current_starts_at: start,
    current_ends_at: end,
    proposed_starts_at: start,
    proposed_ends_at: end,
    client_phone: '27820000000',
    ...overrides,
  };
}

test('approved reschedule outcome uses the existing exact reschedule confirmation contract', () => {
  assert.match(serviceSource, /const TEMPLATE_NAME = 'shiloh_reschedule_confirmation_v1'/);
  assert.match(serviceSource, /WHATSAPP_RESCHEDULE_CONFIRMATION_TEMPLATE/);
  assert.match(serviceSource, /sendWhatsAppTemplate\([\s\S]*context\.client_name[\s\S]*context\.service_name[\s\S]*context\.staff_name[\s\S]*fmtDate\(context\.current_starts_at\)[\s\S]*fmtTime\(context\.current_starts_at\)/);
  assert.doesNotMatch(serviceSource, /shiloh_booking_update_v1|WHATSAPP_BOOKING_UPDATE_TEMPLATE/);
});

test('router only intercepts when the latest canonical time audit is the practitioner-approved reschedule', () => {
  const audit = serviceSource.match(/async function latestApprovedRescheduleAudit[\s\S]*?async function loadApprovedRequestContext/);
  assert.ok(audit);
  assert.match(audit[0], /action='appointment\.time_updated'/);
  assert.doesNotMatch(audit[0], /AND metadata->>'source'='client_reschedule_approval'/);
  assert.match(audit[0], /metadata->>'source' AS source/);
  assert.match(audit[0], /row\?\.source !== 'client_reschedule_approval'/);
  assert.match(patchSource, /if \(changeKind === 'time'\)/);
  assert.match(patchSource, /return originalQueueCustomerChangeNotification\(appointmentId, changeKind/);
});

test('approval path is captured through preload ordering without changing the dark feature gate', () => {
  assert.match(approvalSource, /queueCustomerChangeNotification\(appointmentId, 'time'\)/);
  const startScript = JSON.parse(pkg).scripts.start;
  const notificationPatch = startScript.indexOf('clientRescheduleApprovedNotificationPatch.js');
  const approvalPatch = startScript.indexOf('clientRescheduleApprovalPatch.js');
  assert.ok(notificationPatch >= 0 && approvalPatch > notificationPatch);
  assert.match(approvalSource, /clientRescheduleRequestsEnabled\(\)/);
});

test('migration adds durable retry, claim and suppression state to the canonical reschedule request', () => {
  assert.match(migrationSource, /client_notification_attempt_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(migrationSource, /client_notification_last_error TEXT/);
  assert.match(migrationSource, /client_notification_claimed_at TIMESTAMPTZ/);
  assert.match(migrationSource, /client_notification_suppressed_at TIMESTAMPTZ/);
  assert.match(migrationSource, /client_notification_suppression_reason TEXT/);
  assert.match(migrationSource, /idx_appointment_reschedule_requests_approved_unnotified/);
  assert.match(migrationSource, /WHERE status='approved'[\s\S]*client_notified_at IS NULL[\s\S]*client_notification_suppressed_at IS NULL/);
});

test('canonical approved outcome is deliverable only while the approved target remains authoritative', () => {
  assert.deepEqual(canonicalOutcomeState(futureContext()), { deliverable: true, suppress: false, reason: null });

  const changedStart = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  assert.deepEqual(
    canonicalOutcomeState(futureContext({ current_starts_at: changedStart })),
    { deliverable: false, suppress: true, reason: 'canonical_appointment_changed_after_approval' }
  );
  assert.deepEqual(
    canonicalOutcomeState(futureContext({ appointment_status: 'cancelled' })),
    { deliverable: false, suppress: true, reason: 'appointment_cancelled_after_approval' }
  );
});

test('ended and already-notified approved outcomes do not send again', () => {
  const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.deepEqual(
    canonicalOutcomeState(futureContext({
      current_starts_at: pastStart,
      proposed_starts_at: pastStart,
      current_ends_at: pastEnd,
      proposed_ends_at: pastEnd,
    })),
    { deliverable: false, suppress: true, reason: 'appointment_already_ended' }
  );
  assert.deepEqual(
    canonicalOutcomeState(futureContext({ client_notified_at: new Date().toISOString() })),
    { deliverable: false, suppress: false, reason: 'already_sent' }
  );
});

test('temporarily missing client contact remains retryable instead of being falsely marked delivered', () => {
  assert.deepEqual(
    canonicalOutcomeState(futureContext({ client_phone: null })),
    { deliverable: false, suppress: false, reason: 'client_phone_not_found' }
  );
  assert.match(serviceSource, /markApprovedRescheduleNotificationRetryableError/);
  assert.match(serviceSource, /client_notification_last_error/);
});

test('stale delivery claims are recoverable and active claims cannot double-send', () => {
  assert.match(serviceSource, /const CLAIM_STALE_MINUTES = 5/);
  const claim = serviceSource.match(/async function claimApprovedRescheduleNotification[\s\S]*?async function attemptApprovedRescheduleConfirmation/);
  assert.ok(claim);
  assert.match(claim[0], /client_notification_claimed_at IS NULL[\s\S]*client_notification_claimed_at <= NOW\(\) - INTERVAL/);
  assert.match(serviceSource, /already_claimed_or_completed/);
  const flush = serviceSource.match(/async function flushApprovedRescheduleConfirmations[\s\S]*?function startApprovedRescheduleConfirmationScheduler/);
  assert.ok(flush);
  assert.match(flush[0], /client_notification_claimed_at IS NULL[\s\S]*client_notification_claimed_at <= NOW\(\) - INTERVAL/);
});

test('successful delivery records client notification and an auditable provider message reference', () => {
  assert.match(serviceSource, /SET client_notified_at=NOW\(\)/);
  assert.match(serviceSource, /customer\.reschedule_confirmation_sent/);
  assert.match(serviceSource, /providerMessageId/);
  assert.match(serviceSource, /sourceAuditEventId/);
  assert.match(serviceSource, /idempotentDelivery: true/);
});
