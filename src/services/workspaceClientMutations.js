const crypto = require('crypto');
const { pool } = require('../db/pool');
const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');
const {
  createCrmV2ClientService,
  CrmV2Error,
  normalizeMobile,
  normalizeName,
  normalizeDateOfBirth,
  normalizeGender,
} = require('./crmV2ClientService');
const {
  CLIENT_RELATIONSHIP_TYPES,
  scopeForPrincipal,
  validClientScope,
} = require('./clientRelationshipScope');

const CLIENT_MANAGE_CAPABILITY = 'client:manage';
const ORIGIN = 'workspace.clients';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/i;
const EVENT_TYPES = Object.freeze({ create: 'workspace_client_created', update: 'workspace_client_updated', archive: 'workspace_client_archived' });

class WorkspaceClientMutationError extends Error {
  constructor(code, message, httpStatus) { super(message); this.name = 'WorkspaceClientMutationError'; this.code = code; this.httpStatus = httpStatus; }
}

function positiveId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function permissionSet(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function evaluateClientManageAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const p = rows[0]; const adminId = positiveId(p.id);
  if (!adminId || p.admin_active !== true) return null;
  if (p.staff_id != null && p.staff_status !== 'active') return null;
  if (permissionSet(p.permissions)[CLIENT_MANAGE_CAPABILITY] !== true) return null;
  const clientScope = scopeForPrincipal(p);
  if (!validClientScope(clientScope)) return null;
  return {
    key: 'workspace_client_manage_v2',
    operatorAdminId: adminId,
    displayName: String(p.display_name || 'Staff').trim() || 'Staff',
    capability: CLIENT_MANAGE_CAPABILITY,
    businessRole: String(p.business_role || '').trim().toLowerCase(),
    linkedStaffId: positiveId(p.staff_id),
    clientScope,
  };
}
function requireRequestId(value) {
  const requestId = String(value || '').trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_INVALID_REQUEST', 'A valid operation request identifier is required.', 400);
  return requestId;
}
function requireExpectedRevision(value) {
  const revision = String(value || '').trim().toLowerCase();
  if (!REVISION_PATTERN.test(revision)) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_INVALID_REVISION', 'Reload this client before retrying.', 400);
  return revision;
}
function iso(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toISOString(); }
function field(row, snake, camel) { return row?.[snake] !== undefined ? row[snake] : row?.[camel]; }
function clientRevision(row) {
  if (!row) return null;
  const canonical = {
    id: String(field(row, 'id', 'id') || ''), name: String(field(row, 'name', 'name') || ''),
    normalizedMobile: String(field(row, 'normalized_mobile', 'normalizedMobile') || ''),
    dateOfBirth: field(row, 'date_of_birth', 'dateOfBirth') ? String(field(row, 'date_of_birth', 'dateOfBirth')).slice(0, 10) : null,
    gender: field(row, 'gender', 'gender') || null, profileStatus: String(field(row, 'profile_status', 'profileStatus') || ''),
    mobileVerifiedAt: iso(field(row, 'mobile_verified_at', 'mobileVerifiedAt')), source: String(field(row, 'source', 'source') || ''),
    status: String(field(row, 'status', 'status') || ''), updatedAt: iso(field(row, 'updated_at', 'updatedAt')),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
function clientRelationshipRevision(row, relationshipStatus) {
  const canonicalRevision = clientRevision(row);
  if (!canonicalRevision) return null;
  return crypto.createHash('sha256').update(JSON.stringify({
    canonicalRevision,
    relationshipStatus: String(relationshipStatus || ''),
  })).digest('hex');
}
function mobileIdentityEvidence(value) {
  const normalized = normalizeMobile(value); if (!normalized) return null;
  return crypto.createHash('sha256').update(`workspace.clients.mobile:v1:${normalized}`).digest('hex');
}
function mutationFingerprint(operation, payload) { return crypto.createHash('sha256').update(JSON.stringify({ operation, ...payload })).digest('hex'); }
function normalizeRequestedProfile({ name, mobile, dateOfBirth, gender } = {}) {
  const cleanName = normalizeName(name);
  const normalizedMobile = normalizeMobile(mobile);
  if (!cleanName) throw new CrmV2Error('CRM_V2_INVALID_NAME', 'Enter a valid client name.');
  if (!normalizedMobile) throw new CrmV2Error('CRM_V2_INVALID_MOBILE', 'Enter a valid South African mobile number.');
  return {
    name: cleanName,
    normalizedMobile,
    dateOfBirth: normalizeDateOfBirth(dateOfBirth),
    gender: normalizeGender(gender),
  };
}
function sameClientProfile(row, requested) {
  if (!row || !requested) return false;
  const currentDob = field(row, 'date_of_birth', 'dateOfBirth') ? String(field(row, 'date_of_birth', 'dateOfBirth')).slice(0, 10) : null;
  return String(field(row, 'name', 'name') || '') === requested.name
    && String(field(row, 'normalized_mobile', 'normalizedMobile') || '') === requested.normalizedMobile
    && currentDob === requested.dateOfBirth
    && (field(row, 'gender', 'gender') || null) === requested.gender;
}
function normalizeError(error) {
  if (error instanceof WorkspaceClientMutationError) return error;
  if (error instanceof CrmV2Error) return new WorkspaceClientMutationError(error.code, error.message, error.httpStatus || 400);
  return error;
}

function createWorkspaceClientMutationService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace client mutations database is required');
  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId); if (!id) return [];
    const result = await queryable.query(
      `SELECT a.id,a.staff_id,a.display_name,a.permissions,a.business_role,
              a.active AS admin_active,s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }
  async function resolveManageAccess(adminId, queryable = db) { return evaluateClientManageAuthority(await principalRows(adminId, queryable)); }
  async function requireManageAccess(adminId, queryable = db) {
    const authority = await resolveManageAccess(adminId, queryable);
    if (!authority) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_MANAGE_FORBIDDEN', 'Current staff authority does not permit client changes.', 403);
    return authority;
  }
  async function relationshipRow(queryable, clientId, scope, { forUpdate = false } = {}) {
    if (!validClientScope(scope)) return null;
    const values = [positiveId(clientId)];
    const where = ['client_id=$1'];
    if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
      values.push(positiveId(scope.ownerStaffId));
      where.push("relationship_type='tenant_staff'", `owner_staff_id=$${values.length}`);
    } else {
      where.push("relationship_type='clinic'", 'owner_staff_id IS NULL');
    }
    const result = await queryable.query(
      `/* workspaceClientMutations:relationship */
       SELECT id,client_id,relationship_type,owner_staff_id,status,source,created_at,updated_at
         FROM crm_v2_client_relationships
        WHERE ${where.join(' AND ')}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      values
    );
    return result.rows[0] || null;
  }
  async function requireRelationship(queryable, clientId, scope, options = {}) {
    const relationship = await relationshipRow(queryable, clientId, scope, options);
    if (!relationship) {
      throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
    }
    return relationship;
  }
  async function activateRelationship(queryable, clientId, scope, source) {
    const id = positiveId(clientId);
    if (!id || !validClientScope(scope)) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_RELATIONSHIP_INVALID', 'Client relationship could not be established.', 409);
    if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
      const result = await queryable.query(
        `INSERT INTO crm_v2_client_relationships
           (client_id,relationship_type,owner_staff_id,status,source)
         VALUES($1,'tenant_staff',$2,'active',$3)
         ON CONFLICT (client_id,owner_staff_id) WHERE relationship_type='tenant_staff'
         DO UPDATE SET status='active',source=EXCLUDED.source,updated_at=NOW()
         RETURNING id,status`,
        [id, positiveId(scope.ownerStaffId), source]
      );
      return result.rows[0];
    }
    const result = await queryable.query(
      `INSERT INTO crm_v2_client_relationships
         (client_id,relationship_type,owner_staff_id,status,source)
       VALUES($1,'clinic',NULL,'active',$2)
       ON CONFLICT (client_id) WHERE relationship_type='clinic'
       DO UPDATE SET status='active',source=EXCLUDED.source,updated_at=NOW()
       RETURNING id,status`,
      [id, source]
    );
    return result.rows[0];
  }
  async function lockRequest(client, adminId, requestId) { await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workspace-client-request:${adminId}:${requestId}`]); }
  async function priorReplay(client, adminId, requestId) {
    const result = await client.query(`SELECT metadata FROM staff_auth_security_events WHERE operator_admin_id=$1 AND event_type IN ('workspace_client_created','workspace_client_updated','workspace_client_archived') AND metadata->>'origin'=$2 AND metadata->>'requestId'=$3 ORDER BY id DESC LIMIT 1`, [adminId, ORIGIN, requestId]);
    return result.rows[0]?.metadata || null;
  }
  function replayResultOrThrow(metadata, fingerprint) {
    if (!metadata) return null;
    if (String(metadata.payloadHash || '') !== fingerprint) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_REPLAY_MISMATCH', 'This operation identifier was already used for a different client change.', 409);
    const result = metadata.result;
    if (!result || !positiveId(result.clientId) || !REVISION_PATTERN.test(String(result.revision || ''))) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_REPLAY_STATE_INVALID', 'The prior client operation cannot be replayed safely.', 409);
    return { ...result, replayed: true };
  }
  async function audit(client, operator, eventType, metadata) {
    await client.query(`INSERT INTO staff_auth_security_events(event_type,operator_admin_id,subject_admin_id,auth_method,reason,request_fingerprint_hash,metadata) VALUES($1,$2,NULL,NULL,NULL,NULL,$3::jsonb)`, [eventType, operator.operatorAdminId, JSON.stringify(metadata)]);
  }
  async function inTransaction({ adminId, requestId: rawRequestId, operation, fingerprintPayload, execute }) {
    if (typeof db.connect !== 'function') throw new Error('Workspace client mutations require a transactional database.');
    const requestId = requireRequestId(rawRequestId); const fingerprint = mutationFingerprint(operation, fingerprintPayload); const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const operator = await requireManageAccess(adminId, client); await lockRequest(client, operator.operatorAdminId, requestId);
      const replay = replayResultOrThrow(await priorReplay(client, operator.operatorAdminId, requestId), fingerprint);
      if (replay) { await client.query('COMMIT'); return replay; }
      const repository = new PostgresCrmV2ClientRepository(client); const crm = createCrmV2ClientService({ repository });
      const executed = await execute({ client, repository, crm, operator });
      const result = { status: executed.status, clientId: positiveId(executed.clientId), revision: executed.revision };
      await audit(client, operator, EVENT_TYPES[operation], {
        origin: ORIGIN,
        requestId,
        payloadHash: fingerprint,
        relationshipType: operator.clientScope.kind,
        ownerStaffId: operator.clientScope.ownerStaffId,
        beforeRevision: executed.beforeRevision || null,
        afterRevision: executed.revision,
        changes: executed.auditChanges || {},
        result,
      });
      await client.query('COMMIT'); return { ...result, replayed: false };
    } catch (error) { try { await client.query('ROLLBACK'); } catch (_) {} throw normalizeError(error); } finally { client.release(); }
  }
  async function createClient({ adminId, requestId, name, mobile } = {}) {
    return inTransaction({
      adminId,
      requestId,
      operation: 'create',
      fingerprintPayload: { name: String(name ?? ''), mobile: String(mobile ?? '') },
      execute: async ({ client, crm, repository, operator }) => {
        const created = await crm.createClient({ name, mobile, actorReference: `workspace_admin:${operator.operatorAdminId}` });
        if (created.status === 'conflict') throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_MOBILE_CONFLICT', 'That mobile number could not be linked safely.', 409);
        if (!['created', 'existing'].includes(created.status) || !created.client) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_CREATE_FAILED', 'Client creation did not complete safely.', 409);
        const canonicalId = positiveId(created.client.id);
        await activateRelationship(client, canonicalId, operator.clientScope, 'workspace_client_add');
        const current = await repository.getClientById(canonicalId, { forUpdate: true });
        if (!current) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_CREATE_FAILED', 'Client creation did not complete safely.', 409);
        const revision = clientRelationshipRevision(current, 'active');
        return {
          status: created.status === 'created' ? 'created' : 'linked',
          clientId: canonicalId,
          revision,
          auditChanges: {
            fields: created.status === 'created' ? ['name', 'mobile', 'relationship'] : ['relationship'],
            existingCanonicalIdentity: created.status === 'existing',
            mobile: created.status === 'created' ? { before: null, after: mobileIdentityEvidence(created.client.normalizedMobile) } : null,
            mobileVerificationReset: false,
          },
        };
      },
    });
  }
  async function updateClient({ adminId, clientId, expectedRevision, requestId, name, mobile, dateOfBirth, gender } = {}) {
    const id = positiveId(clientId); if (!id) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_INVALID_ID', 'Client reference is invalid.', 400); const expected = requireExpectedRevision(expectedRevision);
    return inTransaction({ adminId, requestId, operation: 'update', fingerprintPayload: { clientId: id, expectedRevision: expected, name: String(name ?? ''), mobile: String(mobile ?? ''), dateOfBirth: dateOfBirth == null ? '' : String(dateOfBirth), gender: gender == null ? '' : String(gender) }, execute: async ({ client, repository, crm, operator }) => {
      const relationship = await requireRelationship(client, id, operator.clientScope, { forUpdate: true });
      if (relationship.status !== 'active') throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_RELATIONSHIP_ARCHIVED', 'This client is no longer active in your client list.', 409);
      const current = await repository.getClientById(id, { forUpdate: true }); if (!current) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
      const beforeRevision = clientRelationshipRevision(current, relationship.status); if (beforeRevision !== expected) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_STALE_REVISION', 'This client changed. Reload Clients before retrying.', 409);
      const requested = normalizeRequestedProfile({ name, mobile, dateOfBirth, gender });
      if (sameClientProfile(current, requested)) {
        return { status: 'unchanged', clientId: id, beforeRevision, revision: beforeRevision, auditChanges: { fields: [], mobile: null, mobileVerificationReset: false } };
      }
      const updated = await crm.updateClient({ clientId: id, name: requested.name, mobile: requested.normalizedMobile, dateOfBirth: requested.dateOfBirth, gender: requested.gender, actorReference: `workspace_admin:${operator.operatorAdminId}` });
      if (updated.status === 'conflict') throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_MOBILE_CONFLICT', 'Another active client owns that mobile number.', 409);
      if (updated.status !== 'updated' || !updated.client) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_UPDATE_FAILED', 'Client update did not complete safely.', 409);
      const changedFields = []; if (String(current.name || '') !== String(updated.client.name || '')) changedFields.push('name'); if (String(current.normalized_mobile || '') !== String(updated.client.normalizedMobile || '')) changedFields.push('mobile');
      const currentDob = current.date_of_birth ? String(current.date_of_birth).slice(0,10) : null; if (currentDob !== updated.client.dateOfBirth) changedFields.push('dateOfBirth'); if ((current.gender || null) !== (updated.client.gender || null)) changedFields.push('gender');
      const mobileChanged = changedFields.includes('mobile');
      return { status: changedFields.length ? 'updated' : 'unchanged', clientId: id, beforeRevision, revision: clientRelationshipRevision(updated.client, 'active'), auditChanges: { fields: changedFields, mobile: mobileChanged ? { before: mobileIdentityEvidence(current.normalized_mobile), after: mobileIdentityEvidence(updated.client.normalizedMobile) } : null, mobileVerificationReset: mobileChanged && current.mobile_verified_at != null && updated.client.mobileVerifiedAt == null } };
    }});
  }
  async function archiveClient({ adminId, clientId, expectedRevision, requestId } = {}) {
    const id = positiveId(clientId); if (!id) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_INVALID_ID', 'Client reference is invalid.', 400); const expected = requireExpectedRevision(expectedRevision);
    return inTransaction({ adminId, requestId, operation: 'archive', fingerprintPayload: { clientId: id, expectedRevision: expected }, execute: async ({ client, repository, operator }) => {
      const relationship = await requireRelationship(client, id, operator.clientScope, { forUpdate: true });
      const current = await repository.getClientById(id, { forUpdate: true }); if (!current) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_NOT_FOUND', 'Client was not found.', 404);
      const beforeRevision = clientRelationshipRevision(current, relationship.status); if (beforeRevision !== expected) throw new WorkspaceClientMutationError('WORKSPACE_CLIENT_STALE_REVISION', 'This client changed. Reload Clients before retrying.', 409);
      if (relationship.status === 'archived') return { status: 'unchanged', clientId: id, beforeRevision, revision: beforeRevision, auditChanges: { fields: [], relationshipArchive: { before: 'archived', after: 'archived' } } };
      await client.query(
        `UPDATE crm_v2_client_relationships
            SET status='archived',updated_at=NOW()
          WHERE id=$1`,
        [relationship.id]
      );
      return {
        status: 'archived',
        clientId: id,
        beforeRevision,
        revision: clientRelationshipRevision(current, 'archived'),
        auditChanges: {
          fields: ['relationshipStatus'],
          relationshipArchive: { before: relationship.status, after: 'archived' },
          canonicalClientPreserved: true,
          otherRelationshipsPreserved: true,
          appointmentHistoryPreserved: true,
          hardDelete: false,
        },
      };
    }});
  }
  return { resolveManageAccess, requireManageAccess, createClient, updateClient, archiveClient, relationshipRow };
}

const service = createWorkspaceClientMutationService();
module.exports = {
  CLIENT_MANAGE_CAPABILITY,
  ORIGIN,
  EVENT_TYPES,
  WorkspaceClientMutationError,
  positiveId,
  permissionSet,
  evaluateClientManageAuthority,
  requireRequestId,
  requireExpectedRevision,
  clientRevision,
  clientRelationshipRevision,
  mobileIdentityEvidence,
  mutationFingerprint,
  normalizeRequestedProfile,
  sameClientProfile,
  createWorkspaceClientMutationService,
  ...service,
};
