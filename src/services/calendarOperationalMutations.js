const crypto = require('crypto');
const { pool } = require('../db/pool');
const { checkClinicHours } = require('./clinicHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');
const { cancelCanonicalAppointmentInTransaction } = require('./adminAppointmentCancellation');
const {
  CALENDAR_OPERATIONS: OPERATIONS,
  evaluateCalendarAuthority,
  resolveCalendarAuthority,
  operationsForAuthority,
  allowsAppointmentTarget,
  allowsStaffTarget,
  allowsReassignmentTarget,
} = require('./calendarAuthorization');

const MUTABLE_APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed']);
const OPERATIONAL_LEAVE_REASON = /^Operational leave by Calendar admin #(\d+)(?::\s*(.*))?$/i;

function mutationError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function positiveId(value, code = 'CALENDAR_OPERATION_INVALID_ID') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw mutationError(code, 'A positive canonical identifier is required.');
  return number;
}

function clean(value = '', max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function exactRevision(value) {
  const raw = String(value || '').trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== raw) {
    throw mutationError('CALENDAR_OPERATION_INVALID_REVISION', 'Reload the canonical Calendar item before retrying.');
  }
  return raw;
}

function revisionOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requireRequestId(value) {
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw mutationError('CALENDAR_OPERATION_INVALID_REQUEST', 'A valid operation request identifier is required.');
  }
  return requestId;
}

function requireDate(value, code = 'CALENDAR_OPERATION_INVALID_DATE') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw mutationError(code, 'Use a valid YYYY-MM-DD date.');
  const parsed = new Date(`${date}T12:00:00+02:00`);
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed);
  if (Number.isNaN(parsed.getTime()) || formatted !== date) throw mutationError(code, 'Use a valid YYYY-MM-DD date.');
  return date;
}

function requireTime(value) {
  const time = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw mutationError('CALENDAR_OPERATION_INVALID_TIME', 'Use a valid 24-hour HH:MM time.');
  }
  return time;
}

function requireFutureStart(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) {
    throw mutationError('CALENDAR_OPERATION_PAST_WINDOW', 'Choose a future Calendar time.');
  }
  return date;
}

function operationFingerprint(action, payload) {
  return crypto.createHash('sha256').update(`${action}\n${JSON.stringify(payload)}`).digest('hex');
}

function staticMutationCapability(admin = {}, { allowedServiceIds = [] } = {}) {
  const authority = evaluateCalendarAuthority(admin, { allowedServiceIds });
  if (!authority) return null;
  const operations = operationsForAuthority(authority);
  if (!operations.length) return null;
  return {
    ...authority,
    key: 'calendar_operational_mutations_capability_v1',
    operations,
  };
}

function scheduleStateRevision({ staffId, dayOfWeek, locationId, windows = [], closures = [] }) {
  const stable = {
    staffId: Number(staffId),
    dayOfWeek: Number(dayOfWeek),
    locationId: locationId == null ? null : Number(locationId),
    windows: windows.map(row => [Number(row.id), String(row.starts_local), String(row.ends_local), revisionOf(row.updated_at)]),
    closures: closures.map(row => [Number(row.id), revisionOf(row.updated_at)]),
  };
  return operationFingerprint('calendar.schedule.state', stable);
}

function operationalLeaveReason(adminId, reason) {
  return `Operational leave by Calendar admin #${positiveId(adminId)}: ${clean(reason || 'Operational leave')}`;
}

function isOperationalLeave(row) {
  return row?.exception_type === 'unavailable'
    && row.starts_local == null
    && row.ends_local == null
    && OPERATIONAL_LEAVE_REASON.test(String(row.reason || ''));
}

function createCalendarOperationalMutationService({
  db = pool,
  clinicHours = checkClinicHours,
  authoritativeSchedule = checkAuthoritativeSchedule,
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.connect !== 'function') {
    throw new Error('Calendar operational mutations require a transactional database.');
  }

  async function resolveOperator(adminId, queryable = db, { operation = null } = {}) {
    const id = positiveId(adminId, 'CALENDAR_OPERATION_FORBIDDEN');
    const admin = await resolveCalendarAuthority(queryable, id);
    const capability = admin ? staticMutationCapability(admin, {
      allowedServiceIds: admin.calendarAuthority.allowedServiceIds || [],
    }) : null;
    if (!admin || !capability || (operation && !capability.operations.includes(operation))) {
      throw mutationError('CALENDAR_OPERATION_FORBIDDEN', 'Current canonical staff authority does not permit Calendar operations.');
    }
    return { ...admin, mutationCapability: capability };
  }

  async function loadReplay(client, actorAdminId, action, requestId, fingerprint) {
    const result = await client.query(
      `/* calendarOperational:idempotency */
       SELECT entity_id, metadata
         FROM crm_audit_events
        WHERE actor_admin_id=$1
          AND action=$2
          AND metadata->>'requestId'=$3
        ORDER BY id
        LIMIT 1`,
      [actorAdminId, action, requestId]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (String(row.metadata?.requestFingerprint || '') !== fingerprint) {
      throw mutationError('CALENDAR_OPERATION_IDEMPOTENCY_MISMATCH', 'That operation identifier was already used for a different request.');
    }
    return { status: 'idempotent_replay', entityId: row.entity_id == null ? null : Number(row.entity_id) };
  }

  async function audit(client, operator, action, entityType, entityId, metadata) {
    await client.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [operator.id, action, entityType, entityId, JSON.stringify(metadata)]
    );
  }

  async function inMutation({ adminId, operation, action, requestId: rawRequestId, fingerprintPayload, execute }) {
    const requestId = requireRequestId(rawRequestId);
    const requestFingerprint = operationFingerprint(action, fingerprintPayload);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await resolveOperator(adminId, client, { operation });
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`calendar-operation:${operator.id}:${requestId}`]);
      const replay = await loadReplay(client, operator.id, action, requestId, requestFingerprint);
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }
      const result = await execute(client, operator, { requestId, requestFingerprint });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockStaff(client, staffIds) {
    const ids = [...new Set(staffIds.map(Number).filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
    for (const staffId of ids) await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [staffId]);
    return ids;
  }

  async function activeStaff(client, staffId) {
    const result = await client.query(
      `SELECT id, display_name, scheduling_type
         FROM staff
        WHERE id=$1 AND status='active' AND resource_type='practitioner'
        LIMIT 2`,
      [positiveId(staffId, 'CALENDAR_OPERATION_STAFF_INVALID')]
    );
    if (result.rows.length !== 1) {
      throw mutationError('CALENDAR_OPERATION_STAFF_UNAVAILABLE', 'The destination practitioner is not one uniquely active canonical practitioner.');
    }
    return result.rows[0];
  }

  async function appointmentContext(client, appointmentId) {
    const id = positiveId(appointmentId, 'CALENDAR_OPERATION_APPOINTMENT_INVALID');
    const appointmentResult = await client.query(
      `SELECT a.id, a.location_id, a.starts_at, a.ends_at, a.status, a.updated_at,
              aba.status AS booking_request_status
         FROM appointments a
         LEFT JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
        WHERE a.id=$1
        FOR UPDATE OF a`,
      [id]
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment) throw mutationError('CALENDAR_OPERATION_APPOINTMENT_NOT_FOUND', 'The canonical appointment no longer exists.');
    const staffResult = await client.query(
      `SELECT ast.id AS assignment_id, ast.staff_id, ast.position, ast.staff_name_snapshot,
              st.display_name, st.status AS staff_status
         FROM appointment_staff ast
         LEFT JOIN staff st ON st.id=ast.staff_id
        WHERE ast.appointment_id=$1
        ORDER BY ast.position, ast.id
        FOR UPDATE OF ast`,
      [id]
    );
    if (!staffResult.rows.length || staffResult.rows.some(row => !row.staff_id)) {
      throw mutationError('CALENDAR_OPERATION_ASSIGNMENT_AMBIGUOUS', 'The appointment does not have a complete canonical practitioner assignment.');
    }
    const serviceResult = await client.query(
      `SELECT id, service_id, position, service_name_snapshot
         FROM appointment_services
        WHERE appointment_id=$1
        ORDER BY position, id
        FOR SHARE`,
      [id]
    );
    return { appointment, staff: staffResult.rows, services: serviceResult.rows };
  }

  function appointmentAuthorityContext(context) {
    return {
      staffIds: context.staff.map((row) => Number(row.staff_id)),
      serviceIds: context.services.map((row) => Number(row.service_id)),
    };
  }

  function requireAppointmentAuthority(operator, context, destinationStaffId = null) {
    const appointment = appointmentAuthorityContext(context);
    const allowed = destinationStaffId == null
      ? allowsAppointmentTarget(operator.calendarAuthority, appointment)
      : allowsReassignmentTarget(operator.calendarAuthority, { appointment, destinationStaffId });
    if (!allowed) {
      throw mutationError('CALENDAR_OPERATION_FORBIDDEN', 'The canonical appointment is outside this operator’s current Calendar/service scope.');
    }
  }

  function requireStaffAuthority(operator, staffId) {
    if (!allowsStaffTarget(operator.calendarAuthority, staffId)) {
      throw mutationError('CALENDAR_OPERATION_FORBIDDEN', 'The canonical practitioner is outside this operator’s current Calendar scope.');
    }
  }

  function requireMutableAppointment(appointment, expectedRevision) {
    if (['pending', 'awaiting_client_confirmation'].includes(String(appointment.booking_request_status || ''))) {
      throw mutationError('CALENDAR_OPERATION_BOOKING_REQUEST_UNRESOLVED', 'Resolve this client booking request in Shiloh Workspace before changing its canonical appointment.');
    }
    if (!MUTABLE_APPOINTMENT_STATUSES.has(String(appointment.status || ''))) {
      throw mutationError('CALENDAR_OPERATION_APPOINTMENT_FINAL', 'Only scheduled or confirmed appointments may be changed here.');
    }
    if (revisionOf(appointment.updated_at) !== exactRevision(expectedRevision)) {
      throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The appointment changed. Reload Shiloh Calendar before retrying.');
    }
  }

  async function canonicalConflicts(client, { staffId, startsAt, endsAt, excludeAppointmentId = null }) {
    const result = await client.query(
      `SELECT conflict_type, id, starts_at, ends_at
         FROM (
           SELECT 'appointment'::text AS conflict_type, a.id, a.starts_at, a.ends_at
             FROM appointments a
             JOIN appointment_staff ast ON ast.appointment_id=a.id
            WHERE ast.staff_id=$1
              AND a.status NOT IN ('cancelled','no_show')
              AND ($4::bigint IS NULL OR a.id<>$4)
              AND a.starts_at<$3 AND a.ends_at>$2
           UNION ALL
           SELECT 'calendar_block'::text, cb.id, cb.starts_at, cb.ends_at
             FROM calendar_blocks cb
            WHERE cb.staff_id=$1
              AND cb.starts_at<$3 AND cb.ends_at>$2
           UNION ALL
           SELECT 'booking_proposal_hold'::text, aba.appointment_id, aba.proposed_starts_at, aba.proposed_ends_at
             FROM appointment_booking_approvals aba
            WHERE aba.proposed_staff_ids @> ARRAY[$1::bigint]
              AND aba.status='awaiting_client_confirmation'
              AND aba.proposal_expires_at>NOW()
              AND ($4::bigint IS NULL OR aba.appointment_id<>$4)
              AND aba.proposed_starts_at<$3 AND aba.proposed_ends_at>$2
         ) conflicts
        ORDER BY starts_at, id`,
      [staffId, startsAt, endsAt, excludeAppointmentId]
    );
    return result.rows;
  }

  async function validateStaffWindow(client, { staffId, locationId, startsAt, endsAt, excludeAppointmentId = null }) {
    const clinic = await clinicHours({ db: client, locationId, startsAt, endsAt });
    if (!clinic.covered) {
      throw mutationError('CALENDAR_OPERATION_CLINIC_HOURS', 'The target window falls outside canonical clinic hours or a clinic closure.');
    }
    const schedule = await authoritativeSchedule({ db: client, staffId, locationId, startsAt, endsAt });
    if (!schedule.covered || schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException)) {
      throw mutationError('CALENDAR_OPERATION_STAFF_SCHEDULE', 'The target window conflicts with the practitioner schedule, leave, closure or exception.');
    }
    const conflicts = await canonicalConflicts(client, { staffId, startsAt, endsAt, excludeAppointmentId });
    if (conflicts.length) {
      throw mutationError('CALENDAR_OPERATION_CONFLICT', 'The target window conflicts with canonical Shiloh scheduling state.', {
        conflicts: conflicts.map(row => ({ type: row.conflict_type, id: Number(row.id), startsAt: row.starts_at, endsAt: row.ends_at })),
      });
    }
  }

  async function reschedule({ adminId, appointmentId, expectedRevision, startsAt, requestId }) {
    const id = positiveId(appointmentId, 'CALENDAR_OPERATION_APPOINTMENT_INVALID');
    const newStart = requireFutureStart(startsAt, now());
    return inMutation({
      adminId,
      operation: 'appointment:reschedule',
      action: 'calendar.appointment_rescheduled',
      requestId,
      fingerprintPayload: { appointmentId: id, expectedRevision, startsAt: newStart.toISOString() },
      execute: async (client, operator, request) => {
        const context = await appointmentContext(client, id);
        requireAppointmentAuthority(operator, context);
        requireMutableAppointment(context.appointment, expectedRevision);
        const lockedStaffIds = await lockStaff(client, context.staff.map(row => row.staff_id));
        if (context.staff.some(row => row.staff_status !== 'active')) {
          throw mutationError('CALENDAR_OPERATION_STAFF_UNAVAILABLE', 'An assigned practitioner is no longer active.');
        }
        const duration = new Date(context.appointment.ends_at).getTime() - new Date(context.appointment.starts_at).getTime();
        if (!Number.isFinite(duration) || duration <= 0) throw mutationError('CALENDAR_OPERATION_INVALID_WINDOW', 'The appointment duration is invalid.');
        const newEnd = new Date(newStart.getTime() + duration);
        for (const staffId of lockedStaffIds) {
          await validateStaffWindow(client, {
            staffId,
            locationId: context.appointment.location_id,
            startsAt: newStart,
            endsAt: newEnd,
            excludeAppointmentId: id,
          });
        }
        const before = { startsAt: context.appointment.starts_at, endsAt: context.appointment.ends_at, revision: revisionOf(context.appointment.updated_at) };
        const updated = await client.query(
          `UPDATE appointments
              SET starts_at=$2, ends_at=$3, updated_at=NOW()
            WHERE id=$1
          RETURNING id, starts_at, ends_at, status, updated_at`,
          [id, newStart, newEnd]
        );
        const row = updated.rows[0];
        await client.query(
          `UPDATE appointment_lifecycle
              SET appointment_at=$2, appointment_ends_at=$3, reminder_sent_at=NULL, updated_at=NOW()
            WHERE appointment_id=$1`,
          [id, newStart, newEnd]
        );
        await client.query(
          `INSERT INTO appointment_status_history(appointment_id,from_status,to_status,changed_by,reason)
           VALUES($1,$2,$2,$3,'Rescheduled through authenticated Shiloh Calendar operations')`,
          [id, context.appointment.status, `admin:${operator.id}`]
        );
        await audit(client, operator, 'calendar.appointment_rescheduled', 'appointment', id, {
          ...request, before, after: { startsAt: row.starts_at, endsAt: row.ends_at, revision: revisionOf(row.updated_at) }, lockedStaffIds,
        });
        return { status: 'rescheduled', appointmentId: id, startsAt: row.starts_at, endsAt: row.ends_at, revision: revisionOf(row.updated_at) };
      },
    });
  }

  async function reassign({ adminId, appointmentId, expectedRevision, fromStaffId = null, destinationStaffId, requestId }) {
    const id = positiveId(appointmentId, 'CALENDAR_OPERATION_APPOINTMENT_INVALID');
    const destinationId = positiveId(destinationStaffId, 'CALENDAR_OPERATION_STAFF_INVALID');
    return inMutation({
      adminId,
      operation: 'appointment:reassign',
      action: 'calendar.appointment_reassigned',
      requestId,
      fingerprintPayload: { appointmentId: id, expectedRevision, fromStaffId, destinationStaffId: destinationId },
      execute: async (client, operator, request) => {
        const context = await appointmentContext(client, id);
        requireAppointmentAuthority(operator, context, destinationId);
        requireMutableAppointment(context.appointment, expectedRevision);
        const selected = fromStaffId == null
          ? (context.staff.length === 1 ? context.staff[0] : null)
          : context.staff.find(row => Number(row.staff_id) === positiveId(fromStaffId, 'CALENDAR_OPERATION_STAFF_INVALID'));
        if (!selected) throw mutationError('CALENDAR_OPERATION_ASSIGNMENT_AMBIGUOUS', 'Select the exact current practitioner assignment to replace.');
        if (Number(selected.staff_id) === destinationId || context.staff.some(row => Number(row.staff_id) === destinationId)) {
          throw mutationError('CALENDAR_OPERATION_ASSIGNMENT_DUPLICATE', 'That practitioner is already assigned to this appointment.');
        }
        const destination = await activeStaff(client, destinationId);
        const lockedStaffIds = await lockStaff(client, [...context.staff.map(row => row.staff_id), destinationId]);
        if (!context.services.length || context.services.some(row => !row.service_id)) {
          throw mutationError('CALENDAR_OPERATION_SERVICE_MAPPING', 'Every booked service must resolve canonically before reassignment.');
        }
        const serviceIds = context.services.map(row => Number(row.service_id));
        const mapped = await client.query(
          `SELECT service_id
             FROM staff_services
            WHERE staff_id=$1 AND service_id=ANY($2::bigint[])
            ORDER BY service_id`,
          [destinationId, serviceIds]
        );
        const mappedIds = new Set(mapped.rows.map(row => Number(row.service_id)));
        const missingServiceIds = serviceIds.filter(serviceId => !mappedIds.has(serviceId));
        if (missingServiceIds.length) {
          throw mutationError('CALENDAR_OPERATION_SERVICE_MAPPING', 'The destination practitioner is not eligible for every booked service.', { serviceIds: missingServiceIds });
        }
        await validateStaffWindow(client, {
          staffId: destinationId,
          locationId: context.appointment.location_id,
          startsAt: context.appointment.starts_at,
          endsAt: context.appointment.ends_at,
          excludeAppointmentId: id,
        });
        await client.query(
          `UPDATE appointment_staff
              SET staff_id=$2, staff_name_snapshot=$3
            WHERE id=$1`,
          [selected.assignment_id, destinationId, destination.display_name]
        );
        await client.query(
          `UPDATE appointment_lifecycle
              SET therapist_text=(SELECT string_agg(staff_name_snapshot,' + ' ORDER BY position)
                                     FROM appointment_staff WHERE appointment_id=$1),
                  updated_at=NOW()
            WHERE appointment_id=$1`,
          [id]
        );
        const updated = await client.query(`UPDATE appointments SET updated_at=NOW() WHERE id=$1 RETURNING updated_at`, [id]);
        const revision = revisionOf(updated.rows[0].updated_at);
        await audit(client, operator, 'calendar.appointment_reassigned', 'appointment', id, {
          ...request,
          before: { staffId: Number(selected.staff_id), revision: revisionOf(context.appointment.updated_at) },
          after: { staffId: destinationId, revision },
          lockedStaffIds,
        });
        return { status: 'reassigned', appointmentId: id, fromStaffId: Number(selected.staff_id), destinationStaffId: destinationId, revision };
      },
    });
  }

  async function cancel({ adminId, appointmentId, expectedRevision, confirmation, reason, requestId }) {
    const id = positiveId(appointmentId, 'CALENDAR_OPERATION_APPOINTMENT_INVALID');
    const expected = exactRevision(expectedRevision);
    if (
      confirmation?.confirmed !== true
      || Number(confirmation?.appointmentId) !== id
      || String(confirmation?.revision || '') !== expected
    ) {
      throw mutationError('CALENDAR_OPERATION_CANCELLATION_CONFIRMATION', 'Confirm the exact current appointment and revision before cancellation.');
    }
    return inMutation({
      adminId,
      operation: 'appointment:cancel',
      action: 'calendar.appointment_cancelled',
      requestId,
      fingerprintPayload: { appointmentId: id, expectedRevision: expected, reason: clean(reason) },
      execute: async (client, operator, request) => {
        const context = await appointmentContext(client, id);
        requireAppointmentAuthority(operator, context);
        requireMutableAppointment(context.appointment, expected);
        const cancelled = await cancelCanonicalAppointmentInTransaction(client, {
          appointmentId: id,
          actorAdminId: operator.id,
          reason: clean(reason || 'Cancelled through authenticated Shiloh Calendar operations'),
          expectedRevision: expected,
          allowedStatuses: [...MUTABLE_APPOINTMENT_STATUSES],
          auditAction: 'calendar.appointment_cancelled',
          auditMetadata: request,
        });
        if (cancelled.status === 'not_found') throw mutationError('CALENDAR_OPERATION_APPOINTMENT_NOT_FOUND', 'The canonical appointment no longer exists.');
        if (cancelled.status !== 'cancelled') throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The appointment changed before cancellation.');
        const revision = revisionOf(cancelled.appointment.updated_at);
        return { status: 'cancelled', appointmentId: id, revision };
      },
    });
  }

  function blockInput(input = {}) {
    const startsAt = requireFutureStart(input.startsAt, now());
    const endsAt = new Date(input.endsAt);
    if (!input.endsAt || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw mutationError('CALENDAR_OPERATION_INVALID_WINDOW', 'The block end must be after its start.');
    }
    const blockType = String(input.blockType || 'other').trim();
    if (!['time_off', 'personal_event', 'other'].includes(blockType)) {
      throw mutationError('CALENDAR_OPERATION_INVALID_BLOCK', 'Choose a supported canonical block type.');
    }
    return {
      staffId: positiveId(input.staffId, 'CALENDAR_OPERATION_STAFF_INVALID'),
      locationId: input.locationId == null ? null : positiveId(input.locationId),
      startsAt,
      endsAt,
      blockType,
      title: clean(input.title || 'Operational block', 120),
      notes: clean(input.notes, 500) || null,
    };
  }

  async function blockConflicts(client, input, excludeBlockId = null) {
    const appointments = await client.query(
      `SELECT a.id, a.starts_at, a.ends_at
         FROM appointments a
         JOIN appointment_staff ast ON ast.appointment_id=a.id
        WHERE ast.staff_id=$1 AND a.status NOT IN ('cancelled','no_show')
          AND a.starts_at<$3 AND a.ends_at>$2
        ORDER BY a.starts_at, a.id`,
      [input.staffId, input.startsAt, input.endsAt]
    );
    if (appointments.rows.length) {
      throw mutationError('CALENDAR_OPERATION_BLOCK_APPOINTMENT_CONFLICT', 'The block would overlap an existing appointment. The appointment was left untouched.', {
        appointments: appointments.rows.map(row => ({ id: Number(row.id), startsAt: row.starts_at, endsAt: row.ends_at })),
      });
    }
    const blocks = await client.query(
      `SELECT id FROM calendar_blocks
        WHERE staff_id=$1
          AND ($4::bigint IS NULL OR id<>$4)
          AND starts_at<$3 AND ends_at>$2
        LIMIT 1`,
      [input.staffId, input.startsAt, input.endsAt, excludeBlockId]
    );
    if (blocks.rowCount) throw mutationError('CALENDAR_OPERATION_BLOCK_CONFLICT', 'The block overlaps another canonical block.');
  }

  async function createBlock({ adminId, requestId, ...rawInput }) {
    const input = blockInput(rawInput);
    return inMutation({
      adminId, operation: 'calendar_block:manage', action: 'calendar.block_created', requestId,
      fingerprintPayload: { ...input, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
      execute: async (client, operator, request) => {
        requireStaffAuthority(operator, input.staffId);
        await activeStaff(client, input.staffId);
        await lockStaff(client, [input.staffId]);
        await blockConflicts(client, input);
        const inserted = await client.query(
          `INSERT INTO calendar_blocks(staff_id,location_id,block_type,starts_at,ends_at,title,notes,source)
           VALUES($1,$2,$3,$4,$5,$6,$7,'shiloh')
           RETURNING id,updated_at`,
          [input.staffId, input.locationId, input.blockType, input.startsAt, input.endsAt, input.title, input.notes]
        );
        const row = inserted.rows[0];
        await audit(client, operator, 'calendar.block_created', 'calendar_block', row.id, {
          ...request, staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt,
        });
        return { status: 'created', blockId: Number(row.id), revision: revisionOf(row.updated_at) };
      },
    });
  }

  async function editBlock({ adminId, blockId, expectedRevision, requestId, ...rawInput }) {
    const id = positiveId(blockId);
    const input = blockInput(rawInput);
    return inMutation({
      adminId, operation: 'calendar_block:manage', action: 'calendar.block_updated', requestId,
      fingerprintPayload: { blockId: id, expectedRevision, ...input, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
      execute: async (client, operator, request) => {
        const current = await client.query(`SELECT * FROM calendar_blocks WHERE id=$1 AND source='shiloh' FOR UPDATE`, [id]);
        const row = current.rows[0];
        if (!row) throw mutationError('CALENDAR_OPERATION_BLOCK_NOT_FOUND', 'The canonical Shiloh block no longer exists.');
        if (revisionOf(row.updated_at) !== exactRevision(expectedRevision)) throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The block changed. Reload Calendar before retrying.');
        requireStaffAuthority(operator, Number(row.staff_id));
        requireStaffAuthority(operator, input.staffId);
        await activeStaff(client, input.staffId);
        await lockStaff(client, [row.staff_id, input.staffId]);
        await blockConflicts(client, input, id);
        const updated = await client.query(
          `UPDATE calendar_blocks
              SET staff_id=$2,location_id=$3,block_type=$4,starts_at=$5,ends_at=$6,title=$7,notes=$8,updated_at=NOW()
            WHERE id=$1
          RETURNING updated_at`,
          [id, input.staffId, input.locationId, input.blockType, input.startsAt, input.endsAt, input.title, input.notes]
        );
        const revision = revisionOf(updated.rows[0].updated_at);
        await audit(client, operator, 'calendar.block_updated', 'calendar_block', id, {
          ...request,
          before: { staffId: Number(row.staff_id), startsAt: row.starts_at, endsAt: row.ends_at, revision: revisionOf(row.updated_at) },
          after: { staffId: input.staffId, startsAt: input.startsAt, endsAt: input.endsAt, revision },
        });
        return { status: 'updated', blockId: id, revision };
      },
    });
  }

  async function removeBlock({ adminId, blockId, expectedRevision, requestId }) {
    const id = positiveId(blockId);
    return inMutation({
      adminId, operation: 'calendar_block:manage', action: 'calendar.block_removed', requestId,
      fingerprintPayload: { blockId: id, expectedRevision },
      execute: async (client, operator, request) => {
        const current = await client.query(`SELECT * FROM calendar_blocks WHERE id=$1 AND source='shiloh' FOR UPDATE`, [id]);
        const row = current.rows[0];
        if (!row) throw mutationError('CALENDAR_OPERATION_BLOCK_NOT_FOUND', 'The canonical Shiloh block no longer exists.');
        if (revisionOf(row.updated_at) !== exactRevision(expectedRevision)) throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The block changed. Reload Calendar before retrying.');
        requireStaffAuthority(operator, Number(row.staff_id));
        await lockStaff(client, [row.staff_id]);
        await client.query(`DELETE FROM calendar_blocks WHERE id=$1 AND source='shiloh'`, [id]);
        await audit(client, operator, 'calendar.block_removed', 'calendar_block', id, {
          ...request, before: { staffId: Number(row.staff_id), startsAt: row.starts_at, endsAt: row.ends_at, revision: revisionOf(row.updated_at) },
        });
        return { status: 'removed', blockId: id };
      },
    });
  }

  async function leaveAppointmentConflicts(client, staffId, date) {
    const result = await client.query(
      `SELECT a.id,a.starts_at,a.ends_at
         FROM appointments a
         JOIN appointment_staff ast ON ast.appointment_id=a.id
        WHERE ast.staff_id=$1 AND a.status NOT IN ('cancelled','no_show')
          AND (a.starts_at AT TIME ZONE 'Africa/Johannesburg')::date=$2::date
        ORDER BY a.starts_at,a.id`,
      [staffId, date]
    );
    if (result.rows.length) {
      throw mutationError('CALENDAR_OPERATION_LEAVE_APPOINTMENT_CONFLICT', 'Operational leave would affect existing appointments. They were left untouched.', {
        appointments: result.rows.map(row => ({ id: Number(row.id), startsAt: row.starts_at, endsAt: row.ends_at })),
      });
    }
  }

  async function createLeave({ adminId, staffId, locationId = null, date, reason, requestId }) {
    const targetStaffId = positiveId(staffId, 'CALENDAR_OPERATION_STAFF_INVALID');
    const leaveDate = requireDate(date);
    const targetLocationId = locationId == null ? null : positiveId(locationId);
    return inMutation({
      adminId, operation: 'operational_leave:manage', action: 'calendar.operational_leave_created', requestId,
      fingerprintPayload: { staffId: targetStaffId, locationId: targetLocationId, date: leaveDate, reason: clean(reason) },
      execute: async (client, operator, request) => {
        requireStaffAuthority(operator, targetStaffId);
        await activeStaff(client, targetStaffId);
        await lockStaff(client, [targetStaffId]);
        await leaveAppointmentConflicts(client, targetStaffId, leaveDate);
        const existing = await client.query(
          `SELECT id FROM staff_schedule_exceptions
            WHERE staff_id=$1 AND exception_date=$2::date
              AND exception_type='unavailable' AND starts_local IS NULL AND ends_local IS NULL
            LIMIT 1`,
          [targetStaffId, leaveDate]
        );
        if (existing.rowCount) throw mutationError('CALENDAR_OPERATION_LEAVE_CONFLICT', 'An all-day canonical schedule exception already exists for this practitioner and date.');
        const inserted = await client.query(
          `INSERT INTO staff_schedule_exceptions(staff_id,location_id,exception_date,exception_type,starts_local,ends_local,reason)
           VALUES($1,$2,$3::date,'unavailable',NULL,NULL,$4)
           RETURNING id,updated_at`,
          [targetStaffId, targetLocationId, leaveDate, operationalLeaveReason(operator.id, reason)]
        );
        const row = inserted.rows[0];
        await audit(client, operator, 'calendar.operational_leave_created', 'staff_schedule_exception', row.id, {
          ...request, staffId: targetStaffId, date: leaveDate, provenance: 'calendar_operational_leave',
        });
        return { status: 'created', leaveId: Number(row.id), revision: revisionOf(row.updated_at) };
      },
    });
  }

  async function operationalLeaveForUpdate(client, leaveId) {
    const result = await client.query(`SELECT * FROM staff_schedule_exceptions WHERE id=$1 FOR UPDATE`, [positiveId(leaveId)]);
    const row = result.rows[0];
    if (!row || !isOperationalLeave(row)) {
      throw mutationError('CALENDAR_OPERATION_LEAVE_NOT_FOUND', 'Only distinct Calendar operational leave may be changed here.');
    }
    return row;
  }

  async function editLeave({ adminId, leaveId, expectedRevision, date, reason, locationId = null, requestId }) {
    const id = positiveId(leaveId);
    const leaveDate = requireDate(date);
    const targetLocationId = locationId == null ? null : positiveId(locationId);
    return inMutation({
      adminId, operation: 'operational_leave:manage', action: 'calendar.operational_leave_updated', requestId,
      fingerprintPayload: { leaveId: id, expectedRevision, date: leaveDate, reason: clean(reason), locationId: targetLocationId },
      execute: async (client, operator, request) => {
        const row = await operationalLeaveForUpdate(client, id);
        if (revisionOf(row.updated_at) !== exactRevision(expectedRevision)) throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The leave record changed. Reload Calendar before retrying.');
        requireStaffAuthority(operator, Number(row.staff_id));
        await lockStaff(client, [row.staff_id]);
        await leaveAppointmentConflicts(client, Number(row.staff_id), leaveDate);
        const existing = await client.query(
          `SELECT id FROM staff_schedule_exceptions
            WHERE staff_id=$1 AND exception_date=$2::date AND id<>$3
              AND exception_type='unavailable' AND starts_local IS NULL AND ends_local IS NULL
            LIMIT 1`,
          [Number(row.staff_id), leaveDate, id]
        );
        if (existing.rowCount) throw mutationError('CALENDAR_OPERATION_LEAVE_CONFLICT', 'An all-day canonical schedule exception already exists for this practitioner and date.');
        const updated = await client.query(
          `UPDATE staff_schedule_exceptions
              SET location_id=$2,exception_date=$3::date,reason=$4,updated_at=NOW()
            WHERE id=$1
          RETURNING updated_at`,
          [id, targetLocationId, leaveDate, operationalLeaveReason(operator.id, reason)]
        );
        const revision = revisionOf(updated.rows[0].updated_at);
        await audit(client, operator, 'calendar.operational_leave_updated', 'staff_schedule_exception', id, {
          ...request,
          before: { staffId: Number(row.staff_id), date: row.exception_date, revision: revisionOf(row.updated_at) },
          after: { staffId: Number(row.staff_id), date: leaveDate, revision, provenance: 'calendar_operational_leave' },
        });
        return { status: 'updated', leaveId: id, revision };
      },
    });
  }

  async function removeLeave({ adminId, leaveId, expectedRevision, requestId }) {
    const id = positiveId(leaveId);
    return inMutation({
      adminId, operation: 'operational_leave:manage', action: 'calendar.operational_leave_removed', requestId,
      fingerprintPayload: { leaveId: id, expectedRevision },
      execute: async (client, operator, request) => {
        const row = await operationalLeaveForUpdate(client, id);
        if (revisionOf(row.updated_at) !== exactRevision(expectedRevision)) throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The leave record changed. Reload Calendar before retrying.');
        requireStaffAuthority(operator, Number(row.staff_id));
        await lockStaff(client, [row.staff_id]);
        await client.query(`DELETE FROM staff_schedule_exceptions WHERE id=$1`, [id]);
        await audit(client, operator, 'calendar.operational_leave_removed', 'staff_schedule_exception', id, {
          ...request, before: { staffId: Number(row.staff_id), date: row.exception_date, revision: revisionOf(row.updated_at), provenance: 'calendar_operational_leave' },
        });
        return { status: 'removed', leaveId: id };
      },
    });
  }

  async function loadScheduleState(queryable, { staffId, dayOfWeek, locationId, forUpdate = false }) {
    const locationPredicate = `(($3::bigint IS NULL AND location_id IS NULL) OR location_id=$3)`;
    const windows = await queryable.query(
      `SELECT id,starts_local,ends_local,updated_at
         FROM staff_working_hours
        WHERE staff_id=$1 AND day_of_week=$2 AND active=TRUE AND ${locationPredicate}
        ORDER BY starts_local,id${forUpdate ? ' FOR UPDATE' : ''}`,
      [staffId, dayOfWeek, locationId]
    );
    const closures = await queryable.query(
      `SELECT id,updated_at
         FROM staff_recurring_day_closures
        WHERE staff_id=$1 AND day_of_week=$2 AND ${locationPredicate}
        ORDER BY id${forUpdate ? ' FOR UPDATE' : ''}`,
      [staffId, dayOfWeek, locationId]
    );
    const mode = closures.rows.length ? 'closed' : windows.rows.length ? 'window' : 'inherit';
    return {
      staffId, dayOfWeek, locationId, mode,
      windows: windows.rows,
      closures: closures.rows,
      revision: scheduleStateRevision({ staffId, dayOfWeek, locationId, windows: windows.rows, closures: closures.rows }),
    };
  }

  async function getScheduleState(adminId, { staffId, dayOfWeek, locationId = null }) {
    const targetStaffId = positiveId(staffId, 'CALENDAR_OPERATION_STAFF_INVALID');
    const operator = await resolveOperator(adminId, db, { operation: 'working_schedule:manage' });
    requireStaffAuthority(operator, targetStaffId);
    const day = Number(dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw mutationError('CALENDAR_OPERATION_INVALID_DAY', 'Choose a valid weekday.');
    const targetLocationId = locationId == null ? null : positiveId(locationId);
    const staff = await activeStaff(db, targetStaffId);
    if (staff.scheduling_type === 'regular') {
      return {
        staffId: targetStaffId,
        dayOfWeek: day,
        locationId: targetLocationId,
        mode: 'inherit',
        windows: [],
        closures: [],
        recurringAuthority: 'location_working_hours',
        revision: scheduleStateRevision({ staffId: targetStaffId, dayOfWeek: day, locationId: targetLocationId }),
      };
    }
    const state = await loadScheduleState(db, { staffId: targetStaffId, dayOfWeek: day, locationId: targetLocationId });
    return {
      ...state,
      windows: state.windows.map(row => ({ id: Number(row.id), startsLocal: String(row.starts_local).slice(0, 5), endsLocal: String(row.ends_local).slice(0, 5) })),
      closures: state.closures.map(row => ({ id: Number(row.id) })),
    };
  }

  function scheduleInput({ staffId, dayOfWeek, locationId = null, mode, startsLocal, endsLocal, expectedRevision }) {
    const targetStaffId = positiveId(staffId, 'CALENDAR_OPERATION_STAFF_INVALID');
    const day = Number(dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw mutationError('CALENDAR_OPERATION_INVALID_DAY', 'Choose a valid weekday.');
    const targetLocationId = locationId == null ? null : positiveId(locationId);
    const targetMode = String(mode || '').trim();
    if (!['window', 'closed', 'inherit'].includes(targetMode)) throw mutationError('CALENDAR_OPERATION_INVALID_SCHEDULE', 'Choose window, closed or inherit.');
    let start = null;
    let end = null;
    if (targetMode === 'window') {
      start = requireTime(startsLocal);
      end = requireTime(endsLocal);
      if (start >= end) throw mutationError('CALENDAR_OPERATION_INVALID_WINDOW', 'The working-window end must be after its start.');
    }
    return { staffId: targetStaffId, dayOfWeek: day, locationId: targetLocationId, mode: targetMode, startsLocal: start, endsLocal: end, expectedRevision: String(expectedRevision || '') };
  }

  async function setWorkingSchedule({ adminId, requestId, ...rawInput }) {
    const input = scheduleInput(rawInput);
    return inMutation({
      adminId, operation: 'working_schedule:manage', action: 'calendar.working_schedule_replaced', requestId,
      fingerprintPayload: input,
      execute: async (client, operator, request) => {
        requireStaffAuthority(operator, input.staffId);
        const staff = await activeStaff(client, input.staffId);
        if (staff.scheduling_type === 'regular') {
          throw mutationError('CALENDAR_OPERATION_CLINIC_HOURS_AUTHORITATIVE', 'Regular practitioners use canonical clinic hours. Use dated leave or unavailable exceptions for staff-specific constraints.');
        }
        await lockStaff(client, [input.staffId]);
        const before = await loadScheduleState(client, { ...input, forUpdate: true });
        if (before.revision !== input.expectedRevision) throw mutationError('CALENDAR_OPERATION_STALE_REVISION', 'The working schedule changed. Reload it before retrying.');
        const locationPredicate = `(($3::bigint IS NULL AND location_id IS NULL) OR location_id=$3)`;
        await client.query(`DELETE FROM staff_working_hours WHERE staff_id=$1 AND day_of_week=$2 AND ${locationPredicate}`, [input.staffId, input.dayOfWeek, input.locationId]);
        await client.query(`DELETE FROM staff_recurring_day_closures WHERE staff_id=$1 AND day_of_week=$2 AND ${locationPredicate}`, [input.staffId, input.dayOfWeek, input.locationId]);
        if (input.mode === 'window') {
          await client.query(
            `INSERT INTO staff_working_hours(staff_id,location_id,day_of_week,starts_local,ends_local,active)
             VALUES($1,$2,$3,$4::time,$5::time,TRUE)`,
            [input.staffId, input.locationId, input.dayOfWeek, input.startsLocal, input.endsLocal]
          );
        } else if (input.mode === 'closed') {
          await client.query(
            `INSERT INTO staff_recurring_day_closures(staff_id,location_id,day_of_week)
             VALUES($1,$2,$3)`,
            [input.staffId, input.locationId, input.dayOfWeek]
          );
        }
        const appointments = await client.query(
          `SELECT a.id,a.location_id,a.starts_at,a.ends_at
             FROM appointments a
             JOIN appointment_staff ast ON ast.appointment_id=a.id
            WHERE ast.staff_id=$1 AND a.status NOT IN ('cancelled','no_show') AND a.ends_at>NOW()
              AND EXTRACT(DOW FROM (a.starts_at AT TIME ZONE 'Africa/Johannesburg'))::int=$2
              AND ($3::bigint IS NULL OR a.location_id=$3)
            ORDER BY a.starts_at,a.id
            FOR SHARE OF a`,
          [input.staffId, input.dayOfWeek, input.locationId]
        );
        const conflicts = [];
        for (const appointment of appointments.rows) {
          const schedule = await authoritativeSchedule({
            db: client,
            staffId: input.staffId,
            locationId: appointment.location_id,
            startsAt: appointment.starts_at,
            endsAt: appointment.ends_at,
          });
          if (!schedule.covered || schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException)) {
            conflicts.push({ id: Number(appointment.id), startsAt: appointment.starts_at, endsAt: appointment.ends_at });
          }
        }
        if (conflicts.length) {
          throw mutationError('CALENDAR_OPERATION_SCHEDULE_APPOINTMENT_CONFLICT', 'The proposed schedule would strand existing appointments. Nothing was changed.', { appointments: conflicts });
        }
        const after = await loadScheduleState(client, input);
        await audit(client, operator, 'calendar.working_schedule_replaced', 'staff', input.staffId, {
          ...request,
          dayOfWeek: input.dayOfWeek,
          locationId: input.locationId,
          before: { mode: before.mode, revision: before.revision },
          after: { mode: input.mode, revision: after.revision },
          staffSchedulingType: staff.scheduling_type,
        });
        return { status: 'updated', staffId: input.staffId, dayOfWeek: input.dayOfWeek, mode: input.mode, revision: after.revision };
      },
    });
  }

  return {
    resolveOperator,
    getScheduleState,
    reschedule,
    reassign,
    cancel,
    createBlock,
    editBlock,
    removeBlock,
    createLeave,
    editLeave,
    removeLeave,
    setWorkingSchedule,
  };
}

module.exports = {
  MUTABLE_APPOINTMENT_STATUSES,
  OPERATIONS,
  OPERATIONAL_LEAVE_REASON,
  createCalendarOperationalMutationService,
  staticMutationCapability,
  scheduleStateRevision,
  operationalLeaveReason,
  isOperationalLeave,
  operationFingerprint,
  revisionOf,
  mutationError,
};
