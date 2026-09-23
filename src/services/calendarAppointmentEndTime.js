const crypto = require('crypto');
const { pool } = require('../db/pool');
const { checkClinicHours } = require('./clinicHours');
const { checkAuthoritativeSchedule } = require('./adminAvailability');
const {
  CALENDAR_CAPABILITIES,
  resolveCalendarAuthority,
  hasCapability,
  allowsAppointmentTarget,
} = require('./calendarAuthorization');

function endTimeError(code, message, httpStatus = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  if (details) error.details = details;
  return error;
}

function positiveId(value, code = 'CALENDAR_END_TIME_INVALID_ID') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw endTimeError(code, 'A positive canonical appointment identifier is required.');
  return id;
}

function revisionOf(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function exactRevision(value) {
  const raw = String(value || '').trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== raw) {
    throw endTimeError('CALENDAR_END_TIME_INVALID_REVISION', 'Reload the canonical appointment before retrying.');
  }
  return raw;
}

function requireEnd(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw endTimeError('CALENDAR_END_TIME_INVALID_END', 'Choose a valid appointment end time.');
  }
  return date;
}

function requireRequestId(value) {
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw endTimeError('CALENDAR_END_TIME_INVALID_REQUEST', 'A valid operation request identifier is required.');
  }
  return requestId;
}

function fingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createCalendarAppointmentEndTimeService({
  db = pool,
  clinicHours = checkClinicHours,
  authoritativeSchedule = checkAuthoritativeSchedule,
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Appointment end-time service requires a database.');

  async function resolveOperator(adminId, queryable = db) {
    const operator = await resolveCalendarAuthority(queryable, positiveId(adminId, 'CALENDAR_END_TIME_FORBIDDEN'));
    if (!operator || !hasCapability(operator.calendarAuthority, CALENDAR_CAPABILITIES.ADJUST_END)) {
      throw endTimeError('CALENDAR_END_TIME_FORBIDDEN', 'Current staff authority does not permit appointment end-time adjustment.', 403);
    }
    return operator;
  }

  async function loadAppointment(queryable, appointmentId, { lock = false } = {}) {
    const id = positiveId(appointmentId);
    const appointmentResult = await queryable.query(
      `SELECT id, location_id, starts_at, ends_at, status, updated_at
         FROM appointments
        WHERE id=$1
        ${lock ? 'FOR UPDATE' : ''}`,
      [id]
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment) throw endTimeError('CALENDAR_END_TIME_NOT_FOUND', 'The canonical appointment no longer exists.', 404);

    const staffResult = await queryable.query(
      `SELECT ast.staff_id, ast.position, ast.staff_name_snapshot, st.status AS staff_status
         FROM appointment_staff ast
         LEFT JOIN staff st ON st.id=ast.staff_id
        WHERE ast.appointment_id=$1
        ORDER BY ast.position, ast.id
        ${lock ? 'FOR UPDATE OF ast' : ''}`,
      [id]
    );
    if (!staffResult.rows.length || staffResult.rows.some((row) => !row.staff_id)) {
      throw endTimeError('CALENDAR_END_TIME_ASSIGNMENT_AMBIGUOUS', 'The appointment does not have a complete canonical practitioner assignment.', 409);
    }

    const serviceResult = await queryable.query(
      `SELECT service_id, position, service_name_snapshot
         FROM appointment_services
        WHERE appointment_id=$1
        ORDER BY position, id`,
      [id]
    );
    if (!serviceResult.rows.length || serviceResult.rows.some((row) => !row.service_id)) {
      throw endTimeError('CALENDAR_END_TIME_SERVICE_AMBIGUOUS', 'The appointment does not have a complete canonical service assignment.', 409);
    }

    return { appointment, staff: staffResult.rows, services: serviceResult.rows };
  }

  function requireAppointmentAuthority(operator, context) {
    const allowed = allowsAppointmentTarget(operator.calendarAuthority, {
      staffIds: context.staff.map((row) => Number(row.staff_id)),
      serviceIds: context.services.map((row) => Number(row.service_id)),
    });
    if (!allowed) {
      throw endTimeError('CALENDAR_END_TIME_FORBIDDEN', 'The appointment is outside this staff member’s current Calendar/service scope.', 403);
    }
  }

  function state(context) {
    const row = context.appointment;
    return {
      appointmentId: Number(row.id),
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      status: String(row.status || ''),
      revision: revisionOf(row.updated_at),
      staffIds: context.staff.map((item) => Number(item.staff_id)),
    };
  }

  async function get({ adminId, appointmentId } = {}) {
    const operator = await resolveOperator(adminId, db);
    const context = await loadAppointment(db, appointmentId);
    requireAppointmentAuthority(operator, context);
    if (['cancelled', 'no_show'].includes(String(context.appointment.status || ''))) {
      throw endTimeError('CALENDAR_END_TIME_FINAL', 'A final appointment does not have an adjustable visit end time.', 409);
    }
    return { status: 'ready', appointment: state(context) };
  }

  async function conflicts(client, { staffId, startsAt, endsAt, excludeAppointmentId }) {
    const result = await client.query(
      `SELECT conflict_type, id, starts_at, ends_at
         FROM (
           SELECT 'appointment'::text AS conflict_type, a.id, a.starts_at, a.ends_at
             FROM appointments a
             JOIN appointment_staff ast ON ast.appointment_id=a.id
            WHERE ast.staff_id=$1
              AND a.status NOT IN ('cancelled','no_show')
              AND a.id<>$4
              AND a.starts_at<$3 AND a.ends_at>$2
           UNION ALL
           SELECT 'calendar_block'::text, cb.id, cb.starts_at, cb.ends_at
             FROM calendar_blocks cb
            WHERE cb.staff_id=$1
              AND cb.starts_at<$3 AND cb.ends_at>$2
         ) x
        ORDER BY starts_at, id`,
      [staffId, startsAt, endsAt, excludeAppointmentId]
    );
    return result.rows;
  }

  async function validatePlannedWindow(client, context, newEnd, lockedStaffIds) {
    for (const staffId of lockedStaffIds) {
      const clinic = await clinicHours({
        db: client,
        locationId: context.appointment.location_id,
        startsAt: context.appointment.starts_at,
        endsAt: newEnd,
      });
      if (!clinic.covered) {
        throw endTimeError('CALENDAR_END_TIME_CLINIC_HOURS', 'The revised end time falls outside canonical clinic hours or a clinic closure.', 409);
      }
      const schedule = await authoritativeSchedule({
        db: client,
        staffId,
        locationId: context.appointment.location_id,
        startsAt: context.appointment.starts_at,
        endsAt: newEnd,
      });
      if (!schedule.covered || schedule.partialUnavailable || (schedule.allDayUnavailable && !schedule.insideAvailableException)) {
        throw endTimeError('CALENDAR_END_TIME_STAFF_SCHEDULE', 'The revised end time conflicts with the practitioner schedule, leave, closure or exception.', 409);
      }
    }
  }

  async function adjust({ adminId, appointmentId, expectedRevision, endsAt, requestId: rawRequestId } = {}) {
    if (typeof db.connect !== 'function') throw new Error('Appointment end-time writes require a transactional database.');
    const id = positiveId(appointmentId);
    const expected = exactRevision(expectedRevision);
    const newEnd = requireEnd(endsAt);
    const requestId = requireRequestId(rawRequestId);
    const requestFingerprint = fingerprint({ appointmentId: id, expectedRevision: expected, endsAt: newEnd.toISOString() });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await resolveOperator(adminId, client);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`calendar-end:${operator.id}:${requestId}`]);
      const replay = await client.query(
        `SELECT entity_id, metadata
           FROM crm_audit_events
          WHERE actor_admin_id=$1
            AND action='calendar.appointment_end_adjusted'
            AND metadata->>'requestId'=$2
          ORDER BY id LIMIT 1`,
        [operator.id, requestId]
      );
      if (replay.rows[0]) {
        if (String(replay.rows[0].metadata?.requestFingerprint || '') !== requestFingerprint) {
          throw endTimeError('CALENDAR_END_TIME_IDEMPOTENCY_MISMATCH', 'That operation identifier was already used for a different end-time adjustment.', 409);
        }
        await client.query('COMMIT');
        return {
          status: 'idempotent_replay',
          appointmentId: Number(replay.rows[0].entity_id),
          endsAt: replay.rows[0].metadata?.after?.endsAt || null,
          revision: replay.rows[0].metadata?.after?.revision || null,
        };
      }

      const context = await loadAppointment(client, id, { lock: true });
      requireAppointmentAuthority(operator, context);
      const appointment = context.appointment;
      if (String(appointment.status || '') === 'cancelled') {
        throw endTimeError('CALENDAR_END_TIME_FINAL', 'A cancelled appointment does not have an adjustable visit end time.', 409);
      }
      if (revisionOf(appointment.updated_at) !== expected) {
        throw endTimeError('CALENDAR_END_TIME_STALE_REVISION', 'The appointment changed. Reload Calendar before retrying.', 409);
      }

      const start = new Date(appointment.starts_at);
      const oldEnd = new Date(appointment.ends_at);
      if (Number.isNaN(start.getTime()) || Number.isNaN(oldEnd.getTime()) || newEnd.getTime() <= start.getTime()) {
        throw endTimeError('CALENDAR_END_TIME_INVALID_WINDOW', 'Appointment end time must remain after its start time.');
      }
      if (newEnd.getTime() === oldEnd.getTime()) {
        await client.query('COMMIT');
        return { status: 'unchanged', appointmentId: id, endsAt: oldEnd.toISOString(), revision: expected };
      }

      const lockedStaffIds = [...new Set(context.staff.map((row) => Number(row.staff_id)))].sort((a, b) => a - b);
      for (const staffId of lockedStaffIds) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [staffId]);

      const extending = newEnd.getTime() > oldEnd.getTime();
      if (extending) {
        for (const staffId of lockedStaffIds) {
          const found = await conflicts(client, {
            staffId,
            startsAt: start,
            endsAt: newEnd,
            excludeAppointmentId: id,
          });
          if (found.length) {
            throw endTimeError('CALENDAR_END_TIME_CONFLICT', 'The revised end time overlaps another canonical appointment or Calendar block.', 409, {
              conflicts: found.map((row) => ({
                type: row.conflict_type,
                id: Number(row.id),
                startsAt: row.starts_at,
                endsAt: row.ends_at,
              })),
            });
          }
        }
      }

      const planned = start.getTime() > now().getTime();
      if (planned) await validatePlannedWindow(client, context, newEnd, lockedStaffIds);

      const updated = await client.query(
        `UPDATE appointments
            SET ends_at=$2, updated_at=NOW()
          WHERE id=$1
        RETURNING id, starts_at, ends_at, status, updated_at`,
        [id, newEnd]
      );
      const row = updated.rows[0];
      await client.query(
        `UPDATE appointment_lifecycle
            SET appointment_ends_at=$2
          WHERE appointment_id=$1`,
        [id, newEnd]
      );

      const before = { endsAt: oldEnd.toISOString(), revision: expected };
      const after = { endsAt: new Date(row.ends_at).toISOString(), revision: revisionOf(row.updated_at) };
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'calendar.appointment_end_adjusted','appointment',$2,$3::jsonb)`,
        [operator.id, id, JSON.stringify({
          requestId,
          requestFingerprint,
          origin: 'workspace.calendar',
          mode: planned ? 'planned_end' : 'actual_end',
          before,
          after,
          startsAt: start.toISOString(),
          status: String(appointment.status || ''),
          extending,
          lockedStaffIds,
          clientNotificationsQueued: false,
          clientNotificationsSent: false,
        })]
      );
      await client.query('COMMIT');
      return { status: 'adjusted', appointmentId: id, startsAt: new Date(row.starts_at).toISOString(), endsAt: after.endsAt, revision: after.revision };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  return { resolveOperator, get, adjust };
}

module.exports = {
  createCalendarAppointmentEndTimeService,
  endTimeError,
  revisionOf,
};
