const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLIENT_ACCEPT_PREFIX,
  CLIENT_ANOTHER_PREFIX,
  clientActionId,
  proposalReplyButtons,
  parseClientProposalAction,
  operatorCanResolve,
  requestSnapshotMatches,
  acceptRequestedAppointment,
  proposeAlternative,
  cannotAccommodate,
  processClientBookingProposalMessage,
} = require('../src/services/clientBookingApproval');

const REVISION = '2026-09-08T09:00:00.000Z';
const START = '2026-09-10T08:00:00.000Z';
const END = '2026-09-10T09:00:00.000Z';

function row(overrides = {}) {
  return {
    appointment_id: 7651,
    approver_staff_id: 11,
    approver_admin_id: null,
    observer_staff_id: null,
    status: 'pending',
    requested_client_id: 91,
    requested_crm_v2_client_id: null,
    requested_client_phone: '27820000001',
    requested_location_id: 1,
    requested_staff_id: 11,
    requested_staff_ids: [11],
    requested_service_id: 25,
    requested_service_ids: [25],
    requested_starts_at: START,
    requested_ends_at: END,
    requested_revision: REVISION,
    current_client_id: 91,
    current_crm_v2_client_id: null,
    current_client_phone: '27820000001',
    current_location_id: 1,
    current_staff_id: 11,
    current_staff_ids: [11],
    current_service_id: 25,
    current_service_ids: [25],
    proposed_staff_ids: [11],
    current_starts_at: START,
    current_ends_at: END,
    current_revision: REVISION,
    appointment_status: 'scheduled',
    staff_count: 1,
    service_count: 1,
    client_name: 'Clinic Client',
    staff_name: 'Practitioner',
    service_name: 'Massage',
    ...overrides,
  };
}

function principal(overrides = {}) {
  return { id: 7, staff_id: 11, business_role: 'employee_practitioner', calendar_scope: 'own_appointments', ...overrides };
}

function fakePool(initialRow) {
  const state = { row: { ...initialRow }, calls: [] };
  const query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    state.calls.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM appointment_booking_approvals aba') && sql.includes('WHERE aba.appointment_id=$1')) return { rows: state.row ? [{ ...state.row }] : [], rowCount: state.row ? 1 : 0 };
    if (sql.startsWith('UPDATE appointment_booking_approvals SET')) {
      if (!state.row || !['pending', 'awaiting_client_confirmation'].includes(state.row.status)) return { rows: [], rowCount: 0 };
      if (sql.includes("SET status='awaiting_client_confirmation'")) {
        state.row.status = 'awaiting_client_confirmation';
        state.row.proposed_location_id = params[1];
        state.row.proposed_staff_id = params[2];
        state.row.proposed_staff_ids = params[3];
        state.row.proposed_service_id = params[4];
        state.row.proposed_starts_at = params[5];
        state.row.proposed_ends_at = params[6];
        state.row.proposal_expires_at = params[7];
        state.row.proposal_version = Number(state.row.proposal_version || 0) + 1;
        return { rows: [{ proposal_version: state.row.proposal_version }], rowCount: 1 };
      }
      if (sql.includes("SET status='approved'")) state.row.status = 'approved';
      else if (sql.includes("SET status='declined'")) state.row.status = 'declined';
      else if (sql.includes("SET status='pending'")) state.row.status = 'pending';
      return { rows: [{ appointment_id: state.row.appointment_id }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE appointments')) { state.row.current_starts_at = params[2]; state.row.current_ends_at = params[3]; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE appointment_staff') || sql.startsWith('UPDATE appointment_services') || sql.startsWith('UPDATE appointment_lifecycle') || sql.startsWith('INSERT INTO appointment_status_history') || sql.startsWith('INSERT INTO crm_audit_events')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release() {} };
  return { state, query, connect: async () => client };
}

test('migration adapts the one canonical approval record with bounded state and expiring proposal fields', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '108_workspace_booking_request_resolution.sql'), 'utf8');
  assert.match(migration, /awaiting_client_confirmation/);
  assert.match(migration, /proposal_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /proposal_expires_at TIMESTAMPTZ/);
  assert.match(migration, /requested_staff_ids BIGINT\[\]/);
  assert.match(migration, /requested_service_ids BIGINT\[\]/);
  assert.match(migration, /proposed_staff_ids BIGINT\[\]/);
  assert.match(migration, /idx_booking_approval_proposal_holds/);
  assert.match(migration, /Historical terminal rows receive best-effort snapshots/);
  assert.doesNotMatch(migration, /dummy test|jean-pierre|abigail|christel/i);
  assert.doesNotMatch(migration, /CREATE TABLE\s+(?!IF NOT EXISTS\s+appointment_booking_approvals)/i);
});

test('client proposal actions are exact request/version payloads and plain Yes is not authoritative', () => {
  const accept = clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 3);
  const another = clientActionId(CLIENT_ANOTHER_PREFIX, 7651, 3);
  assert.deepEqual(parseClientProposalAction(accept), { appointmentId: 7651, proposalVersion: 3, action: 'accept' });
  assert.deepEqual(parseClientProposalAction(another), { appointmentId: 7651, proposalVersion: 3, action: 'another' });
  assert.equal(parseClientProposalAction('Yes'), null);
});

test('client proposal delivery exposes two native reply-button choices within provider limits', () => {
  const buttons = proposalReplyButtons(row(), 3);
  assert.deepEqual(buttons, [
    { id: `${CLIENT_ACCEPT_PREFIX}7651_3`, title: 'Yes, book this' },
    { id: `${CLIENT_ANOTHER_PREFIX}7651_3`, title: 'Another option' },
  ]);
  assert.equal(buttons.every(button => button.title.length <= 20), true);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientBookingApproval.js'), 'utf8');
  assert.match(source, /sendWhatsAppReplyButtons\(phone/);
  assert.doesNotMatch(source, /sendWhatsAppList/);
});

test('resolver authority is target-specific, with business-wide owner backup and no person-name policy', () => {
  const request = row();
  assert.equal(operatorCanResolve(principal(), request), true);
  assert.equal(operatorCanResolve(principal({ staff_id: 99 }), request), false);
  assert.equal(operatorCanResolve(principal({ staff_id: 99, business_role: 'owner', calendar_scope: 'all_business' }), request), true);
  assert.equal(requestSnapshotMatches(request), true);
  assert.equal(requestSnapshotMatches(row({ current_staff_id: 12 })), false);
  assert.equal(requestSnapshotMatches(row({ current_revision: '2026-09-08T09:01:00.000Z' })), false);
});

test('Accept requested appointment locks, revalidates, writes one terminal decision and sends confirmation after commit', async () => {
  const db = fakePool(row());
  const order = [];
  const result = await acceptRequestedAppointment({
    dbPool: db,
    principal: principal(),
    appointmentId: 7651,
    expectedRevision: REVISION,
    validateWindow: async () => { order.push('validate'); return { ok: true }; },
    sendConfirmation: async () => { order.push('confirm'); return { sent: true }; },
  });
  assert.equal(result.status, 'approved');
  assert.deepEqual(order, ['validate', 'confirm']);
  assert.equal(db.state.row.status, 'approved');
  assert.equal(db.state.calls.filter(call => call.sql.includes("status='approved'")).length, 1);
  await assert.rejects(acceptRequestedAppointment({
    dbPool: db, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    validateWindow: async () => ({ ok: true }), sendConfirmation: async () => ({ sent: true }),
  }), error => error.code === 'BOOKING_REQUEST_ALREADY_RESOLVED');
});

test('multi-practitioner requested appointments revalidate every practitioner and keep every alternative hold', async () => {
  const multi = row({
    requested_staff_ids: [11, 12], current_staff_ids: [11, 12], staff_count: 2,
  });
  const acceptedDb = fakePool(multi);
  const checked = [];
  await acceptRequestedAppointment({
    dbPool: acceptedDb, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    validateWindow: async (_db, input) => { checked.push(input.staffId); return { ok: true, canonical: { display_name: `Staff ${input.staffId}` } }; },
    sendConfirmation: async () => ({ sent: true }),
  });
  assert.deepEqual(checked, [11, 12]);
  assert.deepEqual(acceptedDb.state.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).map(call => call.params[0]), [11, 12]);

  const proposalDb = fakePool(multi);
  await proposeAlternative({
    dbPool: proposalDb, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    startsAt: '2026-09-11T08:00:00.000Z', now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async (_db, input) => ({ ok: true, canonical: { display_name: `Staff ${input.staffId}` } }),
    sendProposal: async () => {},
  });
  assert.deepEqual(proposalDb.state.row.proposed_staff_ids, [11, 12]);
  const acceptanceChecks = [];
  const acceptedAlternative = await processClientBookingProposalMessage(
    '27820000001',
    clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 1),
    {
      dbPool: proposalDb,
      now: new Date('2026-09-08T11:00:00.000Z'),
      validateWindow: async (_db, input) => {
        acceptanceChecks.push(input.staffId);
        return { ok: true, canonical: { display_name: `Staff ${input.staffId}` } };
      },
      sendConfirmation: async () => ({ sent: true }),
    },
  );
  assert.equal(acceptedAlternative.status, 'approved');
  assert.deepEqual(acceptanceChecks, [11, 12]);
  await assert.rejects(proposeAlternative({
    dbPool: fakePool(multi), principal: principal({ business_role: 'owner', calendar_scope: 'all_business' }),
    appointmentId: 7651, expectedRevision: REVISION, startsAt: '2026-09-11T08:00:00.000Z', staffId: 13,
    now: new Date('2026-09-08T10:00:00.000Z'), validateWindow: async () => ({ ok: true }), sendProposal: async () => {},
  }), error => error.code === 'BOOKING_REQUEST_COMPLEX_PRACTITIONER_CHANGE');
});

test('Propose alternative holds the candidate, increments a version and delivers exact client choices', async () => {
  const db = fakePool(row({ proposal_version: 0 }));
  let delivered = null;
  const result = await proposeAlternative({
    dbPool: db, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    startsAt: '2026-09-11T08:00:00.000Z', now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async () => ({ ok: true, canonical: { display_name: 'Practitioner' } }),
    sendProposal: async (request, version) => { delivered = { request, version }; },
  });
  assert.equal(result.status, 'awaiting_client_confirmation');
  assert.equal(result.proposalVersion, 1);
  assert.equal(delivered.version, 1);
  assert.equal(db.state.row.status, 'awaiting_client_confirmation');
  assert.ok(new Date(db.state.row.proposal_expires_at).getTime() > new Date('2026-09-08T10:00:00.000Z').getTime());
});

test('Cannot accommodate terminalizes the request, appointment and lifecycle atomically before client delivery', async () => {
  const db = fakePool(row());
  let deliveryStatus = null;
  const result = await cannotAccommodate({
    dbPool: db, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    sendOutcome: async () => { deliveryStatus = db.state.row.status; return { sent: true }; },
  });
  assert.equal(result.status, 'declined');
  assert.equal(deliveryStatus, 'declined');
  assert.equal(db.state.calls.some(call => call.sql.startsWith('UPDATE appointments')), true);
  assert.equal(db.state.calls.some(call => call.sql.startsWith('UPDATE appointment_lifecycle') && call.sql.includes("status='cancelled'")), true);
  assert.equal(db.state.calls.some(call => call.sql.startsWith('INSERT INTO appointment_status_history')), true);
});

test('own-scope practitioner cannot propose a different practitioner and V1 never changes service', async () => {
  const staffDb = fakePool(row());
  await assert.rejects(proposeAlternative({
    dbPool: staffDb, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    startsAt: '2026-09-11T08:00:00.000Z', staffId: 12,
    now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async () => ({ ok: true, canonical: { display_name: 'Other' } }),
    sendProposal: async () => {},
  }), error => error.code === 'BOOKING_REQUEST_TARGET_FORBIDDEN' && error.httpStatus === 403);

  const ownerServiceDb = fakePool(row());
  await assert.rejects(proposeAlternative({
    dbPool: ownerServiceDb,
    principal: principal({ business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services' }),
    appointmentId: 7651, expectedRevision: REVISION,
    startsAt: '2026-09-11T08:00:00.000Z', serviceId: 26,
    now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async () => ({ ok: true, canonical: { display_name: 'Practitioner' } }),
    sendProposal: async () => {},
  }), error => error.code === 'BOOKING_REQUEST_SERVICE_CHANGE_UNSUPPORTED' && error.httpStatus === 400);
  assert.equal(staffDb.state.calls.some(call => call.sql.includes("SET status='awaiting_client_confirmation'")), false);

  const serviceDb = fakePool(row());
  await assert.rejects(proposeAlternative({
    dbPool: serviceDb, principal: principal(), appointmentId: 7651, expectedRevision: REVISION,
    startsAt: '2026-09-11T08:00:00.000Z', serviceId: 26,
    now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async () => ({ ok: true, canonical: { display_name: 'Practitioner' } }),
    sendProposal: async () => {},
  }), error => error.code === 'BOOKING_REQUEST_SERVICE_CHANGE_UNSUPPORTED' && error.httpStatus === 400);
});

test('client acceptance is identity/version bound, revalidates, and duplicate or foreign clicks fail closed', async () => {
  const pending = row({
    status: 'awaiting_client_confirmation', proposal_version: 2,
    proposal_expires_at: '2026-09-12T10:00:00.000Z', proposed_location_id: 1,
    proposed_staff_id: 11, proposed_service_id: 25,
    proposed_starts_at: '2026-09-11T08:00:00.000Z', proposed_ends_at: '2026-09-11T09:00:00.000Z',
  });
  const foreign = fakePool(pending);
  const denied = await processClientBookingProposalMessage('27829999999', clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 2), {
    dbPool: foreign, now: new Date('2026-09-08T10:00:00.000Z'), validateWindow: async () => ({ ok: true }), sendConfirmation: async () => ({ sent: true }),
  });
  assert.equal(denied.status, 'rejected');
  assert.equal(foreign.state.calls.some(call => call.sql.startsWith('UPDATE appointments')), false);

  const db = fakePool(pending);
  const accepted = await processClientBookingProposalMessage('27820000001', clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 2), {
    dbPool: db, now: new Date('2026-09-08T10:00:00.000Z'),
    validateWindow: async () => ({ ok: true, canonical: { display_name: 'Practitioner' } }),
    sendConfirmation: async () => ({ sent: true }),
  });
  assert.equal(accepted.status, 'approved');
  assert.equal(db.state.calls.filter(call => call.sql.startsWith('UPDATE appointments')).length, 1);
  const repeated = await processClientBookingProposalMessage('27820000001', clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 2), {
    dbPool: db, now: new Date('2026-09-08T10:00:00.000Z'), validateWindow: async () => ({ ok: true }), sendConfirmation: async () => ({ sent: true }),
  });
  assert.equal(repeated.status, 'rejected');
  assert.equal(db.state.calls.filter(call => call.sql.startsWith('UPDATE appointments')).length, 1);
});

test("I'd like another option releases the proposal hold and returns the request to Needs Attention", async () => {
  const db = fakePool(row({
    status: 'awaiting_client_confirmation', proposal_version: 4,
    proposal_expires_at: '2026-09-12T10:00:00.000Z', proposed_location_id: 1,
    proposed_staff_id: 11, proposed_service_id: 25,
    proposed_starts_at: '2026-09-11T08:00:00.000Z', proposed_ends_at: '2026-09-11T09:00:00.000Z',
  }));
  const result = await processClientBookingProposalMessage('27820000001', clientActionId(CLIENT_ANOTHER_PREFIX, 7651, 4), { dbPool: db });
  assert.equal(result.status, 'pending');
  assert.equal(db.state.row.status, 'pending');
});

test('expired or canonically unavailable client acceptance releases the hold without confirming', async () => {
  const proposal = row({
    status: 'awaiting_client_confirmation', proposal_version: 5,
    proposal_expires_at: '2026-09-09T10:00:00.000Z', proposed_location_id: 1,
    proposed_staff_id: 11, proposed_service_id: 25,
    proposed_starts_at: '2026-09-11T08:00:00.000Z', proposed_ends_at: '2026-09-11T09:00:00.000Z',
  });
  const expired = fakePool(proposal);
  const expiredResult = await processClientBookingProposalMessage('27820000001', clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 5), {
    dbPool: expired, now: new Date('2026-09-10T10:00:00.000Z'),
    validateWindow: async () => { throw new Error('expired proposal must not be revalidated'); },
  });
  assert.equal(expiredResult.status, 'pending');
  assert.equal(expired.state.row.status, 'pending');
  assert.equal(expired.state.calls.some(call => call.sql.startsWith('UPDATE appointments')), false);

  const unavailable = fakePool({ ...proposal, proposal_expires_at: '2026-09-12T10:00:00.000Z' });
  const unavailableResult = await processClientBookingProposalMessage('27820000001', clientActionId(CLIENT_ACCEPT_PREFIX, 7651, 5), {
    dbPool: unavailable, now: new Date('2026-09-10T10:00:00.000Z'),
    validateWindow: async () => ({ ok: false, reason: 'appointment' }),
  });
  assert.equal(unavailableResult.status, 'pending');
  assert.equal(unavailable.state.row.status, 'pending');
  assert.equal(unavailable.state.calls.some(call => call.sql.startsWith('UPDATE appointments')), false);
});

test('active proposal holds participate in client slots, booking, reschedule and Calendar conflicts', () => {
  const availability = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'availabilityService.js'), 'utf8');
  const booking = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'adminAvailability.js'), 'utf8');
  const reschedule = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientRescheduleApproval.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'calendarOperationalMutations.js'), 'utf8');
  for (const source of [availability, booking, reschedule, calendar]) {
    assert.match(source, /proposal_expires_at|pendingBookingProposalConflicts/);
  }
  assert.match(availability, /awaiting_client_confirmation/);
  assert.match(reschedule, /pendingBookingProposalConflicts/);
  assert.match(calendar, /awaiting_client_confirmation/);
  assert.match(availability, /proposal_expires_at > NOW\(\)/);
  assert.match(calendar, /booking_proposal_hold/);
  const holds = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'bookingRequestHolds.js'), 'utf8');
  assert.match(holds, /aba\.proposed_staff_ids @> ARRAY\[\$1::bigint\]/);
});

test('runtime cutover has no initial-booking staff template send or staff approval parser', () => {
  const approval = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientBookingApproval.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.doesNotMatch(approval, /shiloh_booking_approval_request_v1|booking_approval_approve_|booking_approval_decline_/);
  assert.doesNotMatch(webhook, /processClientBookingApprovalMessage|processAdminInteractiveMenuMessage|commandForAdminButton/);
  assert.match(webhook, /processClientBookingProposalMessage/);
  assert.match(webhook, /processRescheduleApprovalDecision/, 'adjacent confirmed-appointment reschedule contract remains explicit');
});
