const { createHash } = require('crypto');
const { pool } = require('../db/pool');
const workspaceStaffAccess = require('./workspaceStaffAccess');

const PROFILE_CLINIC_TEAM = 'clinic_team_v1';
const PROFILE_OWN_WORKSPACE = 'own_workspace_v1';

const CLINIC_TEAM_VIEW = Object.freeze([
  'appointment:view',
  'client:lookup',
  'services:view',
  'staff:services:view',
  'staff:view',
  'reports:view_all',
  'schedule:view',
  'forms:view',
  'forms:clinical_manage',
]);
const CLINIC_TEAM_ACTIONS = Object.freeze(['booking:update']);
const CLINIC_TEAM_DENIED = Object.freeze([
  'appointment:create',
  'appointment:record_past',
  'appointment:adjust_end',
  'calendar:booking:reschedule',
  'calendar:booking:cancel',
  'calendar:booking:reassign',
  'client:manage',
  'client:delete',
  'client:notify',
  'services:create',
  'services:manage',
  'service:pricing',
  'schedule:availability_manage',
  'schedule:manage',
  'staff:manage',
  'staff_access:manage',
  'staff_auth:reset',
]);

const OWN_WORKSPACE_VIEW = Object.freeze([
  'appointment:view',
  'client:lookup',
  'services:view',
  'staff:services:view',
  'schedule:view',
  'forms:view',
  'forms:clinical_manage',
]);
const OWN_WORKSPACE_ACTIONS = Object.freeze([
  'appointment:create',
  'appointment:adjust_end',
  'booking:update',
  'calendar:booking:reschedule',
  'calendar:booking:cancel',
  'client:manage',
  'services:manage',
  'service:pricing',
  'schedule:availability_manage',
]);
const OWN_WORKSPACE_DENIED = Object.freeze([
  'appointment:record_past',
  'calendar:booking:reassign',
  'client:delete',
  'client:notify',
  'services:create',
  'schedule:manage',
  'staff:view',
  'staff:manage',
  'staff_access:manage',
  'staff_auth:reset',
]);

const TOGGLES = Object.freeze({
  [PROFILE_CLINIC_TEAM]: Object.freeze([
    Object.freeze({ key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Lets this team member finish only appointments that belong to them.', capabilities: Object.freeze(['booking:update']) }),
  ]),
  [PROFILE_OWN_WORKSPACE]: Object.freeze([
    Object.freeze({ key: 'manage_own_appointments', label: 'Manage my appointments', description: 'Create, reschedule, cancel and adjust only appointments inside this workspace boundary.', capabilities: Object.freeze(['appointment:create', 'appointment:adjust_end', 'calendar:booking:reschedule', 'calendar:booking:cancel']) }),
    Object.freeze({ key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Finish only appointments assigned to this practitioner.', capabilities: Object.freeze(['booking:update']) }),
    Object.freeze({ key: 'manage_my_clients', label: 'Manage my clients', description: 'Add and update this practitioner’s own client relationships.', capabilities: Object.freeze(['client:manage']) }),
    Object.freeze({ key: 'manage_my_services', label: 'Manage my services', description: 'Manage only services assigned and permitted to this practitioner.', capabilities: Object.freeze(['services:manage', 'service:pricing']) }),
    Object.freeze({ key: 'manage_my_availability', label: 'Manage my availability', description: 'Block time or add leave for this practitioner only. Clinic Hours stay protected.', capabilities: Object.freeze(['schedule:availability_manage']) }),
    Object.freeze({ key: 'view_clinic_hours', label: 'View clinic hours', description: 'See clinic and booking hours without permission to change them.', capabilities: Object.freeze(['schedule:view']) }),
  ]),
});

const PROFILE_META = Object.freeze({
  [PROFILE_CLINIC_TEAM]: Object.freeze({
    label: 'Clinic team',
    summary: 'Can see the clinic Workspace and finish their own visits. Clinic-wide management stays protected.',
    protected: Object.freeze([
      'Cannot change Clinic Hours.',
      'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
      'Cannot change client, service or staff records.',
    ]),
  }),
  [PROFILE_OWN_WORKSPACE]: Object.freeze({
    label: 'Own workspace',
    summary: 'Can fully manage their own work while clinic-wide records and other practitioners stay protected.',
    protected: Object.freeze([
      'Cannot change Clinic Hours.',
      'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
      'Cannot access clinic-only client relationships.',
      'Cannot create services or change staff/access settings.',
    ]),
  }),
});

class WorkspaceStaffAccessProfileError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceStaffAccessProfileError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stablePermissions(value) {
  const source = permissions(value);
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, source[key]]));
}

function revision(row) {
  return createHash('sha256').update(JSON.stringify({
    id: positiveId(row?.id),
    staffId: positiveId(row?.staff_id),
    active: row?.active === true,
    businessRole: String(row?.business_role || ''),
    calendarScope: String(row?.calendar_scope || ''),
    serviceScope: String(row?.service_scope || ''),
    permissions: stablePermissions(row?.permissions),
  })).digest('hex');
}

function profileFor(row) {
  const role = String(row?.business_role || '').trim().toLowerCase();
  if (role === 'tenant_practitioner' && positiveId(row?.staff_id)) return PROFILE_OWN_WORKSPACE;
  if (role === 'employee_practitioner' && positiveId(row?.staff_id)) return PROFILE_CLINIC_TEAM;
  return null;
}

function toggleProjection(row, profileKey) {
  const enabled = permissions(row?.permissions);
  return (TOGGLES[profileKey] || []).map((toggle) => ({
    ...toggle,
    on: toggle.capabilities.every((capability) => enabled[capability] === true),
  }));
}

function project(row) {
  const profileKey = profileFor(row);
  const meta = profileKey ? PROFILE_META[profileKey] : null;
  return {
    id: positiveId(row?.id),
    staffId: positiveId(row?.staff_id),
    displayName: String(row?.staff_display_name || row?.display_name || 'Staff').trim() || 'Staff',
    active: row?.active === true,
    profileKey,
    profileLabel: meta?.label || 'Protected access',
    profileSummary: meta?.summary || 'This access is managed separately.',
    protectedRestrictions: meta?.protected || [],
    toggles: profileKey ? toggleProjection(row, profileKey) : [],
    editable: Boolean(profileKey),
    revision: revision(row),
  };
}

function exactRevision(value) {
  const input = String(value || '').trim();
  if (!/^[a-f0-9]{64}$/.test(input)) {
    throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_STALE', 'Reload Staff access before saving.', 409);
  }
  return input;
}

function requestId(value) {
  const input = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input)) {
    throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_INVALID_REQUEST', 'A valid Staff access request is required.', 400);
  }
  return input;
}

function setCapabilities(current, add = [], remove = []) {
  const next = { ...permissions(current) };
  for (const capability of remove) delete next[capability];
  for (const capability of add) next[capability] = true;
  return next;
}

function canonicalProfileConfig(profileKey, current = {}) {
  if (profileKey === PROFILE_CLINIC_TEAM) {
    return {
      businessRole: 'employee_practitioner',
      calendarScope: 'own_appointments',
      serviceScope: 'own_services',
      permissions: setCapabilities({}, [...CLINIC_TEAM_VIEW, ...CLINIC_TEAM_ACTIONS], CLINIC_TEAM_DENIED),
    };
  }
  if (profileKey === PROFILE_OWN_WORKSPACE) {
    return {
      businessRole: 'tenant_practitioner',
      calendarScope: 'own_appointments',
      serviceScope: 'own_services',
      permissions: setCapabilities({}, [...OWN_WORKSPACE_VIEW, ...OWN_WORKSPACE_ACTIONS], OWN_WORKSPACE_DENIED),
    };
  }
  throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_PROFILE_UNSUPPORTED', 'This Staff access profile is protected.', 409);
}

function safeTogglePermissions(row, profileKey, toggleKey, on) {
  const toggle = (TOGGLES[profileKey] || []).find((item) => item.key === toggleKey);
  if (!toggle) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_TOGGLE_UNSUPPORTED', 'That Staff access switch is not available for this profile.', 400);
  const denied = profileKey === PROFILE_CLINIC_TEAM ? CLINIC_TEAM_DENIED : OWN_WORKSPACE_DENIED;
  const baseline = profileKey === PROFILE_CLINIC_TEAM ? CLINIC_TEAM_VIEW : OWN_WORKSPACE_VIEW;
  let next = setCapabilities(row.permissions, baseline, denied);
  next = setCapabilities(next, on ? toggle.capabilities : [], on ? [] : toggle.capabilities);
  return next;
}

function createWorkspaceStaffAccessProfilesService({ db = pool, accessService = workspaceStaffAccess } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Staff access profiles database is required');

  const principalSql = (lock = false) => `/* workspaceStaffAccessProfiles:principal */
    SELECT a.id,a.staff_id,a.display_name,a.active,a.permissions,a.business_role,a.calendar_scope,a.service_scope,
           s.display_name AS staff_display_name,s.status AS staff_status,s.resource_type AS staff_resource_type,s.business_role AS staff_business_role
      FROM staff_admin_accounts a
      LEFT JOIN staff s ON s.id=a.staff_id
     WHERE a.id=$1
     ${lock ? 'FOR UPDATE OF a' : ''}`;

  async function load(id, queryable = db, lock = false) {
    const result = await queryable.query(principalSql(lock), [id]);
    return result.rows[0] || null;
  }

  async function requireTarget(id, queryable = db, lock = false) {
    const row = await load(id, queryable, lock);
    if (!row) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_NOT_FOUND', 'Staff access was not found.', 404);
    if (!positiveId(row.staff_id) || row.staff_status !== 'active') {
      throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_TARGET_PROTECTED', 'This access is not an active staff workspace.', 409);
    }
    return row;
  }

  async function list({ adminId } = {}) {
    const authority = await accessService.requireManageAccess(adminId, db);
    const result = await db.query(`/* workspaceStaffAccessProfiles:list */
      SELECT a.id,a.staff_id,a.display_name,a.active,a.permissions,a.business_role,a.calendar_scope,a.service_scope,
             s.display_name AS staff_display_name,s.status AS staff_status,s.resource_type AS staff_resource_type,s.business_role AS staff_business_role
        FROM staff_admin_accounts a
        JOIN staff s ON s.id=a.staff_id
       WHERE s.status='active'
       ORDER BY LOWER(s.display_name),a.id`);
    return { authority, people: result.rows.map(project) };
  }

  async function get({ adminId, principalId } = {}) {
    const authority = await accessService.requireManageAccess(adminId, db);
    const id = positiveId(principalId);
    if (!id) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_INVALID_ID', 'Staff access reference is invalid.', 400);
    const row = await requireTarget(id);
    return { authority, person: project(row) };
  }

  async function mutate({ adminId, principalId, expectedRevision, rawRequestId, execute }) {
    if (typeof db.connect !== 'function') throw new Error('Staff access profile changes require a transactional database');
    const id = positiveId(principalId);
    if (!id) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_INVALID_ID', 'Staff access reference is invalid.', 400);
    const expected = exactRevision(expectedRevision);
    const safeRequestId = requestId(rawRequestId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await accessService.requireManageAccess(adminId, client);
      if (positiveId(operator.operatorAdminId) === id) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_SELF_CHANGE_FORBIDDEN', 'You cannot change your own Staff access here.', 409);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`staff-access-profile:${id}`]);
      const row = await requireTarget(id, client, true);
      if (revision(row) !== expected) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_STALE', 'Staff access changed. Reload before saving.', 409);
      const before = project(row);
      const result = await execute({ client, row, operator });
      const afterRow = await requireTarget(id, client, false);
      const after = project(afterRow);
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,$2,'staff_admin_account',$3,$4::jsonb)`,
        [operator.operatorAdminId, result.action, id, JSON.stringify({ requestId: safeRequestId, before: { profile: before.profileKey, toggles: before.toggles.map((t) => ({ key: t.key, on: t.on })) }, after: { profile: after.profileKey, toggles: after.toggles.map((t) => ({ key: t.key, on: t.on })) } })]
      );
      await client.query('COMMIT');
      return { status: 'updated', person: after };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  async function applyProfile({ adminId, principalId, expectedRevision, requestId: rawRequestId, profile } = {}) {
    const profileKey = String(profile || '').trim();
    return mutate({ adminId, principalId, expectedRevision, rawRequestId, execute: async ({ client, row }) => {
      if (profileFor(row) !== profileKey) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_PROFILE_FORBIDDEN', 'This profile does not match the staff workspace type.', 409);
      const config = canonicalProfileConfig(profileKey, row);
      await client.query(
        `UPDATE staff_admin_accounts
            SET business_role=$2,calendar_scope=$3,service_scope=$4,permissions=$5::jsonb,updated_at=NOW()
          WHERE id=$1`,
        [positiveId(row.id), config.businessRole, config.calendarScope, config.serviceScope, JSON.stringify(config.permissions)]
      );
      return { action: 'workspace.staff_access_profile_applied' };
    }});
  }

  async function setToggle({ adminId, principalId, expectedRevision, requestId: rawRequestId, toggle, on } = {}) {
    if (on !== true && on !== false) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_INVALID_TOGGLE', 'Staff access switch must be On or Off.', 400);
    const toggleKey = String(toggle || '').trim();
    return mutate({ adminId, principalId, expectedRevision, rawRequestId, execute: async ({ client, row }) => {
      const profileKey = profileFor(row);
      if (!profileKey) throw new WorkspaceStaffAccessProfileError('STAFF_ACCESS_PROFILE_UNSUPPORTED', 'This Staff access is protected.', 409);
      const nextPermissions = safeTogglePermissions(row, profileKey, toggleKey, on);
      await client.query('UPDATE staff_admin_accounts SET permissions=$2::jsonb,updated_at=NOW() WHERE id=$1', [positiveId(row.id), JSON.stringify(nextPermissions)]);
      return { action: 'workspace.staff_access_toggle_changed' };
    }});
  }

  return { list, get, applyProfile, setToggle };
}

const service = createWorkspaceStaffAccessProfilesService();

module.exports = {
  PROFILE_CLINIC_TEAM,
  PROFILE_OWN_WORKSPACE,
  PROFILE_META,
  TOGGLES,
  CLINIC_TEAM_VIEW,
  CLINIC_TEAM_ACTIONS,
  CLINIC_TEAM_DENIED,
  OWN_WORKSPACE_VIEW,
  OWN_WORKSPACE_ACTIONS,
  OWN_WORKSPACE_DENIED,
  WorkspaceStaffAccessProfileError,
  profileFor,
  project,
  canonicalProfileConfig,
  safeTogglePermissions,
  createWorkspaceStaffAccessProfilesService,
  ...service,
};