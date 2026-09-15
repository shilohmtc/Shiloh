const { pool } = require('../db/pool');

function normalizedName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const OWN_APPOINTMENT_FINALIZERS = new Set(['christel', 'abigail', 'marietjie']);
const ORDINARY_PRACTITIONER_ROLES = new Set(['tenant_practitioner', 'employee_practitioner']);
const BUSINESS_BACKUP_ROLES = new Set(['owner', 'business_admin', 'booking_operator']);

function permissions(admin) {
  return admin?.permissions && typeof admin.permissions === 'object' && !Array.isArray(admin.permissions)
    ? admin.permissions
    : {};
}

function activeLinkedStaffId(admin) {
  const staffId = Number(admin?.staff_id);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) return null;
  if (admin?.admin_active === false || admin?.active === false || admin?.staff_status === 'inactive') return null;
  return staffId;
}

function canAccessOwnFinalization(admin) {
  const staffId = Number(admin?.staff_id);
  return OWN_APPOINTMENT_FINALIZERS.has(normalizedName(admin?.display_name))
    && Number.isInteger(staffId)
    && staffId > 0;
}

function canAccessWorkspaceOwnFinalization(admin) {
  const scope = String(admin?.calendar_scope || '').trim().toLowerCase();
  const businessRole = String(admin?.business_role || '').trim().toLowerCase();
  const ordinaryPractitionerWithBusinessRead = scope === 'all_business'
    && ORDINARY_PRACTITIONER_ROLES.has(businessRole);
  return activeLinkedStaffId(admin) != null
    && (['own', 'own_services', 'own_appointments'].includes(scope) || ordinaryPractitionerWithBusinessRead)
    && permissions(admin)['appointment:view'] === true
    && permissions(admin)['booking:update'] === true;
}

function canAccessWorkspaceBackupFinalization(admin) {
  const businessRole = String(admin?.business_role || '').trim().toLowerCase();
  return BUSINESS_BACKUP_ROLES.has(businessRole)
    && String(admin?.calendar_scope || '').trim().toLowerCase() === 'all_business'
    && permissions(admin)['appointment:view'] === true
    && permissions(admin)['booking:update'] === true
    && admin?.admin_active !== false
    && admin?.active !== false;
}

async function certificationStaffIds(admin, db = pool, { workspace = false } = {}) {
  const name = normalizedName(admin?.display_name);
  if (workspace ? !canAccessWorkspaceOwnFinalization(admin) : !canAccessOwnFinalization(admin)) return [];
  const staffId = activeLinkedStaffId(admin);
  if (!staffId) return [];

  // Finalization is own-practitioner-only. The Admin link and the active
  // canonical staff identity must agree exactly; missing or conflicting
  // identity evidence fails closed instead of falling back to name inference.
  const historicalIdentityCheck = workspace ? '' : 'AND lower(trim(display_name))=$2';
  const result = await db.query(
    `SELECT id
       FROM staff
      WHERE id=$1
        AND status='active'
        ${historicalIdentityCheck}
      ORDER BY id
      LIMIT 2`,
    workspace ? [staffId] : [staffId, name]
  );
  if (result.rows.length !== 1) return [];
  return [Number(result.rows[0].id)];
}

async function canCertifyAppointment(admin, appointmentId, db = pool, { workspace = false, allowBusinessBackup = false } = {}) {
  const backup = workspace && allowBusinessBackup && canAccessWorkspaceBackupFinalization(admin);
  const allowed = backup ? [] : await certificationStaffIds(admin, db, { workspace });
  if (!backup && !allowed.length) return false;

  // Keep unresolved assignment evidence in the canonical ownership decision.
  // appointment_staff.staff_id is nullable (ON DELETE SET NULL), so dropping
  // NULL rows here can make an incomplete assignment set look exclusively own.
  const assigned = await db.query(
    `SELECT DISTINCT staff_id
       FROM appointment_staff
      WHERE appointment_id=$1
      ORDER BY staff_id`,
    [appointmentId]
  );
  const hasUnresolvedAssignment = assigned.rows.some((row) => row.staff_id == null);
  const staffIds = assigned.rows
    .filter((row) => row.staff_id != null)
    .map((row) => Number(row.staff_id));
  if (!staffIds.length) return false;
  if (backup) return true;
  if (hasUnresolvedAssignment) return false;
  return staffIds.every((staffId) => allowed.includes(staffId));
}

function authorityDescription(admin, { workspace = false, allowBusinessBackup = false } = {}) {
  if (workspace && allowBusinessBackup && canAccessWorkspaceBackupFinalization(admin)) return 'all-business Workspace finalization';
  if (workspace && canAccessWorkspaceOwnFinalization(admin)) return `${String(admin.display_name).trim()} appointments`;
  if (canAccessOwnFinalization(admin)) return `${String(admin.display_name).trim()} appointments`;
  return 'review only';
}

module.exports = {
  normalizedName,
  canAccessOwnFinalization,
  canAccessWorkspaceOwnFinalization,
  canAccessWorkspaceBackupFinalization,
  certificationStaffIds,
  canCertifyAppointment,
  authorityDescription,
};
