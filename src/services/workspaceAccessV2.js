const { createHash } = require('crypto');
const { pool } = require('../db/pool');
const workspaceStaffAccess = require('./workspaceStaffAccess');
const {
  WorkspaceStaffError,
  positiveId,
  permissionSet,
  requireRequestId,
  requireExpectedRevision,
} = require('./workspaceStaff');
const {
  RECEPTION_DISPLAY_NAME,
  RECEPTION_PRESET: RECEPTION_ACCESS_PRESET,
  expectedPermissions: receptionPermissions,
  isExactReceptionPrincipal,
  createWorkspaceReceptionAccessService,
} = require('./workspaceReceptionAccess');

const ACCESS_V2_LOCK_BASE = 788000000000;
const PRACTITIONER_PRESET_KEY = 'employee_practitioner_v1';
const RECEPTION_PRESET_KEY = 'reception_shared_operational_v1';
const PRACTITIONER_COPY_CAPABILITIES = Object.freeze(['appointment:view', 'booking:update', 'forms:view', 'forms:clinical_manage']);
const PRACTITIONER_COPY_CAPABILITY_SET = new Set(PRACTITIONER_COPY_CAPABILITIES);

const CAPABILITY_GROUPS = Object.freeze([
  Object.freeze({ key: 'calendar', label: 'Calendar', capabilities: Object.freeze([
    'appointment:view', 'appointment:create', 'appointment:record_past', 'appointment:adjust_end',
    'booking:update', 'calendar:booking:reschedule', 'calendar:booking:cancel', 'calendar:booking:reassign',
  ]) }),
  Object.freeze({ key: 'clients', label: 'Clients', capabilities: Object.freeze(['client:lookup', 'client:manage', 'client:delete']) }),
  Object.freeze({ key: 'messages', label: 'Messages', capabilities: Object.freeze(['client:notify']) }),
  Object.freeze({ key: 'forms', label: 'Forms', capabilities: Object.freeze(['forms:view', 'forms:clinical_manage']) }),
  Object.freeze({ key: 'services', label: 'Services', capabilities: Object.freeze(['services:view', 'services:create', 'services:manage', 'staff:services:view']) }),
  Object.freeze({ key: 'schedule', label: 'Clinic schedule & hours', capabilities: Object.freeze(['schedule:manage']) }),
  Object.freeze({ key: 'staff', label: 'Staff', capabilities: Object.freeze(['staff:view', 'staff:manage']) }),
  Object.freeze({ key: 'access', label: 'Access', capabilities: Object.freeze(['staff_access:manage']) }),
  Object.freeze({ key: 'reports_finance', label: 'Reports & finance', capabilities: Object.freeze(['service:pricing']) }),
  Object.freeze({ key: 'security', label: 'Security', capabilities: Object.freeze(['staff_auth:reset']) }),
  Object.freeze({ key: 'other', label: 'Other operational access', capabilities: Object.freeze(['walkin:create', 'loyalty:redeem', 'overflow:visible']) }),
]);

function enabledCapabilities(value) {
  const permissions = permissionSet(value);
  return Object.keys(permissions).filter(key => permissions[key] === true).sort();
}

function stablePermissions(value) {
  const source = permissionSet(value);
  return Object.fromEntries(Object.keys(source).sort().map(key => [key, source[key]]));
}

function principalRevision(row) {
  if (!row) return null;
  return createHash('sha256').update(JSON.stringify({
    id: positiveId(row.id),
    staffId: positiveId(row.staff_id),
    active: row.active === true,
    role: String(row.role || ''),
    businessRole: String(row.business_role || ''),
    calendarScope: String(row.calendar_scope || ''),
    serviceScope: String(row.service_scope || ''),
    permissions: stablePermissions(row.permissions),
  })).digest('hex');
}

function practitionerShape(row, staff) {
  if (!row || !staff || staff.status !== 'active'
      || staff.resource_type !== 'practitioner' || staff.business_role !== 'employee_practitioner'
      || positiveId(row.staff_id) !== positiveId(staff.id)
      || row.role !== 'practitioner' || row.business_role !== 'employee_practitioner'
      || row.calendar_scope !== 'own_appointments' || row.service_scope !== 'own_services') return false;
  const capabilities = enabledCapabilities(row.permissions);
  return ['appointment:view', 'forms:view', 'forms:clinical_manage'].every(key => capabilities.includes(key))
    && capabilities.every(key => PRACTITIONER_COPY_CAPABILITY_SET.has(key));
}

function practitionerCompatible(row, staff) {
  return row?.active === true && practitionerShape(row, staff);
}

function isReceptionIdentity(row) {
  return Boolean(row) && row.staff_id == null
    && String(row.display_name || '').trim().toLowerCase() === RECEPTION_DISPLAY_NAME.toLowerCase();
}

function isReceptionPreset(row) {
  return isExactReceptionPrincipal(row ? { ...row, active: true } : row);
}

function presetFor(row, staff) {
  if (isReceptionPreset(row)) return { key: RECEPTION_PRESET_KEY, label: 'Reception', status: 'current' };
  if (isReceptionIdentity(row)) return { key: RECEPTION_PRESET_KEY, label: 'Reception', status: 'needs_review' };
  if (practitionerShape(row, staff)) return { key: PRACTITIONER_PRESET_KEY, label: 'Practitioner', status: 'current' };
  const role = String(row?.business_role || 'Custom').replace(/_/g, ' ');
  return { key: null, label: role.charAt(0).toUpperCase() + role.slice(1), status: 'read_only' };
}

function groupedCapabilities(permissions) {
  const enabled = new Set(enabledCapabilities(permissions));
  const known = new Set(CAPABILITY_GROUPS.flatMap(group => group.capabilities));
  const groups = CAPABILITY_GROUPS.map(group => ({
    key: group.key,
    label: group.label,
    capabilities: group.capabilities.filter(key => enabled.has(key)),
  })).filter(group => group.capabilities.length);
  const unknown = [...enabled].filter(key => !known.has(key));
  if (unknown.length) groups.push({ key: 'advanced', label: 'Additional protected access', capabilities: unknown });
  return groups;
}

function principalProjection(row) {
  const staff = row?.staff_id == null ? null : {
    id: positiveId(row.staff_id),
    displayName: String(row.staff_display_name || row.display_name || ''),
    status: row.staff_status || null,
    resourceType: row.staff_resource_type || null,
    businessRole: row.staff_business_role || null,
  };
  const ambiguousLink = Boolean(staff && Number(row.linked_count) > 1);
  const preset = ambiguousLink ? { key: null, label: 'Needs review', status: 'needs_review' } : presetFor(row, staff && {
    id: staff.id, status: staff.status, resource_type: staff.resourceType, business_role: staff.businessRole,
  });
  return {
    id: positiveId(row.id),
    displayName: String(row.display_name || 'Workspace principal'),
    active: row.active === true,
    principalType: staff ? 'staff_linked' : 'shared_or_other',
    principalLabel: staff ? `Staff-linked${ambiguousLink ? ' · ambiguous' : ''}` : (isReceptionIdentity(row) ? 'Shared operational principal' : 'Other Workspace principal'),
    staff,
    role: String(row.role || ''),
    businessRole: String(row.business_role || ''),
    calendarScope: String(row.calendar_scope || ''),
    serviceScope: String(row.service_scope || ''),
    preset,
    ambiguousLink,
    capabilities: enabledCapabilities(row.permissions),
    capabilityGroups: groupedCapabilities(row.permissions),
    revision: principalRevision(row),
    practitionerCompatible: practitionerCompatible(row, staff && {
      id: staff.id, status: staff.status, resource_type: staff.resourceType, business_role: staff.businessRole,
    }),
    practitionerLifecycleAllowed: practitionerShape(row, staff && {
      id: staff.id, status: staff.status, resource_type: staff.resourceType, business_role: staff.businessRole,
    }),
    receptionIdentity: isReceptionIdentity(row),
    receptionLifecycleAllowed: isReceptionPreset(row),
  };
}

function accessState(projection) {
  return {
    active: projection.active,
    preset: projection.preset,
    role: projection.role,
    businessRole: projection.businessRole,
    calendarScope: projection.calendarScope,
    serviceScope: projection.serviceScope,
    capabilities: projection.capabilities,
  };
}

function createWorkspaceAccessV2Service({ db = pool, accessService = workspaceStaffAccess } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Access V2 database is required');
  const receptionAccessService = createWorkspaceReceptionAccessService({ db, staffAccessService: accessService });

  function principalSql({ lock = false } = {}) {
    return `/* workspaceAccessV2:principal */
      SELECT a.id,a.staff_id,a.display_name,a.role,a.active,a.permissions,a.business_role,a.calendar_scope,a.service_scope,
             CASE WHEN a.staff_id IS NULL THEN 1 ELSE COUNT(*) OVER(PARTITION BY a.staff_id) END AS linked_count,
             s.display_name AS staff_display_name,s.status AS staff_status,s.resource_type AS staff_resource_type,
             s.business_role AS staff_business_role
        FROM staff_admin_accounts a
        LEFT JOIN staff s ON s.id=a.staff_id
       WHERE a.id=$1
       ${lock ? 'FOR UPDATE OF a' : ''}`;
  }

  async function loadPrincipal(id, queryable = db, options = {}) {
    const result = await queryable.query(principalSql(options), [id]);
    return result.rows[0] || null;
  }

  async function requireUnambiguous(row, queryable) {
    if (!row) throw new WorkspaceStaffError('WORKSPACE_ACCESS_NOT_FOUND', 'Workspace access principal was not found.', 404);
    if (row.staff_id != null) {
      const duplicate = await queryable.query(
        `/* workspaceAccessV2:linked-count */ SELECT id FROM staff_admin_accounts WHERE staff_id=$1 ORDER BY id LIMIT 2`,
        [row.staff_id]
      );
      if (duplicate.rows.length !== 1) throw new WorkspaceStaffError('WORKSPACE_ACCESS_AMBIGUOUS', 'Staff-linked Workspace access is ambiguous and must be reconciled.', 409);
    }
    if (isReceptionIdentity(row)) {
      const duplicate = await queryable.query(
        `/* workspaceAccessV2:reception-count */ SELECT id FROM staff_admin_accounts WHERE LOWER(TRIM(display_name))=LOWER(TRIM($1)) ORDER BY id LIMIT 2`,
        [RECEPTION_DISPLAY_NAME]
      );
      if (duplicate.rows.length !== 1) throw new WorkspaceStaffError('WORKSPACE_ACCESS_AMBIGUOUS', 'Shiloh Reception access is ambiguous and must be reconciled.', 409);
    }
  }

  async function listPrincipals({ adminId } = {}) {
    const operator = await accessService.requireManageAccess(adminId, db);
    const result = await db.query(`/* workspaceAccessV2:list */
      SELECT a.id,a.staff_id,a.display_name,a.role,a.active,a.permissions,a.business_role,a.calendar_scope,a.service_scope,
             s.display_name AS staff_display_name,s.status AS staff_status,s.resource_type AS staff_resource_type,
             s.business_role AS staff_business_role
        FROM staff_admin_accounts a
        LEFT JOIN staff s ON s.id=a.staff_id
       ORDER BY CASE WHEN a.staff_id IS NOT NULL THEN 0 ELSE 1 END,CASE WHEN a.active THEN 0 ELSE 1 END,LOWER(a.display_name),a.id`);
    const principals = result.rows.map(principalProjection);
    return {
      authority: operator,
      staffLinked: principals.filter(item => item.principalType === 'staff_linked'),
      sharedOrOther: principals.filter(item => item.principalType === 'shared_or_other'),
      receptionPresent: principals.some(item => item.receptionIdentity),
    };
  }

  async function getPrincipal({ adminId, principalId } = {}) {
    await accessService.requireManageAccess(adminId, db);
    const id = positiveId(principalId);
    if (!id) throw new WorkspaceStaffError('WORKSPACE_ACCESS_INVALID_ID', 'Workspace access reference is invalid.', 400);
    const row = await loadPrincipal(id);
    await requireUnambiguous(row, db);
    const principal = principalProjection(row);
    const sources = principal.staff && principal.staff.status === 'active' && principal.staff.businessRole === 'employee_practitioner'
      ? (await db.query(`/* workspaceAccessV2:copy-sources */
          SELECT a.id,a.staff_id,a.display_name,a.role,a.active,a.permissions,a.business_role,a.calendar_scope,a.service_scope,
                 COUNT(*) OVER(PARTITION BY a.staff_id) AS linked_count,
                 s.display_name AS staff_display_name,s.status AS staff_status,s.resource_type AS staff_resource_type,
                 s.business_role AS staff_business_role
            FROM staff_admin_accounts a JOIN staff s ON s.id=a.staff_id
           WHERE a.id<>$1 AND a.active=TRUE AND s.status='active' AND s.resource_type='practitioner'
             AND s.business_role='employee_practitioner' AND a.role='practitioner'
             AND a.business_role='employee_practitioner' AND a.calendar_scope='own_appointments' AND a.service_scope='own_services'
           ORDER BY LOWER(s.display_name),a.id`, [id])).rows.filter(row => Number(row.linked_count) === 1).map(principalProjection).filter(item => item.practitionerCompatible)
      : [];
    return { principal, copySources: sources };
  }

  async function audit(client, operator, action, target, metadata) {
    await client.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES($1,$2,'staff_admin_account',$3,$4::jsonb)`,
      [operator.operatorAdminId, action, target.id, JSON.stringify(metadata)]
    );
  }

  async function inMutation({ adminId, principalId, expectedRevision, requestId, execute }) {
    if (typeof db.connect !== 'function') throw new Error('Workspace Access V2 mutations require a transactional database');
    const id = positiveId(principalId);
    if (!id) throw new WorkspaceStaffError('WORKSPACE_ACCESS_INVALID_ID', 'Workspace access reference is invalid.', 400);
    const expected = requireExpectedRevision(expectedRevision);
    const safeRequestId = requireRequestId(requestId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await accessService.requireManageAccess(adminId, client);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [ACCESS_V2_LOCK_BASE + id]);
      const row = await loadPrincipal(id, client, { lock: true });
      await requireUnambiguous(row, client);
      if (positiveId(row.id) === positiveId(operator.operatorAdminId)) throw new WorkspaceStaffError('WORKSPACE_ACCESS_SELF_CHANGE_FORBIDDEN', 'You cannot change your own Workspace authority.', 409);
      if (principalRevision(row) !== expected) throw new WorkspaceStaffError('WORKSPACE_ACCESS_STALE', 'Workspace access changed. Reload before saving.', 409);
      const result = await execute({ client, operator, row, requestId: safeRequestId });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  function requirePractitionerTarget(row) {
    if (!row.staff_id || row.staff_status !== 'active' || row.staff_resource_type !== 'practitioner'
        || row.staff_business_role !== 'employee_practitioner') {
      throw new WorkspaceStaffError('WORKSPACE_ACCESS_PRACTITIONER_UNSUPPORTED', 'Practitioner access requires one active employee-practitioner Staff link.', 409);
    }
  }

  async function applyPreset({ adminId, principalId, expectedRevision, requestId, preset } = {}) {
    if (![PRACTITIONER_PRESET_KEY, RECEPTION_PRESET_KEY].includes(preset)) {
      throw new WorkspaceStaffError('WORKSPACE_ACCESS_PRESET_FORBIDDEN', 'Choose a supported Workspace access preset.', 400);
    }
    return inMutation({ adminId, principalId, expectedRevision, requestId, execute: async ({ client, operator, row, requestId: safeRequestId }) => {
      const before = accessState(principalProjection(row));
      let config;
      if (preset === PRACTITIONER_PRESET_KEY) {
        requirePractitionerTarget(row);
        config = { role: 'practitioner', businessRole: 'employee_practitioner', calendarScope: 'own_appointments', serviceScope: 'own_services', permissions: { 'appointment:view': true, 'forms:view': true, 'forms:clinical_manage': true } };
      } else {
        if (!isReceptionIdentity(row)) throw new WorkspaceStaffError('WORKSPACE_ACCESS_RECEPTION_TARGET_INVALID', 'The Reception preset is reserved for the canonical Shiloh Reception principal.', 409);
        config = { role: RECEPTION_ACCESS_PRESET.role, businessRole: RECEPTION_ACCESS_PRESET.businessRole, calendarScope: RECEPTION_ACCESS_PRESET.calendarScope, serviceScope: RECEPTION_ACCESS_PRESET.serviceScope, permissions: receptionPermissions() };
      }
      const afterRow = { ...row, role: config.role, business_role: config.businessRole, calendar_scope: config.calendarScope, service_scope: config.serviceScope, permissions: config.permissions };
      const after = accessState(principalProjection(afterRow));
      if (JSON.stringify(before) === JSON.stringify(after)) {
        return { status: 'unchanged', principal: principalProjection(afterRow) };
      }
      await client.query(`UPDATE staff_admin_accounts SET role=$2,business_role=$3,calendar_scope=$4,service_scope=$5,permissions=$6::jsonb,updated_at=NOW() WHERE id=$1`,
        [row.id, config.role, config.businessRole, config.calendarScope, config.serviceScope, JSON.stringify(config.permissions)]);
      await audit(client, operator, 'workspace.access_preset_applied', row, { requestId: safeRequestId, preset, before, after, identityChanged: false, credentialMaterialChanged: false });
      return { status: 'updated', principal: principalProjection(afterRow) };
    }});
  }

  async function previewCopy({ adminId, principalId, sourcePrincipalId, expectedRevision, expectedSourceRevision } = {}) {
    await accessService.requireManageAccess(adminId, db);
    const targetId = positiveId(principalId);
    const sourceId = positiveId(sourcePrincipalId);
    if (!targetId || !sourceId || targetId === sourceId) throw new WorkspaceStaffError('WORKSPACE_ACCESS_COPY_INVALID', 'Choose a different compatible practitioner source.', 400);
    const [target, source] = await Promise.all([loadPrincipal(targetId), loadPrincipal(sourceId)]);
    await requireUnambiguous(target, db); await requireUnambiguous(source, db);
    if (principalRevision(target) !== requireExpectedRevision(expectedRevision)
        || principalRevision(source) !== requireExpectedRevision(expectedSourceRevision)) {
      throw new WorkspaceStaffError('WORKSPACE_ACCESS_STALE', 'Source or target access changed. Reload before previewing.', 409);
    }
    requirePractitionerTarget(target);
    const sourceProjection = principalProjection(source);
    if (!sourceProjection.practitionerCompatible) throw new WorkspaceStaffError('WORKSPACE_ACCESS_COPY_SOURCE_UNSUPPORTED', 'Only a compatible active practitioner can be copied.', 409);
    const targetProjection = principalProjection(target);
    return {
      source: { id: sourceProjection.id, displayName: sourceProjection.displayName, revision: sourceProjection.revision },
      target: { id: targetProjection.id, displayName: targetProjection.displayName, revision: targetProjection.revision },
      before: accessState(targetProjection),
      after: {
        active: targetProjection.active,
        preset: { key: PRACTITIONER_PRESET_KEY, label: 'Practitioner', status: 'current' },
        role: sourceProjection.role,
        businessRole: sourceProjection.businessRole,
        calendarScope: sourceProjection.calendarScope,
        serviceScope: sourceProjection.serviceScope,
        capabilities: sourceProjection.capabilities,
      },
      identityCopied: false,
      credentialsCopied: false,
    };
  }

  async function copyAccess(input = {}) {
    if (typeof db.connect !== 'function') throw new Error('Workspace Access V2 mutations require a transactional database');
    const targetId = positiveId(input.principalId);
    const sourceId = positiveId(input.sourcePrincipalId);
    if (!targetId || !sourceId || targetId === sourceId) throw new WorkspaceStaffError('WORKSPACE_ACCESS_COPY_INVALID', 'Choose a different compatible practitioner source.', 400);
    const expectedTarget = requireExpectedRevision(input.expectedRevision);
    const expectedSource = requireExpectedRevision(input.expectedSourceRevision);
    const requestId = requireRequestId(input.requestId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await accessService.requireManageAccess(input.adminId, client);
      for (const id of [targetId, sourceId].sort((a, b) => a - b)) {
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [ACCESS_V2_LOCK_BASE + id]);
      }
      const firstId = Math.min(targetId, sourceId);
      const secondId = Math.max(targetId, sourceId);
      const first = await loadPrincipal(firstId, client, { lock: true });
      const second = await loadPrincipal(secondId, client, { lock: true });
      const row = targetId === firstId ? first : second;
      const source = sourceId === firstId ? first : second;
      await requireUnambiguous(row, client); await requireUnambiguous(source, client);
      if (positiveId(row.id) === positiveId(operator.operatorAdminId)) throw new WorkspaceStaffError('WORKSPACE_ACCESS_SELF_CHANGE_FORBIDDEN', 'You cannot change your own Workspace authority.', 409);
      if (principalRevision(row) !== expectedTarget || principalRevision(source) !== expectedSource) {
        throw new WorkspaceStaffError('WORKSPACE_ACCESS_STALE', 'Source or target access changed after preview. Nothing was copied.', 409);
      }
      const sourceProjection = principalProjection(source);
      if (!sourceProjection.practitionerCompatible) throw new WorkspaceStaffError('WORKSPACE_ACCESS_COPY_SOURCE_UNSUPPORTED', 'The source is no longer a compatible practitioner.', 409);
      requirePractitionerTarget(row);
      const targetProjection = principalProjection(row);
      const before = accessState(targetProjection);
      const copiedPermissions = Object.fromEntries(sourceProjection.capabilities.map(key => [key, true]));
      const afterRow = { ...row, role: source.role, business_role: source.business_role, calendar_scope: source.calendar_scope, service_scope: source.service_scope, permissions: copiedPermissions };
      const after = accessState(principalProjection(afterRow));
      if (JSON.stringify(before) === JSON.stringify(after)) {
        await client.query('COMMIT');
        return { status: 'unchanged', principal: principalProjection(afterRow) };
      }
      await client.query(`UPDATE staff_admin_accounts SET role=$2,business_role=$3,calendar_scope=$4,service_scope=$5,permissions=$6::jsonb,updated_at=NOW() WHERE id=$1`,
        [row.id, source.role, source.business_role, source.calendar_scope, source.service_scope, JSON.stringify(copiedPermissions)]);
      await audit(client, operator, 'workspace.access_copied', row, { requestId, sourcePrincipalId: sourceId, sourceStaffId: positiveId(source.staff_id), targetStaffId: positiveId(row.staff_id), before, after, identityChanged: false, credentialMaterialChanged: false });
      await client.query('COMMIT');
      return { status: 'updated', principal: principalProjection(afterRow) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  async function setActive({ adminId, principalId, expectedRevision, requestId, active } = {}) {
    if (typeof active !== 'boolean') throw new WorkspaceStaffError('WORKSPACE_ACCESS_STATUS_INVALID', 'Choose enabled or disabled Workspace access.', 400);
    return inMutation({ adminId, principalId, expectedRevision, requestId, execute: async ({ client, operator, row, requestId: safeRequestId }) => {
      const staff = row.staff_id ? { id: row.staff_id, status: row.staff_status, resource_type: row.staff_resource_type, business_role: row.staff_business_role } : null;
      if (!(practitionerShape(row, staff) || isReceptionPreset(row))) {
        throw new WorkspaceStaffError('WORKSPACE_ACCESS_STATUS_PROTECTED', 'This protected access principal is view only in Access V2.', 409);
      }
      if (active && row.staff_id && row.staff_status !== 'active') throw new WorkspaceStaffError('WORKSPACE_ACCESS_STAFF_INACTIVE', 'Reactivate the canonical Staff profile before enabling its Workspace access.', 409);
      if (row.active === active) return { status: 'unchanged', principal: principalProjection(row) };
      const before = accessState(principalProjection(row));
      await client.query('UPDATE staff_admin_accounts SET active=$2,updated_at=NOW() WHERE id=$1', [row.id, active]);
      const afterRow = { ...row, active };
      const after = accessState(principalProjection(afterRow));
      await audit(client, operator, active ? 'workspace.access_enabled' : 'workspace.access_disabled', row, { requestId: safeRequestId, before, after, identityChanged: false, credentialMaterialChanged: false });
      return { status: active ? 'enabled' : 'disabled', principal: principalProjection(afterRow) };
    }});
  }

  async function createReception({ adminId, requestId, whatsappNumber, identityConfirmed } = {}) {
    return receptionAccessService.createReceptionPrincipal({ adminId, requestId, whatsappNumber, identityConfirmed });
  }

  return { listPrincipals, getPrincipal, applyPreset, previewCopy, copyAccess, setActive, createReception };
}

const service = createWorkspaceAccessV2Service();

module.exports = {
  ACCESS_V2_LOCK_BASE,
  PRACTITIONER_PRESET_KEY,
  RECEPTION_PRESET_KEY,
  PRACTITIONER_COPY_CAPABILITIES,
  CAPABILITY_GROUPS,
  enabledCapabilities,
  stablePermissions,
  principalRevision,
  practitionerShape,
  practitionerCompatible,
  presetFor,
  groupedCapabilities,
  principalProjection,
  accessState,
  createWorkspaceAccessV2Service,
  ...service,
};
