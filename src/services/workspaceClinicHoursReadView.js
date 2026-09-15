const { pool } = require('../db/pool');
const { createWorkspaceClinicHoursService } = require('./workspaceClinicHours');

const SCHEDULE_VIEW_CAPABILITY = 'schedule:view';
const SCHEDULE_MANAGE_CAPABILITY = 'schedule:manage';

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readProxy(db) {
  return {
    async query(sql, params) {
      const result = await db.query(sql, params);
      if (!String(sql).includes('workspaceClinicHours:principal')) return result;
      return {
        ...result,
        rows: (result.rows || []).map((row) => {
          const source = permissionSet(row.permissions);
          if (source[SCHEDULE_MANAGE_CAPABILITY] === true || source[SCHEDULE_VIEW_CAPABILITY] !== true) return row;
          return { ...row, permissions: { ...source, [SCHEDULE_MANAGE_CAPABILITY]: true } };
        }),
      };
    },
  };
}

function createWorkspaceClinicHoursReadViewService({ db = pool, locationResolver } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Clinic Hours read view database is required');
  const canonical = createWorkspaceClinicHoursService({ db: readProxy(db), ...(locationResolver ? { locationResolver } : {}) });

  async function principal(adminId) {
    const id = Number(adminId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const result = await db.query(
      `/* workspaceClinicHoursReadView:principal */
       SELECT a.id,a.staff_id,a.display_name,a.permissions,a.active AS admin_active,s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
        LIMIT 1`,
      [id]
    );
    if (result.rows.length !== 1) return null;
    const row = result.rows[0];
    if (row.admin_active !== true || (row.staff_id != null && row.staff_status !== 'active')) return null;
    return row;
  }

  async function resolveAccess(adminId) {
    const row = await principal(adminId);
    if (!row) return null;
    const p = permissionSet(row.permissions);
    if (p[SCHEDULE_VIEW_CAPABILITY] !== true && p[SCHEDULE_MANAGE_CAPABILITY] !== true) return null;
    return {
      key: 'workspace_clinic_hours_read_v1',
      operatorAdminId: Number(row.id),
      displayName: String(row.display_name || 'Staff').trim() || 'Staff',
      canManage: p[SCHEDULE_MANAGE_CAPABILITY] === true,
    };
  }

  async function buildModel({ adminId } = {}) {
    const access = await resolveAccess(adminId);
    if (!access) {
      const error = new Error('Current staff access does not permit Clinic Hours.');
      error.code = 'WORKSPACE_CLINIC_HOURS_FORBIDDEN';
      error.httpStatus = 403;
      throw error;
    }
    const model = await canonical.buildModel({ adminId });
    return { ...model, authority: { ...model.authority, displayName: access.displayName, canManage: access.canManage }, readOnly: !access.canManage };
  }

  async function canManage(adminId) {
    const access = await resolveAccess(adminId);
    return access?.canManage === true;
  }

  return { resolveAccess, buildModel, canManage };
}

const service = createWorkspaceClinicHoursReadViewService();

module.exports = {
  SCHEDULE_VIEW_CAPABILITY,
  SCHEDULE_MANAGE_CAPABILITY,
  createWorkspaceClinicHoursReadViewService,
  ...service,
};
