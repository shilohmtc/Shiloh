const { pool } = require('../db/pool');
const crmReadService = require('./crmReadService');
const { createWorkspaceCommunicationEvidenceService } = require('./workspaceCommunicationEvidence');
const { evaluateClientManageAuthority, clientRelationshipRevision } = require('./workspaceClientMutations');
const { scopeForPrincipal, validClientScope } = require('./clientRelationshipScope');

const CLIENT_LOOKUP_CAPABILITY = 'client:lookup';
const CLIENT_LIST_PAGE_SIZE = 24;
const CLIENT_HISTORY_PAGE_SIZE = 20;

class WorkspaceClientsError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceClientsError';
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

function evaluateClientReadAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const principal = rows[0];
  const adminId = positiveId(principal.id);
  if (!adminId || principal.admin_active !== true) return null;
  if (principal.staff_id != null && principal.staff_status !== 'active') return null;
  if (permissionSet(principal.permissions)[CLIENT_LOOKUP_CAPABILITY] !== true) return null;
  const clientScope = scopeForPrincipal(principal);
  if (!validClientScope(clientScope)) return null;
  return {
    key: 'workspace_client_lookup_v2',
    operatorAdminId: adminId,
    displayName: String(principal.display_name || 'Staff').trim() || 'Staff',
    capability: CLIENT_LOOKUP_CAPABILITY,
    businessRole: String(principal.business_role || '').trim().toLowerCase(),
    linkedStaffId: positiveId(principal.staff_id),
    clientScope,
  };
}

function normalizeStatus(value) {
  const status = String(value || 'active').trim().toLowerCase();
  if (status === 'all') return null;
  if (status === 'active' || status === 'archived') return status;
  throw new WorkspaceClientsError('WORKSPACE_CLIENTS_INVALID_STATUS', 'Client status filter is invalid.', 400);
}

function normalizeSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeOffset(value) {
  const offset = Number.parseInt(value, 10);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(offset, 100000);
}

function createWorkspaceClientsService({ db = pool, readService = crmReadService, communicationService = null } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Clients database is required');
  const communicationReads = communicationService || createWorkspaceCommunicationEvidenceService({ db });

  async function resolveAccess(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* workspaceClients:principal */
       SELECT a.id, a.staff_id, a.display_name, a.permissions, a.business_role,
              a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    const authority = evaluateClientReadAuthority(result.rows);
    if (!authority) return null;
    return { ...authority, manageAllowed: Boolean(evaluateClientManageAuthority(result.rows)) };
  }

  async function requireAccess(adminId) {
    const authority = await resolveAccess(adminId);
    if (!authority) {
      throw new WorkspaceClientsError(
        'WORKSPACE_CLIENTS_FORBIDDEN',
        'Current staff authority does not permit client lookup.',
        403
      );
    }
    return authority;
  }

  async function listClients({ adminId, q, status, offset } = {}) {
    const authority = await requireAccess(adminId);
    const manageAllowed = authority.manageAllowed === true;
    const safeOffset = normalizeOffset(offset);
    const safeQuery = normalizeSearch(q);
    const safeStatus = normalizeStatus(status);
    const clients = await readService.listClients({
      q: safeQuery,
      status: safeStatus,
      limit: CLIENT_LIST_PAGE_SIZE + 1,
      offset: safeOffset,
      scope: authority.clientScope,
    });
    return {
      authority,
      manageAllowed,
      clients: clients.slice(0, CLIENT_LIST_PAGE_SIZE),
      hasMore: clients.length > CLIENT_LIST_PAGE_SIZE,
      offset: safeOffset,
      pageSize: CLIENT_LIST_PAGE_SIZE,
      query: safeQuery,
      status: safeStatus,
    };
  }

  async function getClientDetail({ adminId, clientId, historyOffset } = {}) {
    const authority = await requireAccess(adminId);
    const manageAllowed = authority.manageAllowed === true;
    const id = positiveId(clientId);
    if (!id) throw new WorkspaceClientsError('WORKSPACE_CLIENTS_INVALID_ID', 'Client reference is invalid.', 400);

    // Relationship scope is applied before profile/history/communication reads.
    // A crafted direct URL for another client base therefore resolves as 404.
    const client = await readService.getClient(id, { scope: authority.clientScope });
    if (!client) throw new WorkspaceClientsError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);

    const revisionResult = await db.query(
      `/* workspaceClients:revision */
       SELECT id,name,normalized_mobile,date_of_birth,gender,profile_status,
              mobile_verified_at,source,status,created_at,updated_at
         FROM crm_v2_clients
        WHERE id=$1
        LIMIT 1`,
      [id]
    );
    if (!revisionResult.rows[0]) throw new WorkspaceClientsError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
    client.revision = clientRelationshipRevision(revisionResult.rows[0], client.status);

    const safeOffset = normalizeOffset(historyOffset);
    const history = await readService.getClientAppointments(id, {
      limit: CLIENT_HISTORY_PAGE_SIZE + 1,
      offset: safeOffset,
      scope: authority.clientScope,
    });
    let communications = [];
    let communicationsUnavailable = false;
    try {
      communications = await communicationReads.listForClient({
        clientId: client.id,
        waId: client.normalized_mobile,
        limit: 30,
        scope: authority.clientScope,
      });
    } catch (_) {
      communicationsUnavailable = true;
    }
    return {
      authority,
      manageAllowed,
      client,
      appointments: history.slice(0, CLIENT_HISTORY_PAGE_SIZE),
      hasMore: history.length > CLIENT_HISTORY_PAGE_SIZE,
      historyOffset: safeOffset,
      pageSize: CLIENT_HISTORY_PAGE_SIZE,
      communications,
      communicationsUnavailable,
    };
  }

  return { resolveAccess, requireAccess, listClients, getClientDetail };
}

const service = createWorkspaceClientsService();

module.exports = {
  CLIENT_LOOKUP_CAPABILITY,
  CLIENT_LIST_PAGE_SIZE,
  CLIENT_HISTORY_PAGE_SIZE,
  WorkspaceClientsError,
  positiveId,
  evaluateClientReadAuthority,
  normalizeStatus,
  normalizeSearch,
  normalizeOffset,
  createWorkspaceClientsService,
  ...service,
};
