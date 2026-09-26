const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routing = require('../src/services/workspaceBookingRequestRouting');
const alerts = require('../src/services/bookingRequestStaffAlerts');

function principal(overrides = {}) {
  return {
    id: 100,
    staff_id: null,
    business_role: 'booking_operator',
    calendar_scope: 'all_business',
    permissions: { 'appointment:create': true },
    calendarAuthority: {
      operatorAdminId: 100,
      linkedStaffId: null,
      businessRole: 'booking_operator',
      calendarScope: 'all_business',
    },
    ...overrides,
  };
}

function dbWith({ scopes = {}, unresolved = [], reschedules = [], targets = {}, teamsByStaff = {} } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM booking_request_coordination_scopes brcs') && sql.includes('LIMIT 1')) {
        const row = scopes[Number(params[0])] || null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes('FROM appointment_booking_approvals aba') && sql.includes("WHERE aba.status IN ('pending','awaiting_client_confirmation')")) {
        return { rowCount: unresolved.length, rows: unresolved };
      }
      if (sql.includes('FROM appointment_reschedule_requests request')) {
        assert.match(sql, /st\.business_role.*tenant_practitioner/);
        assert.match(sql, /a\.starts_at=request\.original_starts_at/);
        assert.match(sql, /team\.id=\$2/);
        if (params[1] != null) assert.equal(params[1], 11);
        return { rowCount: reschedules.length, rows: reschedules };
      }
      if (sql.includes('WHERE aba.appointment_id=$1') && sql.includes('requested_staff_ids')) {
        const row = targets[Number(params[0])] || null;
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes('FROM staff_operational_team_members m')) {
        const ids = params[0].map(Number);
        const teamIds = [...new Set(ids.map(id => teamsByStaff[id]).filter(Boolean))];
        if (teamIds.length !== 1 || ids.some(id => !teamsByStaff[id])) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: teamIds[0], display_name: `Team ${teamIds[0]}`, matched: ids.length }] };
      }
      throw new Error(`Unexpected query in routing test: ${sql.slice(0, 100)}`);
    },
  };
}

const requestRows = [
  {
    appointment_id: 501, approver_staff_id: 3, status: 'pending', requested_at: new Date(),
    requested_starts_at: new Date('2026-09-10T08:00:00Z'), requested_ends_at: new Date('2026-09-10T09:00:00Z'),
    requested_revision: new Date('2026-09-09T06:00:00Z'), requested_staff_ids: [3, 4],
    client_name: 'Client A', service_name: 'Massage', staff_name: 'Christel', team_id: 11, team_name: 'Christel team',
    proposed_staff_id: null, proposal_version: 0, proposal_expires_at: null,
  },
  {
    appointment_id: 502, approver_staff_id: 5, status: 'pending', requested_at: new Date(),
    requested_starts_at: new Date('2026-09-10T10:00:00Z'), requested_ends_at: new Date('2026-09-10T11:00:00Z'),
    requested_revision: new Date('2026-09-09T06:00:00Z'), requested_staff_ids: [5],
    client_name: 'Client B', service_name: 'Beauty', staff_name: 'Marietjie', team_id: 12, team_name: 'Marietjie team',
    proposed_staff_id: null, proposal_version: 0, proposal_expires_at: null,
  },
];

test('Reception/global coordination is derived from existing all-business booking authority', () => {
  assert.equal(routing.isDerivedGlobalCoordinator(principal()), true);
  assert.equal(routing.isDerivedGlobalCoordinator(principal({ business_role: 'employee_practitioner', calendar_scope: 'own_appointments' })), false);
});

test('explicit team coordination narrows a business-wide principal and projects team ownership', async () => {
  const db = dbWith({
    scopes: { 100: { scope_kind: 'team', team_id: 11, team_name: 'Christel team' } },
    unresolved: requestRows,
  });
  const rows = await routing.listUnresolvedBookingRequests({ db, principal: principal(), now: new Date('2026-09-09T08:00:00Z') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].appointmentId, 501);
  assert.equal(rows[0].teamName, 'Christel team');
  assert.match(rows[0].staffName, /Christel team/);
});

test('owner sees and may resolve requests across teams despite a historical team scope', async () => {
  const owner = principal({ business_role: 'owner', calendarAuthority: { businessRole: 'owner', calendarScope: 'all_business' } });
  const db = dbWith({
    scopes: { 100: { scope_kind: 'team', team_id: 11, team_name: 'Christel team' } },
    unresolved: requestRows,
    targets: { 502: { appointment_id: 502, approver_staff_id: 5, requested_staff_ids: [5], team_id: 12 } },
  });
  const rows = await routing.listUnresolvedBookingRequests({ db, principal: owner });
  assert.deepEqual(rows.map(row => row.appointmentId), [501, 502]);
  assert.equal(rows.every(row => row.coordinationScope === 'global'), true);
  const permitted = await routing.requireRoutingAuthority(db, owner, 502);
  assert.equal(permitted.scope.kind, 'global');
});

test('pending time changes reach Christel and scoped Reception without exposing them to practitioners', async () => {
  const reschedules = [
    { id: 801, appointment_id: 501, approver_staff_id: 3, team_id: 11, client_name: 'Client A', service_name: 'Massage', staff_name: 'Christel', original_starts_at: '2026-09-27T08:00:00Z', proposed_starts_at: '2026-09-30T08:00:00Z' },
    { id: 802, appointment_id: 502, approver_staff_id: 5, team_id: 12, client_name: 'Client B', service_name: 'Facial', staff_name: 'Abigail', original_starts_at: '2026-09-28T08:00:00Z', proposed_starts_at: '2026-10-01T08:00:00Z' },
  ];
  const db = dbWith({ scopes: { 100: { scope_kind: 'team', team_id: 11 } }, reschedules });
  const input = { db, now: new Date('2026-09-26T08:00:00Z') };
  const owner = principal({ business_role: 'owner', calendarAuthority: { businessRole: 'owner', calendarScope: 'all_business' } });
  assert.deepEqual((await routing.listPendingRescheduleRequests({ ...input, principal: owner })).map(row => row.requestId), [801, 802]);
  assert.deepEqual((await routing.listPendingRescheduleRequests({ ...input, principal: principal() })).map(row => row.requestId), [801]);
  const practitioner = principal({ business_role: 'employee_practitioner', calendar_scope: 'own_appointments' });
  assert.deepEqual(await routing.listPendingRescheduleRequests({ ...input, principal: practitioner }), []);
});

test('a practitioner team scope does not expose or resolve client-originated requests', async () => {
  const marietjie = principal({
    id: 104, staff_id: 5, business_role: 'tenant_practitioner', calendar_scope: 'own_services',
    calendarAuthority: { operatorAdminId: 104, linkedStaffId: 5, businessRole: 'tenant_practitioner', calendarScope: 'own_services' },
  });
  const db = dbWith({
    scopes: { 104: { scope_kind: 'team', team_id: 12, team_name: 'Marietjie team' } },
    unresolved: requestRows,
  });
  const rows = await routing.listUnresolvedBookingRequests({ db, principal: marietjie });
  assert.deepEqual(rows, []);
  await assert.rejects(
    routing.requireRoutingAuthority(dbWith({ scopes: { 104: { scope_kind: 'team', team_id: 12 } }, targets: { 502: requestRows[1] } }), marietjie, 502),
    error => error.code === 'BOOKING_REQUEST_TEAM_FORBIDDEN',
  );
});

test('a booking operator without appointment creation authority cannot coordinate requests', async () => {
  const operator = principal({ permissions: { 'appointment:create': false } });
  assert.equal(routing.isDerivedGlobalCoordinator(operator), false);
  const rows = await routing.listUnresolvedBookingRequests({ db: dbWith({ unresolved: requestRows }), principal: operator });
  assert.deepEqual(rows, []);
});

test('team routing rejects cross-team resolution and cross-team alternative practitioner before canonical mutation', async () => {
  const db = dbWith({
    scopes: { 100: { scope_kind: 'team', team_id: 11, team_name: 'Christel team' } },
    targets: {
      501: { appointment_id: 501, approver_staff_id: 3, requested_staff_ids: [3, 4], team_id: 11, team_name: 'Christel team' },
      502: { appointment_id: 502, approver_staff_id: 5, requested_staff_ids: [5], team_id: 12, team_name: 'Marietjie team' },
    },
    teamsByStaff: { 3: 11, 4: 11, 5: 12 },
  });
  await assert.rejects(
    routing.requireRoutingAuthority(db, principal(), 502),
    error => error.code === 'BOOKING_REQUEST_TEAM_FORBIDDEN' && error.httpStatus === 403,
  );
  await assert.rejects(
    routing.requireRoutingAuthority(db, principal(), 501, { destinationStaffId: 5 }),
    error => error.code === 'BOOKING_REQUEST_CROSS_TEAM_TARGET_FORBIDDEN' && error.httpStatus === 403,
  );
  const allowed = await routing.requireRoutingAuthority(db, principal(), 501, { destinationStaffId: 4 });
  assert.equal(allowed.scope.teamId, 11);
});

test('ordinary practitioner self scope remains own-request only and is not promoted to team/global', async () => {
  const practitioner = principal({
    id: 103, staff_id: 4, business_role: 'employee_practitioner', calendar_scope: 'own_appointments',
    calendarAuthority: { operatorAdminId: 103, linkedStaffId: 4, businessRole: 'employee_practitioner', calendarScope: 'own_appointments' },
  });
  const rows = await routing.listUnresolvedBookingRequests({ db: dbWith({ unresolved: requestRows }), principal: practitioner });
  assert.deepEqual(rows, []);
});

test('staff alert body is actionless apart from Open Workspace doorway contract', () => {
  const body = alerts.alertBody({ appointment_id: 501, team_name: 'Christel team', staff_name: 'Christel', requested_starts_at: '2026-09-10T08:00:00Z' });
  assert.match(body, /Open Shiloh Workspace/);
  assert.doesNotMatch(body, /\bApprove\b|\bDecline\b/);
  const source = fs.readFileSync(path.join(__dirname, '../src/services/bookingRequestStaffAlerts.js'), 'utf8');
  assert.match(source, /staff_open_workspace/);
  assert.doesNotMatch(source, /booking_approval_(?:approve|decline)/);
});

test('runtime team routing contains no person-name or phone authorization policy', () => {
  const runtime = [
    'src/services/workspaceBookingRequestRouting.js',
    'src/services/bookingRequestStaffAlerts.js',
  ].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(runtime, /christel|abigail|marietjie|jean-pierre/i);
  assert.doesNotMatch(runtime, /\+27\d{9}|27[678]\d{8}/);
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/114_booking_request_team_scope_alert_routing.sql'), 'utf8');
  assert.match(migration, /staff_operational_teams/);
  assert.match(migration, /booking_request_coordination_scopes/);
  assert.match(migration, /booking_request_staff_alerts/);
  assert.doesNotMatch(migration, /INSERT INTO appointments|UPDATE appointments SET|DELETE FROM appointments/);
});
