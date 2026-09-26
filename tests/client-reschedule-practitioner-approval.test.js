const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleApproval.js'), 'utf8');
const holdReconciliation = fs.readFileSync(path.join(root, 'src', 'services', 'clientRescheduleHoldReconciliation.js'), 'utf8');
const patch = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'clientRescheduleApprovalPatch.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '064_client_reschedule_practitioner_approval.sql'), 'utf8');
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

test('practitioner-approved client reschedule is dark by default', () => {
  assert.match(service, /WHATSAPP_RESCHEDULE_APPROVAL_ENABLED === 'true'/);
  assert.match(patch, /if \(!featureEnabled\(\)\) return originalProcessAppointmentChangeMessage/);
  assert.match(pkg, /clientRescheduleApprovalPatch\.js/);
});

test('pending request preserves original appointment and holds only the proposed slot', () => {
  assert.match(migration, /appointment_reschedule_requests/);
  assert.match(migration, /original_starts_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /proposed_starts_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /WHERE status = 'pending'/);
  assert.match(service, /pendingRescheduleConflicts/);
  assert.match(holdReconciliation, /'reschedule_hold'::text/);
  assert.match(patch, /getConflictsWithRescheduleHolds/);
  assert.match(patch, /checkAvailabilityWithRescheduleHolds/);
  const create = service.match(/async function createPendingRescheduleRequest[\s\S]*?async function loadRequestContext/);
  assert.ok(create);
  assert.doesNotMatch(create[0], /UPDATE appointments SET starts_at=/);
  assert.match(create[0], /Your current appointment remains confirmed and unchanged until the requested change is approved/);
});

test('only one pending reschedule request may exist per appointment and it has no automatic expiry', () => {
  assert.match(migration, /UNIQUE INDEX[\s\S]*appointment_id[\s\S]*WHERE status = 'pending'/);
  assert.doesNotMatch(migration, /expires_at|TTL|interval '.*hour/i);
  assert.doesNotMatch(service, /setTimeout|expirePending/i);
});

test('request path revalidates canonical Shiloh availability under practitioner lock', () => {
  const create = service.match(/async function createPendingRescheduleRequest[\s\S]*?async function loadRequestContext/);
  assert.ok(create);
  assert.match(create[0], /pg_advisory_xact_lock/);
  assert.match(create[0], /loadAppointmentForRequest\(phone, appointment\.id, db, true\)/);
  assert.match(create[0], /validateCandidate/);
  assert.match(service, /checkClinicHours/);
  assert.match(service, /checkAuthoritativeSchedule/);
  assert.match(service, /canonicalConflicts/);
  assert.doesNotMatch(service, /validateExternalCalendars|checkCalendarAvailability|checkPractitionerCalendarAvailability|appointment_calendar_events/);
});

test('same-practitioner single-service boundary and immutable snapshots fail closed', () => {
  assert.match(service, /staff_count/);
  assert.match(service, /service_count/);
  assert.match(service, /complex_practitioner_setup/);
  assert.match(service, /complex_service_setup/);
  assert.match(service, /requested_service_id/);
  assert.match(service, /current_service_id/);
  assert.match(service, /current_staff_id/);
  assert.match(service, /canonicalStillMatchesRequest/);
  assert.match(service, /Number\(context\.current_service_id \|\| 0\) === Number\(context\.requested_service_id \|\| 0\)/);
  assert.match(service, /new Date\(context\.current_starts_at\).*new Date\(context\.original_starts_at\)/s);
});

test('ordinary availability filters stale holds read-only and does not reconcile by mutation', () => {
  const live = holdReconciliation.match(/async function livePendingRescheduleConflicts[\s\S]*?async function reconcileStalePendingRescheduleHolds/);
  assert.ok(live);
  assert.match(holdReconciliation, /const LIVE_PENDING_WHERE/);
  assert.match(holdReconciliation, /appointment\.starts_at IS NOT DISTINCT FROM request\.original_starts_at/);
  assert.match(holdReconciliation, /appointment\.ends_at IS NOT DISTINCT FROM request\.original_ends_at/);
  assert.match(holdReconciliation, /request\.approver_staff_id/);
  assert.match(holdReconciliation, /request\.service_id/);
  assert.match(live[0], /WHERE \$\{LIVE_PENDING_WHERE\}/);
  assert.doesNotMatch(live[0], /UPDATE appointment_reschedule_requests/);
  assert.match(patch, /livePendingRescheduleConflicts/);
});

test('explicit change boundaries reconcile stale pending requests so they cannot block later validation', () => {
  assert.match(holdReconciliation, /async function reconcileStalePendingRescheduleHolds/);
  assert.match(holdReconciliation, /status='superseded'/);
  assert.match(holdReconciliation, /canonical appointment changed while reschedule approval was pending/);
  const clientRequest = patch.indexOf('await reconcileStalePendingRescheduleHolds();');
  const create = patch.indexOf('await createPendingRescheduleRequest', clientRequest);
  assert.ok(clientRequest >= 0 && create > clientRequest);
  const webhook = fs.readFileSync(path.join(root, 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.match(webhook, /processRescheduleApprovalDecision\(from,text\)/);
});

test('in-flight practitioner decision payloads remain recognized while new requests use Reception', () => {
  assert.match(service, /shiloh_reschedule_approval_request_v1/);
  assert.match(service, /shiloh_reschedule_declined_v1/);
  assert.match(service, /reschedule_approval_approve_/);
  assert.match(service, /reschedule_approval_decline_/);
  assert.match(service, /status,decision_owner\)/);
  assert.match(service, /WHATSAPP_RESCHEDULE_DECLINED_TEMPLATE/);
  assert.doesNotMatch(service, /submit.*Template|graph\.facebook\.com/i);
});

test('legacy practitioner decisions require exact active WhatsApp identity and practitioner ownership', () => {
  assert.match(service, /staff_admin_accounts/);
  assert.match(service, /result\.rowCount === 1/);
  assert.match(service, /Number\(admin\.staff_id\) !== Number\(context\.approver_staff_id\)/);
  assert.match(service, /context\.decision_owner !== 'practitioner'/);
  assert.match(service, /You are not authorized to decide this reschedule request/);
  const webhook = fs.readFileSync(path.join(root, 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.match(webhook, /processRescheduleApprovalDecision\(from,text\)/);
  assert.doesNotMatch(patch, /originalProcessBookingApprovalMessage/);
});

test('approve revalidates before canonical mutation and decline never mutates appointment time', () => {
  const approve = service.match(/async function approveRequest[\s\S]*?async function declineRequest/);
  const decline = service.match(/async function declineRequest[\s\S]*?async function processRescheduleApprovalDecision/);
  assert.ok(approve && decline);
  const snapshot = approve[0].indexOf('canonicalStillMatchesRequest');
  const lock = approve[0].indexOf('pg_advisory_xact_lock', snapshot);
  const candidate = approve[0].indexOf('validateCandidate', lock);
  const mutate = approve[0].indexOf('UPDATE appointments SET starts_at=', candidate);
  assert.ok(snapshot >= 0 && lock > snapshot && candidate > lock && mutate > candidate);
  assert.doesNotMatch(decline[0], /UPDATE appointments SET starts_at=/);
  assert.match(decline[0], /canonicalStillMatchesRequest/);
  assert.match(decline[0], /status='declined'/);
});

test('approved reschedule changes only canonical Shiloh truth and needs no mirror compensation', () => {
  assert.doesNotMatch(service, /updateBookingEvent|syncPractitionerBookingEvent|appointment_calendar_events|calendar compensation/);
  assert.match(service, /original_starts_at/);
  assert.match(service, /original_ends_at/);
});

test('approved reschedule queues durable customer update and decline preserves original appointment', () => {
  assert.match(service, /appointment\.time_updated/);
  assert.match(service, /queueCustomerChangeNotification\(appointmentId, 'time'\)/);
  assert.match(service, /The client's original appointment is unchanged/);
});

test('client cancellation supersedes any pending reschedule hold immediately', () => {
  assert.match(service, /supersedePendingRescheduleForAppointment/);
  assert.match(patch, /priorIntent\?\.action === 'cancel'/);
  assert.match(patch, /status\.rows\[0\]\?\.status === 'cancelled'/);
  assert.match(patch, /client cancelled the original appointment/);
});

test('stale decline is superseded instead of sending outdated original-booking copy', () => {
  const decline = service.match(/async function declineRequest[\s\S]*?async function processRescheduleApprovalDecision/);
  assert.ok(decline);
  assert.match(decline[0], /canonicalStillMatchesRequest/);
  assert.match(decline[0], /stale reschedule request was closed without sending an outdated client message/);
});
