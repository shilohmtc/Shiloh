const { pool } = require('../db/pool');
const { normalizeRegistrationMobile } = require('./clientIdentityOnboarding');
const { WorkspaceStaffError, permissionSet, requireRequestId } = require('./workspaceStaff');
const workspaceStaffAccess = require('./workspaceStaffAccess');

const RECEPTION_DISPLAY_NAME = 'Shiloh Reception';
const RECEPTION_PRESET = Object.freeze({
  role: 'receptionist',
  businessRole: 'booking_operator',
  calendarScope: 'all_business',
  serviceScope: 'all_services',
  capabilities: Object.freeze([
    'appointment:view',
    'appointment:create',
    'calendar:booking:reschedule',
    'calendar:booking:cancel',
    'calendar:booking:reassign',
    'client:lookup',
    'client:delete',
    'client:manage',
    'client:notify',
    'walkin:create',
    'booking:update',
    'appointment:record_past',
    'appointment:adjust_end',
    'loyalty:redeem',
    'service:pricing',
    'appointment:couples:discount',
    'staff:services:view',
    'services:view',
    'services:manage',
    'services:create',
    'schedule:manage',
    'staff:view',
    'staff:manage',
    'staff_access:manage',
    'staff_auth:reset',
  ]),
});
const FORBIDDEN_RECEPTION_CAPABILITIES = Object.freeze([]);

function enabledCapabilities(permissions) {
  const normalized = permissionSet(permissions);
  return Object.keys(normalized).filter(key => normalized[key] === true).sort();
}

function expectedPermissions() {
  return Object.fromEntries(RECEPTION_PRESET.capabilities.map(key => [key, true]));
}

function isExactReceptionPrincipal(row, normalizedWhatsapp) {
  if (!row) return false;
  const capabilities = enabledCapabilities(row.permissions);
  const expected = [...RECEPTION_PRESET.capabilities].sort();
  return row.staff_id == null
    && row.display_name === RECEPTION_DISPLAY_NAME
    && row.role === RECEPTION_PRESET.role
    && row.business_role === RECEPTION_PRESET.businessRole
    && row.calendar_scope === RECEPTION_PRESET.calendarScope
    && row.service_scope === RECEPTION_PRESET.serviceScope
    && row.active === true
    && (!normalizedWhatsapp || String(row.normalized_whatsapp || '') === normalizedWhatsapp)
    && capabilities.length === expected.length
    && capabilities.every((key, index) => key === expected[index]);
}

function receptionProjection(row = null) {
  return {
    configured: Boolean(row),
    displayName: RECEPTION_DISPLAY_NAME,
    principalType: 'shared_operational',
    staffLinked: false,
    active: row ? row.active === true : false,
    role: RECEPTION_PRESET.role,
    businessRole: RECEPTION_PRESET.businessRole,
    calendarScope: RECEPTION_PRESET.calendarScope,
    serviceScope: RECEPTION_PRESET.serviceScope,
    capabilities: [...RECEPTION_PRESET.capabilities],
    prohibitedCapabilities: [...FORBIDDEN_RECEPTION_CAPABILITIES],
  };
}

function createWorkspaceReceptionAccessService({ db = pool, staffAccessService = workspaceStaffAccess } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Reception Access database is required');

  async function requireManageAccess(adminId, queryable = db) {
    return staffAccessService.requireManageAccess(adminId, queryable);
  }

  async function readRows(queryable = db, { lock = false } = {}) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const result = await queryable.query(
      `/* workspaceReceptionAccess:principal */
       SELECT id, staff_id, display_name, role, normalized_whatsapp, active, permissions,
              business_role, calendar_scope, service_scope
         FROM staff_admin_accounts
        WHERE LOWER(TRIM(display_name))=LOWER($1)
           OR business_role='booking_operator'
        ORDER BY id
        LIMIT 4${suffix}`,
      [RECEPTION_DISPLAY_NAME]
    );
    return result.rows;
  }

  function exactConfiguredRow(rows) {
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    return isExactReceptionPrincipal(rows[0]) ? rows[0] : null;
  }

  async function getState(adminId) {
    await requireManageAccess(adminId);
    const rows = await readRows(db);
    if (rows.length === 0) return receptionProjection();
    const exact = exactConfiguredRow(rows);
    if (!exact) {
      throw new WorkspaceStaffError(
        'WORKSPACE_RECEPTION_ACCESS_AMBIGUOUS',
        'Reception access already has conflicting or broader canonical authority and was not changed.',
        409
      );
    }
    return receptionProjection(exact);
  }

  async function createReceptionPrincipal({ adminId, requestId: rawRequestId, whatsappNumber, identityConfirmed } = {}) {
    if (typeof db.connect !== 'function') throw new Error('Workspace Reception Access mutations require a transactional database.');
    const requestId = requireRequestId(rawRequestId);
    const normalizedWhatsapp = normalizeRegistrationMobile(whatsappNumber);
    if (!normalizedWhatsapp) {
      throw new WorkspaceStaffError(
        'WORKSPACE_RECEPTION_ACCESS_INVALID_WHATSAPP',
        'Enter a valid South African WhatsApp mobile number.',
        400
      );
    }
    if (identityConfirmed !== true) {
      throw new WorkspaceStaffError(
        'WORKSPACE_RECEPTION_ACCESS_IDENTITY_UNCONFIRMED',
        'Confirm that this is the dedicated Reception WhatsApp number before creating access.',
        400
      );
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await requireManageAccess(adminId, client);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [780000000001]);

      const rows = await readRows(client, { lock: true });
      if (rows.length > 0) {
        const exact = rows.length === 1 && isExactReceptionPrincipal(rows[0], normalizedWhatsapp) ? rows[0] : null;
        if (!exact) {
          throw new WorkspaceStaffError(
            'WORKSPACE_RECEPTION_ACCESS_EXISTING_AUTHORITY',
            'Reception access already has a different identity or authority and was not overwritten.',
            409
          );
        }
        await client.query('COMMIT');
        return { status: 'unchanged', access: receptionProjection(exact) };
      }

      const numberResult = await client.query(
        `/* workspaceReceptionAccess:number-owner */
         SELECT id, staff_id, display_name, active
           FROM staff_admin_accounts
          WHERE normalized_whatsapp=$1
          ORDER BY id
          LIMIT 2
          FOR UPDATE`,
        [normalizedWhatsapp]
      );
      if (numberResult.rows.length > 0) {
        throw new WorkspaceStaffError(
          'WORKSPACE_RECEPTION_ACCESS_WHATSAPP_CONFLICT',
          'That WhatsApp number is already bound to another canonical Workspace principal.',
          409
        );
      }

      const inserted = await client.query(
        `INSERT INTO staff_admin_accounts
           (staff_id, display_name, role, whatsapp_number, normalized_whatsapp, active,
            permissions, business_role, calendar_scope, service_scope)
         VALUES (NULL,$1,$2,$3,$4,TRUE,$5::jsonb,$6,$7,$8)
         RETURNING id, staff_id, display_name, role, normalized_whatsapp, active, permissions,
                   business_role, calendar_scope, service_scope`,
        [
          RECEPTION_DISPLAY_NAME,
          RECEPTION_PRESET.role,
          `+${normalizedWhatsapp}`,
          normalizedWhatsapp,
          JSON.stringify(expectedPermissions()),
          RECEPTION_PRESET.businessRole,
          RECEPTION_PRESET.calendarScope,
          RECEPTION_PRESET.serviceScope,
        ]
      );
      const created = inserted.rows[0];
      if (!isExactReceptionPrincipal(created, normalizedWhatsapp)) {
        throw new WorkspaceStaffError(
          'WORKSPACE_RECEPTION_ACCESS_POSTCONDITION_FAILED',
          'Reception principal creation did not satisfy the bounded preset.',
          409
        );
      }

      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'workspace.reception_access_created','staff_admin_account',$2,$3::jsonb)`,
        [
          operator.operatorAdminId,
          created.id,
          JSON.stringify({
            requestId,
            preset: 'reception_shared_operational_v1',
            identityBinding: 'operator_attested_reception_whatsapp',
            staffLinked: false,
            credentialMaterialCreated: false,
            capabilities: [...RECEPTION_PRESET.capabilities],
          }),
        ]
      );
      await client.query('COMMIT');
      return { status: 'created', access: receptionProjection(created) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error?.code === '23505') {
        throw new WorkspaceStaffError(
          'WORKSPACE_RECEPTION_ACCESS_IDENTITY_CONFLICT',
          'Reception identity changed concurrently. Reload and retry.',
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return { requireManageAccess, getState, createReceptionPrincipal };
}

const service = createWorkspaceReceptionAccessService();

module.exports = {
  RECEPTION_DISPLAY_NAME,
  RECEPTION_PRESET,
  FORBIDDEN_RECEPTION_CAPABILITIES,
  enabledCapabilities,
  expectedPermissions,
  isExactReceptionPrincipal,
  receptionProjection,
  createWorkspaceReceptionAccessService,
  ...service,
};
