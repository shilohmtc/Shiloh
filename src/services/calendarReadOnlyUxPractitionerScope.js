const { pool } = require('../db/pool');
const base = require('./calendarReadOnlyUx');
const { positiveId, normalizedRole } = require('./practitionerWorkspaceScope');

function reorderByStaffId(rows, staffId) {
  if (!Array.isArray(rows) || !staffId) return rows;
  const index = rows.findIndex(row => positiveId(row?.id) === staffId);
  if (index <= 0) return rows;
  return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)];
}

function reorderIds(ids, staffId) {
  if (!Array.isArray(ids) || !staffId) return ids;
  const normalized = ids.map(Number);
  const index = normalized.indexOf(staffId);
  if (index <= 0) return ids;
  return [ids[index], ...ids.slice(0, index), ...ids.slice(index + 1)];
}

function createCalendarReadOnlyUxPractitionerScopeService({ db = pool, service = base } = {}) {
  async function preferredPractitionerStaffId(operatorAdminId) {
    const adminId = positiveId(operatorAdminId);
    if (!adminId) return null;
    const result = await db.query(
      `/* practitionerWorkspaceScope:calendar-principal */
       SELECT a.id, a.staff_id, a.display_name, a.role, a.business_role,
              s.status AS staff_status, s.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [adminId],
    );
    if (result.rows.length !== 1) return null;
    const principal = result.rows[0];
    const linkedStaffId = positiveId(principal.staff_id);
    if (linkedStaffId
        && normalizedRole(principal.staff_status) === 'active'
        && normalizedRole(principal.staff_resource_type) === 'practitioner') {
      return linkedStaffId;
    }

    // Presentation-only fallback for a legitimate practitioner identity whose
    // Admin principal is not linked yet. Reception/non-practitioner roles never
    // use name matching, and ambiguity fails closed. This never grants access.
    const accountRole = normalizedRole(principal.role);
    if (!['practitioner', 'admin', 'owner'].includes(accountRole)) return null;
    const displayName = String(principal.display_name || '').trim();
    if (!displayName) return null;
    const match = await db.query(
      `/* practitionerWorkspaceScope:calendar-name-match */
       SELECT id
         FROM staff
        WHERE status='active'
          AND resource_type='practitioner'
          AND LOWER(TRIM(display_name))=LOWER(TRIM($1))
        ORDER BY id
        LIMIT 2`,
      [displayName],
    );
    return match.rows.length === 1 ? positiveId(match.rows[0].id) : null;
  }

  async function buildModel(input = {}) {
    const model = await service.buildModel(input);
    const preferredId = await preferredPractitionerStaffId(input.viewer?.operatorAdminId);
    if (!preferredId) return model;
    const permittedIds = new Set((model.permittedStaff || []).map(row => positiveId(row.id)).filter(Boolean));
    if (!permittedIds.has(preferredId)) return model;
    return {
      ...model,
      practitionerFirstStaffId: preferredId,
      permittedStaff: reorderByStaffId(model.permittedStaff, preferredId),
      visibleStaffIds: reorderIds(model.visibleStaffIds, preferredId),
      authorizedTimeline: model.authorizedTimeline
        ? { ...model.authorizedTimeline, staff: reorderByStaffId(model.authorizedTimeline.staff, preferredId) }
        : model.authorizedTimeline,
      timeline: model.timeline
        ? { ...model.timeline, staff: reorderByStaffId(model.timeline.staff, preferredId) }
        : model.timeline,
    };
  }

  return { buildModel, preferredPractitionerStaffId };
}

const scoped = createCalendarReadOnlyUxPractitionerScopeService();
module.exports = {
  reorderByStaffId,
  reorderIds,
  createCalendarReadOnlyUxPractitionerScopeService,
  ...scoped,
};
