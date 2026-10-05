const { pool } = require('../db/pool');
const schedulingEngine = require('./schedulingEngine');
const {
  filterTimelineForDisplay,
} = require('./calendarReadOnlyUx');

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';
const BUSINESS_UTC_OFFSET = '+02:00';
const APPOINTMENT_VIEW_CAPABILITY = 'appointment:view';
const MAX_REPORT_DAYS = 31;
const PRESETS = new Set(['today', 'week', '7d', '30d', 'month']);
const OWN_SCOPES = new Set(['own', 'own_services', 'own_appointments']);

class WorkspaceReportsError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceReportsError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function dateKeyFromDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateKey(value) {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new WorkspaceReportsError('WORKSPACE_REPORTS_INVALID_DATE', 'Report dates must use YYYY-MM-DD.', 400);
  }
  const parsed = new Date(`${key}T12:00:00${BUSINESS_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime()) || dateKeyFromDate(parsed) !== key) {
    throw new WorkspaceReportsError('WORKSPACE_REPORTS_INVALID_DATE', 'Report date is invalid.', 400);
  }
  return key;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00${BUSINESS_UTC_OFFSET}`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromDate(date);
}

function daysBetween(startKey, endExclusiveKey) {
  const start = new Date(`${startKey}T12:00:00${BUSINESS_UTC_OFFSET}`);
  const end = new Date(`${endExclusiveKey}T12:00:00${BUSINESS_UTC_OFFSET}`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function monthStart(dateKey) {
  return `${dateKey.slice(0, 8)}01`;
}

function resolvePeriod({ preset, from, to, now = new Date() } = {}) {
  const today = dateKeyFromDate(now);
  const requestedPreset = String(preset || '').trim().toLowerCase();
  let startKey;
  let endInclusiveKey;
  let effectivePreset = PRESETS.has(requestedPreset) ? requestedPreset : 'today';

  if (from != null || to != null) {
    if (!from || !to) {
      throw new WorkspaceReportsError(
        'WORKSPACE_REPORTS_INCOMPLETE_RANGE',
        'Both report start and end dates are required.',
        400,
      );
    }
    startKey = parseDateKey(from);
    endInclusiveKey = parseDateKey(to);
    effectivePreset = 'custom';
  } else if (effectivePreset === 'today') {
    startKey = today;
    endInclusiveKey = today;
  } else if (effectivePreset === 'week') {
    startKey = addDays(today, -((localWeekday(today) + 6) % 7));
    endInclusiveKey = today;
  } else if (effectivePreset === '30d') {
    startKey = addDays(today, -29);
    endInclusiveKey = today;
  } else if (effectivePreset === 'month') {
    startKey = monthStart(today);
    endInclusiveKey = today;
  } else {
    startKey = addDays(today, -6);
    endInclusiveKey = today;
  }

  const endKey = addDays(endInclusiveKey, 1);
  const dayCount = daysBetween(startKey, endKey);
  if (dayCount <= 0) {
    throw new WorkspaceReportsError('WORKSPACE_REPORTS_INVALID_RANGE', 'Report start must not be after report end.', 400);
  }
  if (dayCount > MAX_REPORT_DAYS) {
    throw new WorkspaceReportsError(
      'WORKSPACE_REPORTS_RANGE_TOO_LARGE',
      `Reports are limited to ${MAX_REPORT_DAYS} days.`,
      400,
    );
  }

  let previousEndKey = startKey;
  let previousStartKey = addDays(previousEndKey, -dayCount);
  if (effectivePreset === 'week') {
    previousStartKey = addDays(startKey, -7);
    previousEndKey = addDays(previousStartKey, dayCount);
  } else if (effectivePreset === 'month') {
    previousStartKey = monthStart(addDays(startKey, -1));
    const previousMonthDays = daysBetween(previousStartKey, startKey);
    previousEndKey = addDays(previousStartKey, Math.min(dayCount, previousMonthDays));
  }
  return {
    preset: effectivePreset,
    startKey,
    endInclusiveKey,
    endKey,
    dayCount,
    previousStartKey,
    previousEndKey,
    from: new Date(`${startKey}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString(),
    to: new Date(`${endKey}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString(),
    previousFrom: new Date(`${previousStartKey}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString(),
    previousTo: new Date(`${previousEndKey}T00:00:00${BUSINESS_UTC_OFFSET}`).toISOString(),
  };
}

function evaluateReportAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const principal = rows[0];
  const adminId = positiveId(principal.id);
  if (!adminId || principal.admin_active !== true) return null;
  const staffId = positiveId(principal.staff_id);
  if (staffId && principal.staff_status !== 'active') return null;
  if (permissionSet(principal.permissions)[APPOINTMENT_VIEW_CAPABILITY] !== true) return null;

  const scope = String(principal.calendar_scope || '').trim().toLowerCase();
  if (scope === 'all_business') {
    return {
      key: 'workspace_reports_business_v1',
      operatorAdminId: adminId,
      displayName: String(principal.display_name || 'Staff').trim() || 'Staff',
      reportScope: 'all_business',
      staffId: null,
      timelineViewer: { calendarScope: 'all_business' },
    };
  }
  if (OWN_SCOPES.has(scope) && staffId) {
    return {
      key: 'workspace_reports_own_v1',
      operatorAdminId: adminId,
      displayName: String(principal.display_name || 'Staff').trim() || 'Staff',
      reportScope: 'own_staff',
      staffId,
      timelineViewer: { calendarScope: 'own_appointments', staffId },
    };
  }
  return null;
}

function normalizeStaffFilter(value, authority) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw || raw === 'all') return authority.reportScope === 'own_staff' ? authority.staffId : null;
  if (!/^\d+$/.test(raw)) {
    throw new WorkspaceReportsError('WORKSPACE_REPORTS_INVALID_STAFF', 'Practitioner filter is invalid.', 400);
  }
  const staffId = positiveId(raw);
  if (!staffId) throw new WorkspaceReportsError('WORKSPACE_REPORTS_INVALID_STAFF', 'Practitioner filter is invalid.', 400);
  if (authority.reportScope === 'own_staff' && staffId !== authority.staffId) {
    throw new WorkspaceReportsError(
      'WORKSPACE_REPORTS_STAFF_FORBIDDEN',
      'That practitioner is outside the authenticated report scope.',
      403,
    );
  }
  return staffId;
}

function timeMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function intervalMinutes(start, end) {
  const a = timeMinutes(start);
  const b = timeMinutes(end);
  return a == null || b == null || b <= a ? 0 : b - a;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const a1 = timeMinutes(aStart);
  const a2 = timeMinutes(aEnd);
  const b1 = timeMinutes(bStart);
  const b2 = timeMinutes(bEnd);
  if ([a1, a2, b1, b2].some(value => value == null)) return 0;
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function localWeekday(dateKey) {
  return new Date(`${dateKey}T12:00:00${BUSINESS_UTC_OFFSET}`).getUTCDay();
}

function clipDurationMinutes(startsAt, endsAt, fromIso, toIso) {
  const start = Math.max(new Date(startsAt).getTime(), new Date(fromIso).getTime());
  const end = Math.min(new Date(endsAt).getTime(), new Date(toIso).getTime());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function closureApplies(closure, window) {
  if (closure.locationId == null) return true;
  if (window.locationId == null) return true;
  return Number(closure.locationId) === Number(window.locationId);
}

function effectiveDaySchedule({ staffId, dateKey, timeline }) {
  const weekday = localWeekday(dateKey);
  const baseWindows = (timeline.workingWindows || []).filter(
    item => Number(item.staffId) === staffId && Number(item.dayOfWeek) === weekday,
  );
  const exceptions = (timeline.scheduleExceptions || []).filter(
    item => Number(item.staffId) === staffId && String(item.date) === dateKey,
  );
  const available = exceptions.filter(
    item => item.exceptionType === 'available' && item.startsLocal && item.endsLocal,
  );
  const closures = (timeline.closures || []).filter(item => String(item.date) === dateKey);
  const windows = (available.length ? available.map(item => ({
    startsLocal: item.startsLocal,
    endsLocal: item.endsLocal,
    locationId: item.locationId || null,
  })) : baseWindows)
    .filter(window => !closures.some(closure => closureApplies(closure, window)));

  const grossMinutes = windows.reduce(
    (total, item) => total + intervalMinutes(item.startsLocal, item.endsLocal),
    0,
  );

  const unavailable = exceptions.filter(item => item.exceptionType === 'unavailable');
  const allDayUnavailable = unavailable.some(item => !item.startsLocal && !item.endsLocal);
  let leaveMinutes = 0;
  if (allDayUnavailable) {
    leaveMinutes = grossMinutes;
  } else {
    for (const item of unavailable) {
      if (!item.startsLocal || !item.endsLocal) continue;
      for (const window of windows) {
        leaveMinutes += overlapMinutes(
          window.startsLocal,
          window.endsLocal,
          item.startsLocal,
          item.endsLocal,
        );
      }
    }
    leaveMinutes = Math.min(grossMinutes, leaveMinutes);
  }

  return {
    grossMinutes,
    leaveMinutes,
    netMinutes: Math.max(0, grossMinutes - leaveMinutes),
  };
}

function uniqueAppointments(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serviceMix(appointments = []) {
  const services = new Map();
  for (const appointment of uniqueAppointments(appointments)) {
    const contexts = Array.isArray(appointment.serviceContexts) ? appointment.serviceContexts : [];
    if (contexts.length) {
      const used = new Set();
      for (const service of contexts) {
        const key = service.serviceId ? `id:${service.serviceId}` : `name:${String(service.serviceName || '').trim().toLowerCase()}`;
        if (used.has(key)) continue;
        used.add(key);
        const current = services.get(key) || {
          serviceId: service.serviceId || null,
          name: String(service.serviceName || 'Service').trim() || 'Service',
          category: String(service.categoryName || '').trim() || null,
          appointments: 0,
        };
        current.appointments += 1;
        services.set(key, current);
      }
      continue;
    }
    const name = String(appointment.serviceName || 'Appointment').trim() || 'Appointment';
    const key = `name:${name.toLowerCase()}`;
    const current = services.get(key) || { serviceId: null, name, category: null, appointments: 0 };
    current.appointments += 1;
    services.set(key, current);
  }
  return [...services.values()]
    .sort((a, b) => b.appointments - a.appointments || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function buildCapacity({ timeline, period }) {
  const rows = [];
  const appointments = uniqueAppointments(timeline.appointments || []);
  for (const person of timeline.staff || []) {
    const staffId = Number(person.id);
    if (!Number.isSafeInteger(staffId)) continue;
    let scheduledMinutes = 0;
    let leaveMinutes = 0;
    for (let index = 0; index < period.dayCount; index += 1) {
      const dateKey = addDays(period.startKey, index);
      const day = effectiveDaySchedule({ staffId, dateKey, timeline });
      scheduledMinutes += day.grossMinutes;
      leaveMinutes += day.leaveMinutes;
    }

    const bookedMinutes = appointments
      .filter(item => Array.isArray(item.staffIds) && item.staffIds.map(Number).includes(staffId))
      .reduce((total, item) => total + clipDurationMinutes(item.startsAt, item.endsAt, period.from, period.to), 0);

    const blockedMinutes = (timeline.blocks || [])
      .filter(item => Array.isArray(item.staffIds) && item.staffIds.map(Number).includes(staffId))
      .reduce((total, item) => total + clipDurationMinutes(item.startsAt, item.endsAt, period.from, period.to), 0);

    const netScheduledMinutes = Math.max(0, scheduledMinutes - leaveMinutes);
    const remainingMinutes = Math.max(0, netScheduledMinutes - bookedMinutes - blockedMinutes);
    const utilisationPct = netScheduledMinutes > 0
      ? Math.min(100, Math.round((bookedMinutes / netScheduledMinutes) * 100))
      : 0;

    rows.push({
      staffId,
      name: String(person.displayName || person.display_name || 'Practitioner').trim() || 'Practitioner',
      scheduledMinutes,
      netScheduledMinutes,
      bookedMinutes,
      blockedMinutes,
      leaveMinutes,
      remainingMinutes,
      utilisationPct,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function sumCapacity(rows = []) {
  const totals = rows.reduce((acc, row) => {
    acc.scheduledMinutes += row.scheduledMinutes;
    acc.netScheduledMinutes += row.netScheduledMinutes;
    acc.bookedMinutes += row.bookedMinutes;
    acc.blockedMinutes += row.blockedMinutes;
    acc.leaveMinutes += row.leaveMinutes;
    acc.remainingMinutes += row.remainingMinutes;
    return acc;
  }, {
    scheduledMinutes: 0,
    netScheduledMinutes: 0,
    bookedMinutes: 0,
    blockedMinutes: 0,
    leaveMinutes: 0,
    remainingMinutes: 0,
  });
  totals.utilisationPct = totals.netScheduledMinutes > 0
    ? Math.min(100, Math.round((totals.bookedMinutes / totals.netScheduledMinutes) * 100))
    : 0;
  return totals;
}

function normalizeStatusRows(rows = []) {
  const counts = {};
  for (const row of rows) {
    const status = String(row.status || 'unknown').trim().toLowerCase() || 'unknown';
    counts[status] = Number(row.count || 0);
  }
  return counts;
}

function statusTotal(counts = {}) {
  return Object.values(counts).reduce((total, value) => total + Number(value || 0), 0);
}

function nonCancelledTotal(counts = {}) {
  return Object.entries(counts).reduce(
    (total, [status, value]) => total + (status === 'cancelled' ? 0 : Number(value || 0)),
    0,
  );
}

function createWorkspaceReportsService({
  db = pool,
  listTimeline = schedulingEngine.listTimeline,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Reports database is required');
  if (typeof listTimeline !== 'function') throw new Error('Workspace Reports SchedulingTimeline is required');

  async function resolveAccess(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* WorkspaceReports:principal */
       SELECT a.id, a.staff_id, a.display_name, a.calendar_scope, a.permissions,
              a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id],
    );
    return evaluateReportAuthority(result.rows);
  }

  async function requireAccess(adminId) {
    const authority = await resolveAccess(adminId);
    if (!authority) {
      throw new WorkspaceReportsError(
        'WORKSPACE_REPORTS_FORBIDDEN',
        'Current staff authority does not permit operational reports.',
        403,
      );
    }
    return authority;
  }

  async function appointmentStatusCounts({ from, to, staffId }) {
    const result = await db.query(
      `/* WorkspaceReports:appointment_status */
       SELECT LOWER(COALESCE(a.status, 'unknown')) AS status, COUNT(*)::int AS count
         FROM appointments a
        WHERE a.starts_at >= $1::timestamptz
          AND a.starts_at < $2::timestamptz
          AND (
            $3::bigint IS NULL
            OR EXISTS (
              SELECT 1
                FROM appointment_staff ast_scope
               WHERE ast_scope.appointment_id=a.id
                 AND ast_scope.staff_id=$3
            )
          )
        GROUP BY LOWER(COALESCE(a.status, 'unknown'))
        ORDER BY status`,
      [from, to, staffId],
    );
    return normalizeStatusRows(result.rows);
  }

  async function clientSummary({ from, to, staffId }) {
    const result = await db.query(
      `/* WorkspaceReports:client_summary */
       WITH period_clients AS (
         SELECT DISTINCT a.client_id
           FROM appointments a
          WHERE a.starts_at >= $1::timestamptz
            AND a.starts_at < $2::timestamptz
            AND a.client_id IS NOT NULL
            AND a.status <> 'cancelled'
            AND (
              $3::bigint IS NULL
              OR EXISTS (
                SELECT 1
                  FROM appointment_staff ast_scope
                 WHERE ast_scope.appointment_id=a.id
                   AND ast_scope.staff_id=$3
              )
            )
       ),
       first_visit AS (
         SELECT a.client_id, MIN(a.starts_at) AS first_at
           FROM appointments a
           JOIN period_clients pc ON pc.client_id=a.client_id
          WHERE a.status <> 'cancelled'
          GROUP BY a.client_id
       )
       SELECT COUNT(*)::int AS unique_clients,
              COUNT(*) FILTER (WHERE first_at >= $1::timestamptz AND first_at < $2::timestamptz)::int AS new_clients,
              COUNT(*) FILTER (WHERE first_at < $1::timestamptz)::int AS returning_clients
         FROM first_visit`,
      [from, to, staffId],
    );
    const row = result.rows[0] || {};
    return {
      uniqueClients: Number(row.unique_clients || 0),
      newClients: Number(row.new_clients || 0),
      returningClients: Number(row.returning_clients || 0),
    };
  }

  async function buildReport({
    adminId,
    preset,
    from,
    to,
    staff,
    now = new Date(),
  } = {}) {
    const authority = await requireAccess(adminId);
    const period = resolvePeriod({ preset, from, to, now });
    const requestedStaffId = normalizeStaffFilter(staff, authority);

    const timeline = await listTimeline({
      from: period.from,
      to: period.to,
      viewer: authority.timelineViewer,
    });

    let filtered;
    try {
      filtered = filterTimelineForDisplay(timeline, requestedStaffId);
    } catch (error) {
      if (error?.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN') {
        throw new WorkspaceReportsError(
          'WORKSPACE_REPORTS_STAFF_FORBIDDEN',
          'That practitioner is outside the authenticated report scope.',
          403,
        );
      }
      throw error;
    }

    const effectiveTimeline = filtered.timeline;
    const effectiveStaffId = filtered.selectedStaffId != null
      ? filtered.selectedStaffId
      : authority.reportScope === 'own_staff'
        ? authority.staffId
        : null;

    const [statusCounts, previousStatusCounts, clients] = await Promise.all([
      appointmentStatusCounts({ from: period.from, to: period.to, staffId: effectiveStaffId }),
      appointmentStatusCounts({ from: period.previousFrom, to: period.previousTo, staffId: effectiveStaffId }),
      clientSummary({ from: period.from, to: period.to, staffId: effectiveStaffId }),
    ]);

    const capacity = buildCapacity({ timeline: effectiveTimeline, period });
    const totals = sumCapacity(capacity);
    const currentOperationalAppointments = nonCancelledTotal(statusCounts);
    const previousOperationalAppointments = nonCancelledTotal(previousStatusCounts);
    const trendDelta = currentOperationalAppointments - previousOperationalAppointments;
    const trendPct = previousOperationalAppointments > 0
      ? Math.round((trendDelta / previousOperationalAppointments) * 100)
      : currentOperationalAppointments > 0 ? 100 : 0;

    return {
      authority: {
        key: authority.key,
        displayName: authority.displayName,
        reportScope: authority.reportScope,
        staffId: authority.staffId,
      },
      period,
      selectedStaffId: filtered.selectedStaffId,
      permittedStaff: filtered.permittedStaff || [],
      appointments: {
        operational: uniqueAppointments(effectiveTimeline.appointments || []).length,
        allRecorded: statusTotal(statusCounts),
        statusCounts,
      },
      capacity,
      totals,
      services: serviceMix(effectiveTimeline.appointments || []),
      clients,
      closures: (effectiveTimeline.closures || []).length,
      trend: {
        currentOperationalAppointments,
        previousOperationalAppointments,
        delta: trendDelta,
        percent: trendPct,
      },
      readOnly: true,
      timezone: BUSINESS_TIMEZONE,
    };
  }

  return {
    resolveAccess,
    requireAccess,
    appointmentStatusCounts,
    clientSummary,
    buildReport,
  };
}

const service = createWorkspaceReportsService();

module.exports = {
  BUSINESS_TIMEZONE,
  APPOINTMENT_VIEW_CAPABILITY,
  MAX_REPORT_DAYS,
  PRESETS,
  WorkspaceReportsError,
  positiveId,
  evaluateReportAuthority,
  resolvePeriod,
  normalizeStaffFilter,
  intervalMinutes,
  overlapMinutes,
  clipDurationMinutes,
  effectiveDaySchedule,
  buildCapacity,
  sumCapacity,
  serviceMix,
  normalizeStatusRows,
  nonCancelledTotal,
  createWorkspaceReportsService,
  ...service,
};
