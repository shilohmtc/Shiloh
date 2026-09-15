const { pool } = require('../db/pool');
const base = require('./workspaceReports');
const { isOrdinaryPractitioner, positiveId } = require('./practitionerWorkspaceScope');

function createWorkspaceReportsPractitionerScopeService({ db = pool, service = base } = {}) {
  async function principal(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* practitionerWorkspaceScope:reports-principal */
       SELECT a.id, a.staff_id, a.business_role, a.active AS admin_active,
              s.status AS staff_status, s.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id],
    );
    return result.rows.length === 1 ? result.rows[0] : null;
  }

  async function buildReport(input = {}) {
    const row = await principal(input.adminId);
    if (!isOrdinaryPractitioner(row)) return service.buildReport(input);
    const staffId = positiveId(row.staff_id);
    const model = await service.buildReport({ ...input, staff: String(staffId) });
    return {
      ...model,
      authority: {
        ...(model.authority || {}),
        key: 'workspace_reports_practitioner_scope_v1',
        reportScope: 'own_staff',
        staffId,
      },
      selectedStaffId: staffId,
      permittedStaff: (model.permittedStaff || []).filter(person => positiveId(person.id) === staffId),
      practitionerScoped: true,
    };
  }

  return {
    ...service,
    buildReport,
  };
}

const scoped = createWorkspaceReportsPractitionerScopeService();
module.exports = {
  createWorkspaceReportsPractitionerScopeService,
  ...scoped,
};
