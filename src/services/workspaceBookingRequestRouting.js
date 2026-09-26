const { pool } = require('../db/pool');
const bookingRequests = require('./clientBookingApproval');
const rescheduleRequests = require('./clientRescheduleApproval');

const GLOBAL_COORDINATION_ROLES = new Set(['owner', 'business_admin', 'booking_operator']);

class BookingRequestRoutingError extends Error {
  constructor(code, message, httpStatus = 403) {
    super(message);
    this.name = 'BookingRequestRoutingError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canonicalIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(positiveId).filter(Boolean))];
}

function principalRole(principal) {
  return String(principal?.business_role || principal?.calendarAuthority?.businessRole || '').trim().toLowerCase();
}

function principalCalendarScope(principal) {
  return String(principal?.calendar_scope || principal?.calendarAuthority?.calendarScope || '').trim().toLowerCase();
}

function principalStaffId(principal) {
  return positiveId(principal?.staff_id || principal?.calendarAuthority?.linkedStaffId);
}

function isDerivedGlobalCoordinator(principal) {
  const role = principalRole(principal);
  return GLOBAL_COORDINATION_ROLES.has(role) && principalCalendarScope(principal) === 'all_business'
    && (role !== 'booking_operator' || principal?.permissions?.['appointment:create'] === true);
}

async function coordinationScopeForPrincipal(db, principal) {
  const adminId = positiveId(principal?.id || principal?.calendarAuthority?.operatorAdminId);
  if (!adminId) return { kind: 'none', teamId: null, teamName: null, explicit: false };
  // Client-originated requests are planned by Reception. An old explicit team/self
  // coordination row must not restore practitioner approval authority.
  if (!isDerivedGlobalCoordinator(principal)) return { kind: 'none', teamId: null, teamName: null, explicit: false };
  // The owner must see the full Reception queue even when an older team-lead
  // row still associates their staff identity with one practitioner team.
  if (principalRole(principal) === 'owner') return { kind: 'global', teamId: null, teamName: null, explicit: false };
  const configured = await db.query(`
    SELECT brcs.scope_kind,brcs.team_id,t.display_name AS team_name
      FROM booking_request_coordination_scopes brcs
      LEFT JOIN staff_operational_teams t ON t.id=brcs.team_id AND t.active=TRUE
     WHERE brcs.admin_id=$1 AND brcs.active=TRUE
     LIMIT 1`, [adminId]);
  const row = configured.rows?.[0];
  if (row) {
    return {
      kind: row.scope_kind,
      teamId: positiveId(row.team_id),
      teamName: row.team_name || null,
      explicit: true,
    };
  }
  if (isDerivedGlobalCoordinator(principal)) return { kind: 'global', teamId: null, teamName: null, explicit: false };
  return { kind: 'none', teamId: null, teamName: null, explicit: false };
}

async function teamForStaffIds(db, staffIds) {
  const ids = canonicalIds(staffIds);
  if (!ids.length) return null;
  const result = await db.query(`
    SELECT t.id,t.display_name,COUNT(*)::int AS matched
      FROM staff_operational_team_members m
      JOIN staff_operational_teams t ON t.id=m.team_id AND t.active=TRUE
     WHERE m.active=TRUE AND m.staff_id=ANY($1::bigint[])
     GROUP BY t.id,t.display_name
    HAVING COUNT(*)=$2
     ORDER BY t.id
     LIMIT 2`, [ids, ids.length]);
  if (result.rowCount !== 1) return null;
  return { id: Number(result.rows[0].id), name: result.rows[0].display_name };
}

function rowVisibleToScope(row, principal, scope) {
  if (!row || !scope) return false;
  if (scope.kind === 'global') return true;
  const staffId = principalStaffId(principal);
  if (scope.kind === 'self') return Boolean(staffId && Number(row.approver_staff_id) === staffId);
  if (scope.kind === 'team') return positiveId(row.team_id) === positiveId(scope.teamId);
  return false;
}

async function rawUnresolvedRows(db) {
  const result = await db.query(`
    SELECT aba.appointment_id,aba.approver_staff_id,aba.status,aba.requested_at,aba.planning_started_at,aba.client_occasion_note,
           aba.requested_starts_at,aba.requested_ends_at,aba.requested_revision,
           aba.requested_staff_ids,aba.proposed_starts_at,aba.proposed_ends_at,
           aba.proposed_staff_id,aba.proposal_version,aba.proposal_expires_at,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           COALESCE(pst.display_name,st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS proposed_staff_name,
           team.id AS team_id,team.display_name AS team_name
      FROM appointment_booking_approvals aba
      JOIN appointments a ON a.id=aba.appointment_id AND a.status<>'cancelled'
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      LEFT JOIN staff st ON st.id=ast.staff_id
      LEFT JOIN staff pst ON pst.id=aba.proposed_staff_id
      LEFT JOIN services s ON s.id=aps.service_id
      LEFT JOIN staff_operational_team_members tm ON tm.staff_id=aba.requested_staff_id AND tm.active=TRUE
      LEFT JOIN staff_operational_teams team ON team.id=tm.team_id AND team.active=TRUE
     WHERE aba.status IN ('pending','awaiting_client_confirmation')
     ORDER BY aba.requested_at,aba.appointment_id`);
  return result.rows || [];
}

function revisionOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function listUnresolvedBookingRequests({ db = pool, principal, now = new Date() }) {
  const scope = await coordinationScopeForPrincipal(db, principal);
  const rows = await rawUnresolvedRows(db);
  return rows.filter(row => rowVisibleToScope(row, principal, scope)).map(row => ({
    appointmentId: Number(row.appointment_id),
    status: row.status,
    planningStartedAt: row.planning_started_at || null,
    occasionNote: row.client_occasion_note || null,
    effectiveStatus: row.status === 'awaiting_client_confirmation' && new Date(row.proposal_expires_at).getTime() <= now.getTime()
      ? 'pending' : row.status,
    clientName: row.client_name,
    serviceName: row.service_name,
    staffName: row.team_name ? `${row.staff_name} · ${row.team_name}` : row.staff_name,
    practitionerName: row.staff_name,
    teamId: positiveId(row.team_id),
    teamName: row.team_name || null,
    coordinationScope: scope.kind,
    requestedStartsAt: row.requested_starts_at,
    requestedEndsAt: row.requested_ends_at,
    requestedRevision: revisionOf(row.requested_revision),
    proposedStartsAt: row.proposed_starts_at,
    proposedEndsAt: row.proposed_ends_at,
    proposedStaffId: row.proposed_staff_id ? Number(row.proposed_staff_id) : null,
    proposedStaffName: row.proposed_staff_name,
    proposalVersion: Number(row.proposal_version || 0),
    proposalExpiresAt: row.proposal_expires_at,
  }));
}

async function listPendingRescheduleRequests({ db = pool, principal, now = new Date() }) {
  const scope = await coordinationScopeForPrincipal(db, principal);
  if (scope.kind === 'none') return [];
  const result = await db.query(`
    SELECT request.id,request.appointment_id,request.approver_staff_id,request.decision_owner,
           request.original_starts_at,request.original_ends_at,request.proposed_starts_at,
           COALESCE(v2.name,c.display_name,a.source_client_name,'Client') AS client_name,
           COALESCE(s.name,aps.service_name_snapshot,a.title,'Shiloh appointment') AS service_name,
           COALESCE(st.display_name,ast.staff_name_snapshot,'Shiloh practitioner') AS staff_name,
           team.id AS team_id
      FROM appointment_reschedule_requests request
      JOIN appointments a ON a.id=request.appointment_id
      JOIN appointment_staff ast ON ast.appointment_id=a.id AND ast.position=1
      JOIN appointment_services aps ON aps.appointment_id=a.id AND aps.position=1
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
      LEFT JOIN staff st ON st.id=ast.staff_id
      LEFT JOIN services s ON s.id=aps.service_id
      LEFT JOIN staff_operational_team_members tm ON tm.staff_id=request.approver_staff_id AND tm.active=TRUE
      LEFT JOIN staff_operational_teams team ON team.id=tm.team_id AND team.active=TRUE
     WHERE request.status='pending'
       AND st.id IS NOT NULL
       AND COALESCE(st.business_role,'') <> 'tenant_practitioner'
       AND a.status IN ('scheduled','confirmed')
       AND a.starts_at>=$1
       AND a.starts_at=request.original_starts_at
       AND a.ends_at=request.original_ends_at
       AND ast.staff_id=request.approver_staff_id
       AND aps.service_id=request.service_id
       AND ($2::bigint IS NULL OR team.id=$2)
       AND ((request.crm_v2_client_id IS NOT NULL AND a.crm_v2_client_id=request.crm_v2_client_id AND v2.id IS NOT NULL)
         OR (request.client_id IS NOT NULL AND a.client_id=request.client_id))
     ORDER BY request.proposed_starts_at,request.id
     LIMIT 100`, [now, scope.kind === 'team' ? scope.teamId : null]);
  const seen = new Set();
  return (result.rows || []).filter(row => {
    if (seen.has(Number(row.id)) || !rowVisibleToScope(row, principal, scope)) return false;
    seen.add(Number(row.id));
    return true;
  }).map(row => ({
    requestId: Number(row.id), appointmentId: Number(row.appointment_id),
    decisionOwner: row.decision_owner,
    clientName: row.client_name, serviceName: row.service_name, staffName: row.staff_name,
    originalStartsAt: row.original_starts_at, proposedStartsAt: row.proposed_starts_at,
  }));
}

async function requireReceptionRescheduleAuthority(db, principal, context) {
    const scope = await coordinationScopeForPrincipal(db, principal);
    if (!positiveId(context.current_staff_record_id) || context.current_staff_business_role === 'tenant_practitioner' || scope.kind === 'none') {
      throw new BookingRequestRoutingError('RESCHEDULE_DECISION_FORBIDDEN', 'Reception access is required.', 403);
    }
    if (scope.kind !== 'global') {
      const team = await teamForStaffIds(db, [context.approver_staff_id]);
      if (!team || team.id !== scope.teamId) {
        throw new BookingRequestRoutingError('RESCHEDULE_DECISION_TEAM_FORBIDDEN', 'This time change is outside your Reception team.', 403);
      }
    }
}

async function decideReceptionReschedule({ principal, requestId, decision } = {}) {
  const id = positiveId(requestId);
  if (!id || !['approve','decline'].includes(decision)) {
    throw new BookingRequestRoutingError('RESCHEDULE_DECISION_INVALID', 'Choose a valid time-change request and action.', 400);
  }
  const adminId = positiveId(principal?.id || principal?.calendarAuthority?.operatorAdminId);
  if (!adminId) throw new BookingRequestRoutingError('RESCHEDULE_DECISION_FORBIDDEN', 'Reception access is required.', 403);
  const result = await rescheduleRequests.decideReceptionReschedule({
    admin: { id: adminId, staff_id: principalStaffId(principal), display_name: principal?.display_name || 'Reception' },
    requestId: id, decision, authorize: (db, context) => requireReceptionRescheduleAuthority(db, principal, context),
  });
  if (result.status === 'forbidden') throw new BookingRequestRoutingError('RESCHEDULE_DECISION_OWNER_CHANGED', result.reply, 409);
  return result;
}

async function loadRoutingTarget(db, appointmentId) {
  const id = positiveId(appointmentId);
  if (!id) return null;
  const result = await db.query(`
    SELECT aba.appointment_id,aba.approver_staff_id,aba.requested_staff_ids,
           team.id AS team_id,team.display_name AS team_name
      FROM appointment_booking_approvals aba
      LEFT JOIN staff_operational_team_members tm ON tm.staff_id=aba.requested_staff_id AND tm.active=TRUE
      LEFT JOIN staff_operational_teams team ON team.id=tm.team_id AND team.active=TRUE
     WHERE aba.appointment_id=$1
     LIMIT 1`, [id]);
  return result.rows?.[0] || null;
}

async function requireRoutingAuthority(db, principal, appointmentId, { destinationStaffId = null } = {}) {
  const target = await loadRoutingTarget(db, appointmentId);
  if (!target) throw new BookingRequestRoutingError('BOOKING_REQUEST_NOT_FOUND', 'That booking request no longer exists.', 404);
  const scope = await coordinationScopeForPrincipal(db, principal);
  if (!rowVisibleToScope(target, principal, scope)) {
    throw new BookingRequestRoutingError('BOOKING_REQUEST_TEAM_FORBIDDEN', 'Current Workspace coordination scope cannot resolve this booking request.', 403);
  }
  if (scope.kind === 'team') {
    const requestTeam = await teamForStaffIds(db, target.requested_staff_ids);
    if (!requestTeam || requestTeam.id !== scope.teamId) {
      throw new BookingRequestRoutingError('BOOKING_REQUEST_CROSS_TEAM_FORBIDDEN', 'This request crosses the current team boundary and cannot be resolved here.', 403);
    }
    if (destinationStaffId != null) {
      const destinationTeam = await teamForStaffIds(db, [destinationStaffId]);
      if (!destinationTeam || destinationTeam.id !== scope.teamId) {
        throw new BookingRequestRoutingError('BOOKING_REQUEST_CROSS_TEAM_TARGET_FORBIDDEN', 'An alternative practitioner must stay within the current team authority.', 403);
      }
    }
  }
  return { scope, target };
}

async function acceptRequestedAppointment(input = {}) {
  await requireRoutingAuthority(input.db || pool, input.principal, input.appointmentId);
  return bookingRequests.acceptRequestedAppointment(input);
}

async function startReceptionPlanning(input = {}) {
  await requireRoutingAuthority(input.db || pool, input.principal, input.appointmentId);
  return bookingRequests.startReceptionPlanning(input);
}

async function proposeAlternative(input = {}) {
  await requireRoutingAuthority(input.db || pool, input.principal, input.appointmentId, { destinationStaffId: input.staffId });
  return bookingRequests.proposeAlternative(input);
}

async function cannotAccommodate(input = {}) {
  await requireRoutingAuthority(input.db || pool, input.principal, input.appointmentId);
  return bookingRequests.cannotAccommodate(input);
}

module.exports = {
  GLOBAL_COORDINATION_ROLES,
  BookingRequestRoutingError,
  isDerivedGlobalCoordinator,
  coordinationScopeForPrincipal,
  teamForStaffIds,
  rowVisibleToScope,
  listUnresolvedBookingRequests,
  listPendingRescheduleRequests,
  requireReceptionRescheduleAuthority,
  decideReceptionReschedule,
  requireRoutingAuthority,
  acceptRequestedAppointment,
  startReceptionPlanning,
  proposeAlternative,
  cannotAccommodate,
};
