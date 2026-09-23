const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const approval = read('src/services/clientBookingApproval.js');
const schema = read('src/services/clientBookingApprovalSchema.js');
const policy = read('src/services/bookingPolicy.js');
const availability = read('src/services/availabilityService.js');
const webhook = read('src/controllers/webhookController.js');

test('client booking completion creates the canonical unresolved request without messaging staff', () => {
  assert.match(policy, /ensureBookingApprovalInfrastructure/);
  assert.match(policy, /createPendingBookingApproval/);
  assert.match(policy, /status: ['"]pending_resolution['"]/);
  assert.match(policy, /in Workspace/);
  assert.doesNotMatch(policy, /requestPractitionerApproval|shiloh_booking_approval_request_v1/);
});

test('approval trigger captures canonical request snapshots with no name-based policy', () => {
  assert.match(schema, /CREATE TRIGGER trg_client_booking_approval_hold/);
  assert.match(schema, /AFTER INSERT ON appointment_staff/);
  assert.match(schema, /requested_client_id|requested_staff_id|requested_service_id|requested_revision/);
  assert.match(schema, /appointment_booking_approvals/);
  assert.doesNotMatch(schema, /dummy test|jean-pierre|abigail|christel|marietjie/i);
  assert.doesNotMatch(approval, /dummy test|jean-pierre|abigail|christel|marietjie/i);
});

test('unresolved request remains a canonical appointment conflict until explicit resolution', () => {
  assert.match(availability, /a\.status NOT IN \('cancelled','no_show'\)/);
  assert.match(approval, /pending|awaiting_client_confirmation/);
  assert.match(approval, /sendCustomerBookingConfirmationForAppointment/);
  assert.match(approval, /SET status='declined'/);
  assert.match(approval, /SET status='approved'/);
  assert.doesNotMatch(approval, /appointment_calendar_events|cancelBookingEvent|cancelPractitionerBookingEvent/);
});

test('client proposal actions route before retired staff authority and bind exact payloads', () => {
  assert.match(webhook, /processClientBookingProposalMessage/);
  assert.match(approval, /booking_proposal_accept_/);
  assert.match(approval, /booking_proposal_another_/);
  assert.ok(webhook.indexOf('processClientBookingProposalMessage(from,text)') < webhook.indexOf('processAdminRetiredAuthorityMessage(from,text)'));
  assert.doesNotMatch(webhook, /processClientBookingApprovalMessage/);
});
