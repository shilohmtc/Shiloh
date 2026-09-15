const { createHash } = require('crypto');
const { pool } = require('../db/pool');
const { getDefaultActiveLocation } = require('./clinicHours');

const SCHEDULE_MANAGE_CAPABILITY = 'schedule:manage';
const WRITABLE_DAYS = Object.freeze([1, 2, 3, 4, 5, 6]);
const DAY_NAMES = Object.freeze({
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
});
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/i;

class WorkspaceClinicHoursError extends Error {
  constructor(code, message, httpStatus, details = null) {
    super(message);
    this.name = 'WorkspaceClinicHoursError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (details) this.details = details;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function timeValue(value) {
  return String(value || '').slice(0, 5);
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function evaluateAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const adminId = positiveId(row.id);
  if (!adminId || row.admin_active !== true) return null;
  if (row.staff_id != null && row.staff_status !== 'active') return null;
  if (permissionSet(row.permissions)[SCHEDULE_MANAGE_CAPABILITY] !== true) return null;
  return {
    key: 'workspace_clinic_hours_manage_v1',
    operatorAdminId: adminId,
    displayName: String(row.display_name || 'Staff').trim() || 'Staff',
    capability: SCHEDULE_MANAGE_CAPABILITY,
  };
}

function normalizeDayPayload(days) {
  if (!Array.isArray(days) || days.length !== WRITABLE_DAYS.length) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_DAYS',
      'Clinic hours must include Monday through Saturday exactly once.',
      400
    );
  }
  const normalized = [];
  const seen = new Set();
  for (const raw of days) {
    const dayOfWeek = Number(raw?.dayOfWeek);
    if (!WRITABLE_DAYS.includes(dayOfWeek) || seen.has(dayOfWeek)) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_INVALID_DAYS',
        'Clinic hours must include Monday through Saturday exactly once.',
        400
      );
    }
    seen.add(dayOfWeek);
    const open = raw?.open === true;
    if (!open) {
      normalized.push({ dayOfWeek, open: false, startsLocal: null, endsLocal: null });
      continue;
    }
    const startsLocal = String(raw?.startsLocal || '').trim();
    const endsLocal = String(raw?.endsLocal || '').trim();
    if (!TIME_PATTERN.test(startsLocal) || !TIME_PATTERN.test(endsLocal)) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_INVALID_TIME',
        `${DAY_NAMES[dayOfWeek]} opening and closing times must use HH:MM.`,
        400
      );
    }
    if (endsLocal <= startsLocal) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_INVALID_WINDOW',
        `${DAY_NAMES[dayOfWeek]} closing time must be later than opening time.`,
        400
      );
    }
    normalized.push({ dayOfWeek, open: true, startsLocal, endsLocal });
  }
  normalized.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return normalized;
}

function normalizeExceptionPayload(raw = {}) {
  const exceptionDate = String(raw.exceptionDate || '').trim();
  if (!DATE_PATTERN.test(exceptionDate)) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_DATE',
      'Clinic closure or holiday hours require a valid YYYY-MM-DD date.',
      400
    );
  }
  const parsed = new Date(`${exceptionDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== exceptionDate) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_DATE',
      'Clinic closure or holiday hours require a valid calendar date.',
      400
    );
  }
  const exceptionType = String(raw.exceptionType || '').trim().toLowerCase();
  if (!['closed', 'open'].includes(exceptionType)) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_TYPE',
      'Choose Closed or Open with special hours.',
      400
    );
  }
  if (exceptionType === 'closed') {
    return { exceptionDate, exceptionType, startsLocal: null, endsLocal: null };
  }
  const startsLocal = String(raw.startsLocal || '').trim();
  const endsLocal = String(raw.endsLocal || '').trim();
  if (!TIME_PATTERN.test(startsLocal) || !TIME_PATTERN.test(endsLocal)) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_TIME',
      'Special opening and closing times must use HH:MM.',
      400
    );
  }
  if (endsLocal <= startsLocal) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_WINDOW',
      'Special closing time must be later than opening time.',
      400
    );
  }
  return { exceptionDate, exceptionType, startsLocal, endsLocal };
}

function canonicalDays(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const dayOfWeek = Number(row.day_of_week);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;
    const list = grouped.get(dayOfWeek) || [];
    list.push(row);
    grouped.set(dayOfWeek, list);
  }
  for (const dayOfWeek of WRITABLE_DAYS) {
    if ((grouped.get(dayOfWeek) || []).length > 1) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_AMBIGUOUS_DAY',
        `${DAY_NAMES[dayOfWeek]} has more than one active clinic-hours window. The editor failed closed.`,
        409,
        { dayOfWeek }
      );
    }
  }
  return [1, 2, 3, 4, 5, 6].map(dayOfWeek => {
    const row = (grouped.get(dayOfWeek) || [])[0];
    return row
      ? { dayOfWeek, name: DAY_NAMES[dayOfWeek], open: true, startsLocal: timeValue(row.starts_local), endsLocal: timeValue(row.ends_local), permanent: false }
      : { dayOfWeek, name: DAY_NAMES[dayOfWeek], open: false, startsLocal: null, endsLocal: null, permanent: false };
  }).concat({
    dayOfWeek: 0,
    name: DAY_NAMES[0],
    open: false,
    startsLocal: null,
    endsLocal: null,
    permanent: true,
  });
}

function canonicalExceptions(rows = []) {
  return rows.map(row => ({
    id: positiveId(row.id),
    exceptionDate: dateValue(row.exception_date),
    exceptionType: row.exception_type === 'open' ? 'open' : 'closed',
    startsLocal: row.exception_type === 'open' ? timeValue(row.starts_local) : null,
    endsLocal: row.exception_type === 'open' ? timeValue(row.ends_local) : null,
    holidayName: row.holiday_name == null ? null : String(row.holiday_name),
    actorAdminId: positiveId(row.actor_admin_id),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));
}

function canonicalHolidays(rows = []) {
  return rows.map(row => ({
    exceptionDate: dateValue(row.holiday_date),
    holidayName: String(row.holiday_name || 'Public holiday'),
    clinicExceptionType: row.clinic_exception_type || null,
    clinicStartsLocal: row.clinic_exception_type === 'open' ? timeValue(row.clinic_starts_local) : null,
    clinicEndsLocal: row.clinic_exception_type === 'open' ? timeValue(row.clinic_ends_local) : null,
    assistantExceptionType: row.assistant_exception_type || null,
    assistantStartsLocal: row.assistant_exception_type === 'open' ? timeValue(row.assistant_starts_local) : null,
    assistantEndsLocal: row.assistant_exception_type === 'open' ? timeValue(row.assistant_ends_local) : null,
    decisionNeeded: !row.clinic_exception_type,
  }));
}

function revisionFor(locationId, days) {
  const canonical = {
    locationId: positiveId(locationId),
    days: days.map(day => ({
      dayOfWeek: day.dayOfWeek,
      open: day.open === true,
      startsLocal: day.startsLocal || null,
      endsLocal: day.endsLocal || null,
      permanent: day.permanent === true,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function requireExpectedRevision(value) {
  const revision = String(value || '').trim().toLowerCase();
  if (!REVISION_PATTERN.test(revision)) {
    throw new WorkspaceClinicHoursError(
      'WORKSPACE_CLINIC_HOURS_INVALID_REVISION',
      'A valid current clinic-hours revision is required.',
      400
    );
  }
  return revision;
}

function auditProjection(days) {
  return days.map(day => ({
    dayOfWeek: day.dayOfWeek,
    open: day.open === true,
    startsLocal: day.startsLocal || null,
    endsLocal: day.endsLocal || null,
    permanent: day.permanent === true,
  }));
}

function createWorkspaceClinicHoursService({ db = pool, locationResolver = getDefaultActiveLocation } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Clinic hours database is required');

  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return [];
    const result = await queryable.query(
      `/* workspaceClinicHours:principal */
       SELECT a.id, a.staff_id, a.display_name, a.permissions,
              a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }

  async function resolveAccess(adminId, queryable = db) {
    return evaluateAuthority(await principalRows(adminId, queryable));
  }

  async function requireAccess(adminId, queryable = db) {
    const authority = await resolveAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_FORBIDDEN',
        'Your authenticated Shiloh access does not permit clinic-hours management.',
        403
      );
    }
    return authority;
  }

  async function requireLocation(queryable = db) {
    const location = await locationResolver(queryable);
    if (!location || !positiveId(location.id)) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_LOCATION_UNRESOLVED',
        'Clinic hours cannot be managed because Shiloh does not resolve to exactly one active clinic location.',
        409
      );
    }
    return location;
  }

  async function activeRows(locationId, queryable = db, { lock = false } = {}) {
    const result = await queryable.query(
      `/* workspaceClinicHours:activeRows */
       SELECT id, day_of_week, starts_local, ends_local
         FROM location_working_hours
        WHERE location_id=$1
          AND active=TRUE
        ORDER BY day_of_week, starts_local, id${lock ? '\n        FOR UPDATE' : ''}`,
      [locationId]
    );
    return result.rows;
  }

  async function assistantRows(locationId, queryable = db, { lock = false } = {}) {
    const result = await queryable.query(
      `/* workspaceClinicHours:assistantRows */ SELECT id, day_of_week, starts_local, ends_local
         FROM location_assistant_booking_hours WHERE location_id=$1 AND active=TRUE
        ORDER BY day_of_week, starts_local, id${lock ? '\n        FOR UPDATE' : ''}`, [locationId]);
    return result.rows;
  }

  async function exceptionRows(locationId, queryable = db) {
    const result = await queryable.query(
      `/* workspaceClinicHours:exceptionRows */
       SELECT e.id, e.exception_date, e.exception_type, e.starts_local, e.ends_local,
              e.actor_admin_id, e.updated_at, h.name AS holiday_name
         FROM location_hours_exceptions e
         LEFT JOIN public_holidays h
           ON h.holiday_date=e.exception_date
          AND h.country_code='ZA'
        WHERE e.location_id=$1
        ORDER BY e.exception_date DESC, e.id DESC`,
      [locationId]
    );
    return result.rows;
  }

  async function holidayRows(locationId, queryable = db) {
    const result = await queryable.query(`/* workspaceClinicHours:holidayRows */
      SELECT h.holiday_date, h.name holiday_name,
             c.exception_type clinic_exception_type, c.starts_local clinic_starts_local, c.ends_local clinic_ends_local,
             a.exception_type assistant_exception_type, a.starts_local assistant_starts_local, a.ends_local assistant_ends_local
        FROM public_holidays h
        LEFT JOIN location_hours_exceptions c ON c.location_id=$1 AND c.exception_date=h.holiday_date
        LEFT JOIN location_assistant_hours_exceptions a ON a.location_id=$1 AND a.exception_date=h.holiday_date
       WHERE h.country_code='ZA' AND h.holiday_date >= CURRENT_DATE
       ORDER BY h.holiday_date LIMIT 16`, [locationId]);
    return result.rows;
  }

  async function buildModel({ adminId } = {}) {
    const authority = await requireAccess(adminId);
    const location = await requireLocation();
    const [daysRows, assistantDayRows, exceptionsRows, holidaysRows] = await Promise.all([
      activeRows(location.id), assistantRows(location.id), exceptionRows(location.id), holidayRows(location.id),
    ]);
    const days = canonicalDays(daysRows);
    const assistantDays = canonicalDays(assistantDayRows);
    return {
      authority,
      location: { id: positiveId(location.id), name: String(location.name || 'Shiloh'), timezone: String(location.timezone || 'Africa/Johannesburg') },
      days,
      revision: revisionFor(location.id, days),
      assistantDays,
      assistantRevision: revisionFor(location.id, assistantDays),
      exceptions: canonicalExceptions(exceptionsRows),
      holidays: canonicalHolidays(holidaysRows),
    };
  }

  async function updateAssistantHours({ adminId, expectedRevision, days } = {}) {
    const expected = requireExpectedRevision(expectedRevision);
    const desired = normalizeDayPayload(days);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const authority = await requireAccess(adminId, client);
      const location = await requireLocation(client);
      const clinicDays = canonicalDays(await activeRows(location.id, client, { lock: true }));
      for (const day of desired) {
        const clinic = clinicDays.find(item => item.dayOfWeek === day.dayOfWeek);
        if (day.open && (!clinic?.open || day.startsLocal < clinic.startsLocal || day.endsLocal > clinic.endsLocal)) {
          throw new WorkspaceClinicHoursError('WORKSPACE_ASSISTANT_HOURS_OUTSIDE_CLINIC', `${DAY_NAMES[day.dayOfWeek]} Shiloh Assistant hours must stay within clinic operating hours.`, 400);
        }
      }
      const before = canonicalDays(await assistantRows(location.id, client, { lock: true }));
      if (revisionFor(location.id, before) !== expected) throw new WorkspaceClinicHoursError('WORKSPACE_ASSISTANT_HOURS_STALE_REVISION', 'Shiloh Assistant hours changed. Reload and try again.', 409);
      await client.query(`/* workspaceClinicHours:deactivateAssistant */ UPDATE location_assistant_booking_hours SET active=FALSE, updated_at=NOW() WHERE location_id=$1 AND active=TRUE`, [location.id]);
      for (const day of desired) if (day.open) await client.query(`/* workspaceClinicHours:upsertAssistant */ INSERT INTO location_assistant_booking_hours(location_id,day_of_week,starts_local,ends_local,active) VALUES($1,$2,$3::time,$4::time,TRUE) ON CONFLICT(location_id,day_of_week,starts_local,ends_local) DO UPDATE SET active=TRUE,updated_at=NOW()`, [location.id, day.dayOfWeek, day.startsLocal, day.endsLocal]);
      const after = canonicalDays(await assistantRows(location.id, client, { lock: true }));
      await client.query(`/* workspaceClinicHours:assistantAudit */ INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,'workspace.assistant_hours_updated','location',$2,$3::jsonb)`, [authority.operatorAdminId, location.id, JSON.stringify({ before: auditProjection(before), after: auditProjection(after) })]);
      await client.query('COMMIT');
      return { status: 'updated', days: after, revision: revisionFor(location.id, after) };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw error; } finally { client.release(); }
  }

  async function updateHours({ adminId, expectedRevision, days } = {}) {
    const expected = requireExpectedRevision(expectedRevision);
    const desired = normalizeDayPayload(days);
    if (typeof db.connect !== 'function') throw new Error('Workspace Clinic hours database transaction support is required');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const authority = await requireAccess(adminId, client);
      const location = await requireLocation(client);
      const beforeDays = canonicalDays(await activeRows(location.id, client, { lock: true }));
      const currentRevision = revisionFor(location.id, beforeDays);
      if (currentRevision !== expected) {
        throw new WorkspaceClinicHoursError(
          'WORKSPACE_CLINIC_HOURS_STALE_REVISION',
          'Clinic hours changed since this page was loaded. Reload the current hours and try again.',
          409
        );
      }

      await client.query(
        `/* workspaceClinicHours:deactivateWritable */
         UPDATE location_working_hours
            SET active=FALSE,
                updated_at=NOW()
          WHERE location_id=$1
            AND day_of_week BETWEEN 1 AND 6
            AND active=TRUE`,
        [location.id]
      );

      for (const day of desired) {
        if (!day.open) continue;
        await client.query(
          `/* workspaceClinicHours:upsertWritable */
           INSERT INTO location_working_hours
             (location_id, day_of_week, starts_local, ends_local, active)
           VALUES ($1, $2, $3::time, $4::time, TRUE)
           ON CONFLICT (location_id, day_of_week, starts_local, ends_local)
           DO UPDATE SET active=TRUE, updated_at=NOW()`,
          [location.id, day.dayOfWeek, day.startsLocal, day.endsLocal]
        );
      }

      const afterDays = canonicalDays(await activeRows(location.id, client, { lock: true }));
      await client.query(
        `/* workspaceClinicHours:audit */
         INSERT INTO crm_audit_events
           (actor_admin_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'workspace.clinic_hours_updated', 'location', $2, $3::jsonb)`,
        [authority.operatorAdminId, location.id, JSON.stringify({ before: auditProjection(beforeDays), after: auditProjection(afterDays) })]
      );
      await client.query('COMMIT');
      return {
        status: 'updated',
        location: { id: positiveId(location.id), name: String(location.name || 'Shiloh') },
        days: afterDays,
        revision: revisionFor(location.id, afterDays),
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function upsertException({ adminId, exceptionDate, exceptionType, startsLocal, endsLocal } = {}) {
    const desired = normalizeExceptionPayload({ exceptionDate, exceptionType, startsLocal, endsLocal });
    const authority = await requireAccess(adminId);
    const location = await requireLocation();
    const write = await db.query(
      `/* workspaceClinicHours:upsertException */
       INSERT INTO location_hours_exceptions
         (location_id, exception_date, exception_type, starts_local, ends_local, actor_admin_id)
       VALUES ($1, $2::date, $3, $4::time, $5::time, $6)
       ON CONFLICT (location_id, exception_date)
       DO UPDATE SET exception_type=EXCLUDED.exception_type,
                     starts_local=EXCLUDED.starts_local,
                     ends_local=EXCLUDED.ends_local,
                     actor_admin_id=EXCLUDED.actor_admin_id,
                     updated_at=NOW()
       RETURNING id, exception_date, exception_type, starts_local, ends_local, actor_admin_id, updated_at`,
      [
        location.id,
        desired.exceptionDate,
        desired.exceptionType,
        desired.startsLocal,
        desired.endsLocal,
        authority.operatorAdminId,
      ]
    );
    const exception = canonicalExceptions(write.rows)[0];
    await db.query(
      `/* workspaceClinicHours:exceptionAudit */
       INSERT INTO crm_audit_events
         (actor_admin_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.holiday_hours_updated', 'location_hours_exception', $2, $3::jsonb)`,
      [
        authority.operatorAdminId,
        exception?.id,
        JSON.stringify({
          locationId: positiveId(location.id),
          exceptionDate: desired.exceptionDate,
          mode: desired.exceptionType,
          openTime: desired.startsLocal,
          closeTime: desired.endsLocal,
        }),
      ]
    );
    return {
      status: 'updated',
      location: { id: positiveId(location.id), name: String(location.name || 'Shiloh') },
      exception,
    };
  }

  async function upsertAssistantException({ adminId, exceptionDate, exceptionType, startsLocal, endsLocal } = {}) {
    const desired = normalizeExceptionPayload({ exceptionDate, exceptionType, startsLocal, endsLocal });
    const authority = await requireAccess(adminId);
    const location = await requireLocation();
    const clinic = await db.query(`SELECT exception_type,starts_local,ends_local FROM location_hours_exceptions WHERE location_id=$1 AND exception_date=$2::date LIMIT 1`, [location.id, desired.exceptionDate]);
    const boundary = clinic.rows[0];
    if (!boundary || boundary.exception_type === 'closed') throw new WorkspaceClinicHoursError('WORKSPACE_ASSISTANT_DATE_OUTSIDE_CLINIC', 'Open the clinic for this date before setting Shiloh Assistant hours.', 400);
    if (desired.exceptionType === 'open' && (desired.startsLocal < timeValue(boundary.starts_local) || desired.endsLocal > timeValue(boundary.ends_local))) throw new WorkspaceClinicHoursError('WORKSPACE_ASSISTANT_DATE_OUTSIDE_CLINIC', 'Shiloh Assistant special hours must stay within the clinic special hours.', 400);
    await db.query(`/* workspaceClinicHours:upsertAssistantException */ INSERT INTO location_assistant_hours_exceptions(location_id,exception_date,exception_type,starts_local,ends_local,actor_admin_id) VALUES($1,$2::date,$3,$4::time,$5::time,$6) ON CONFLICT(location_id,exception_date) DO UPDATE SET exception_type=EXCLUDED.exception_type,starts_local=EXCLUDED.starts_local,ends_local=EXCLUDED.ends_local,actor_admin_id=EXCLUDED.actor_admin_id,updated_at=NOW()`, [location.id, desired.exceptionDate, desired.exceptionType, desired.startsLocal, desired.endsLocal, authority.operatorAdminId]);
    return { status: 'updated' };
  }

  return { resolveAccess, buildModel, updateHours, updateAssistantHours, upsertException, upsertAssistantException };
}

const service = createWorkspaceClinicHoursService();

module.exports = {
  SCHEDULE_MANAGE_CAPABILITY,
  WRITABLE_DAYS,
  WorkspaceClinicHoursError,
  evaluateAuthority,
  normalizeDayPayload,
  normalizeExceptionPayload,
  canonicalDays,
  canonicalExceptions,
  canonicalHolidays,
  revisionFor,
  createWorkspaceClinicHoursService,
  resolveAccess: service.resolveAccess,
  buildModel: service.buildModel,
  updateHours: service.updateHours,
  updateAssistantHours: service.updateAssistantHours,
  upsertException: service.upsertException,
  upsertAssistantException: service.upsertAssistantException,
};
