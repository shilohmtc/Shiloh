const { pool } = require('../db/pool');
const base = require('./workspaceClientMutations');
const { isOrdinaryPractitioner, positiveId } = require('./practitionerWorkspaceScope');

function createWorkspaceClientMutationsPractitionerScopeService({ db = pool, service = base } = {}) {
  async function requireNonPractitionerArchive(adminId) {
    const id = positiveId(adminId);
    if (!id) {
      throw new base.WorkspaceClientMutationError(
        'WORKSPACE_CLIENT_MANAGE_FORBIDDEN',
        'Current staff authority does not permit client changes.',
        403,
      );
    }
    const result = await db.query(
      `/* practitionerWorkspaceScope:client-archive-principal */
       SELECT a.id, a.staff_id, a.business_role, a.active AS admin_active,
              s.status AS staff_status, s.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id],
    );
    if (result.rows.length === 1 && isOrdinaryPractitioner(result.rows[0])) {
      throw new base.WorkspaceClientMutationError(
        'WORKSPACE_CLIENT_ARCHIVE_FORBIDDEN',
        'Practitioner scope permits client create and profile updates, not archive or delete authority.',
        403,
      );
    }
  }

  async function archiveClient(input = {}) {
    await requireNonPractitionerArchive(input.adminId);
    return service.archiveClient(input);
  }

  return {
    ...service,
    archiveClient,
  };
}

const scoped = createWorkspaceClientMutationsPractitionerScopeService();
module.exports = {
  createWorkspaceClientMutationsPractitionerScopeService,
  ...scoped,
};
