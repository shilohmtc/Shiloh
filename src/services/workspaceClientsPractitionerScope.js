const { pool } = require('../db/pool');
const base = require('./workspaceClients');
const { isOrdinaryPractitioner, positiveId } = require('./practitionerWorkspaceScope');

function createWorkspaceClientsPractitionerScopeService({ db = pool, service = base } = {}) {
  async function ordinaryPractitioner(adminId) {
    const id = positiveId(adminId);
    if (!id) return false;
    const result = await db.query(
      `/* practitionerWorkspaceScope:clients-principal */
       SELECT a.id, a.staff_id, a.business_role, a.active AS admin_active,
              s.status AS staff_status, s.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id],
    );
    return result.rows.length === 1 && isOrdinaryPractitioner(result.rows[0]);
  }

  async function decorateModel(adminId, model) {
    const ordinary = await ordinaryPractitioner(adminId);
    return {
      ...model,
      practitionerScoped: ordinary,
      archiveAllowed: model?.manageAllowed === true && !ordinary,
    };
  }

  async function listClients(input = {}) {
    return decorateModel(input.adminId, await service.listClients(input));
  }

  async function getClientDetail(input = {}) {
    return decorateModel(input.adminId, await service.getClientDetail(input));
  }

  return {
    ...service,
    listClients,
    getClientDetail,
  };
}

const scoped = createWorkspaceClientsPractitionerScopeService();
module.exports = {
  createWorkspaceClientsPractitionerScopeService,
  ...scoped,
};
