const { pool } = require('../db/pool');
const { normalizeRegistrationMobile } = require('./clientIdentityOnboarding');
const {
  WorkspaceStaffError,
  positiveId,
  permissionSet,
  requireRequestId,
  requireExpectedRevision,
  staffRevision,
} = require('./workspaceStaff');

const STAFF_ACCESS_MANAGE_CAPABILITY = 'staff_access:manage';
const PRACTITIONER_ACCESS_PRESET = Object.freeze({
  role: 'practitioner',
  businessRole: 'employee_practitioner',
  calendarScope: 'own_appointments',
  serviceScope: 'own_services',
  capabilities: Object.freeze(['appointment:view']),
});

function evaluateStaffAccessManageAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const operatorAdminId = positiveId(row.id);
  if (!operatorAdminId || row.admin_active !== true) return null;
  if (positiveId(row.staff_id) && row.staff_status !== 'active') return null;
  if (permissionSet(row.permissions)[STAFF_ACCESS_MANAGE_CAPABILITY] !== true) return null;
  return {
    key: 'workspace_staff_access_manage_v1',
    capability: STAFF_ACCESS_MANAGE_CAPABILITY,
    operatorAdminId,
    staffId: positiveId(row.staff_id),
    businessRole: String(row.business_role || ''),
    calendarScope: String(row.calendar_scope || ''),
    displayName: String(row.display_name || 'Staff').trim() || 'Staff',
  };
}

function enabledCapabilities(permissions) {
  return Object.keys(permissionSet(permissions)).filter(key => permissions[key] === true).sort();
}

function isLeastPrivilegePractitionerAccess(row, normalizedWhatsapp) {
  if (!row) return false;
  const capabilities = enabledCapabilities(row.permissions);
  return String(row.normalized_whatsapp || '') === normalizedWhatsapp
    && row.role === PRACTITIONER_ACCESS_PRESET.role
    && row.business_role === PRACTITIONER_ACCESS_PRESET.businessRole
    && row.calendar_scope === PRACTITIONER_ACCESS_PRESET.calendarScope
    && row.service_scope === PRACTITIONER_ACCESS_PRESET.serviceScope
    && capabilities.length === 1
    && capabilities[0] === PRACTITIONER_ACCESS_PRESET.capabilities[0];
}

function accessProjection() {
  return {
    businessRole: PRACTITIONER_ACCESS_PRESET.businessRole,
    calendarScope: PRACTITIONER_ACCESS_PRESET.calendarScope,
    serviceScope: PRACTITIONER_ACCESS_PRESET.serviceScope,
    capabilities: [...PRACTITIONER_ACCESS_PRESET.capabilities],
  };
}

function createWorkspaceStaffAccessService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Staff Access database is required');

  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return [];
    const result = await queryable.query(
      `/* workspaceStaffAccess:principal */
       SELECT a.id, a.staff_id, a.display_name, a.business_role, a.calendar_scope, a.permissions, a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }

  async function resolveManageAccess(adminId, queryable = db) {
    return evaluateStaffAccessManageAuthority(await principalRows(adminId, queryable));
  }

  async function requireManageAccess(adminId, queryable = db) {
    const authority = await resolveManageAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceStaffError(
        'WORKSPACE_STAFF_ACCESS_MANAGE_FORBIDDEN',
        'Current staff authority does not permit Workspace access changes.',
        403
      );
    }
    return authority;
  }

  async function audit(client, operator, staffId, metadata) {
    await client.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES($1,'workspace.staff_access_enabled','staff',$2,$3::jsonb)`,
      [operator.operatorAdminId, staffId, JSON.stringify(metadata)]
    );
  }

  async function enableWorkspaceAccess({
    adminId,
    staffId,
    expectedRevision,
    requestId: rawRequestId,
    whatsappNumber,
    identityConfirmed,
  } = {}) {
    if (typeof db.connect !== 'function') throw new Error('Workspace Staff Access mutations require a transactional database.');
    const id = positiveId(staffId);
    if (!id) throw new WorkspaceStaffError('WORKSPACE_STAFF_INVALID_ID', 'Staff reference is invalid.', 400);
    const requestId = requireRequestId(rawRequestId);
    const expected = requireExpectedRevision(expectedRevision);
    const normalizedWhatsapp = normalizeRegistrationMobile(whatsappNumber);
    if (!normalizedWhatsapp) {
      throw new WorkspaceStaffError(
        'WORKSPACE_STAFF_ACCESS_INVALID_WHATSAPP',
        'Enter a valid South African WhatsApp mobile number.',
        400
      );
    }
    if (identityConfirmed !== true) {
      throw new WorkspaceStaffError(
        'WORKSPACE_STAFF_ACCESS_IDENTITY_UNCONFIRMED',
        'Confirm that you verified this staff member’s current WhatsApp number before enabling access.',
        400
      );
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await requireManageAccess(adminId, client);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [731000000000 + id]);

      const staffResult = await client.query(
        `/* workspaceStaffAccess:target */
         SELECT id, display_name, resource_type, status, scheduling_type, client_bookable,
                business_role, calendar_scope
           FROM staff
          WHERE id=$1
          FOR UPDATE`,
        [id]
      );
      const staff = staffResult.rows[0];
      if (!staff) throw new WorkspaceStaffError('WORKSPACE_STAFF_NOT_FOUND', 'Staff member was not found.', 404);
      if (staffRevision(staff) !== expected) {
        throw new WorkspaceStaffError('WORKSPACE_STAFF_STALE_REVISION', 'Staff changed since this view was loaded.', 409);
      }
      if (staff.resource_type !== 'practitioner' || staff.business_role !== 'employee_practitioner') {
        throw new WorkspaceStaffError(
          'WORKSPACE_STAFF_ACCESS_ROLE_UNSUPPORTED',
          'This bounded access preset is only available to employee practitioners.',
          409
        );
      }
      if (staff.status !== 'active') {
        throw new WorkspaceStaffError(
          'WORKSPACE_STAFF_ACCESS_INACTIVE',
          'Activate the canonical Staff profile before enabling Workspace access.',
          409
        );
      }

      const linkedResult = await client.query(
        `/* workspaceStaffAccess:linked */
         SELECT id, staff_id, display_name, role, whatsapp_number, normalized_whatsapp,
                active, permissions, business_role, calendar_scope, service_scope
           FROM staff_admin_accounts
          WHERE staff_id=$1
          ORDER BY id
          LIMIT 3
          FOR UPDATE`,
        [id]
      );
      if (linkedResult.rows.length > 1) {
        throw new WorkspaceStaffError(
          'WORKSPACE_STAFF_ACCESS_AMBIGUOUS',
          'Canonical staff access is ambiguous and must be reconciled before enablement.',
          409
        );
      }
      const linked = linkedResult.rows[0] || null;

      const numberResult = await client.query(
        `/* workspaceStaffAccess:number-owner */
         SELECT id, staff_id, active
           FROM staff_admin_accounts
          WHERE normalized_whatsapp=$1
          ORDER BY id
          LIMIT 2
          FOR UPDATE`,
        [normalizedWhatsapp]
      );
      const conflicting = numberResult.rows.filter(row => !linked || Number(row.id) !== Number(linked.id));
      if (conflicting.length || numberResult.rows.length > 1) {
        throw new WorkspaceStaffError(
          'WORKSPACE_STAFF_ACCESS_WHATSAPP_CONFLICT',
          'That WhatsApp number is already bound to another canonical staff access principal.',
          409
        );
      }

      if (linked) {
        if (!isLeastPrivilegePractitionerAccess(linked, normalizedWhatsapp)) {
          throw new WorkspaceStaffError(
            'WORKSPACE_STAFF_ACCESS_EXISTING_AUTHORITY',
            'Existing staff access has a different identity or authority and was not overwritten.',
            409
          );
        }
        if (linked.active === true) {
          await client.query('COMMIT');
          return { status: 'unchanged', staffId: id, access: accessProjection() };
        }
        await client.query(
          `UPDATE staff_admin_accounts
              SET active=TRUE, display_name=$2, updated_at=NOW()
            WHERE id=$1`,
          [linked.id, staff.display_name]
        );
        await audit(client, operator, id, {
          requestId,
          preset: 'employee_practitioner_view_only_v1',
          identityBinding: 'operator_attested_current_whatsapp',
          reactivatedExistingPrincipal: true,
          credentialMaterialChanged: false,
          capabilities: [...PRACTITIONER_ACCESS_PRESET.capabilities],
        });
        await client.query('COMMIT');
        return { status: 'enabled', staffId: id, access: accessProjection() };
      }

      await client.query(
        `INSERT INTO staff_admin_accounts
           (staff_id, display_name, role, whatsapp_number, normalized_whatsapp, active,
            permissions, business_role, calendar_scope, service_scope)
         VALUES ($1,$2,$3,$4,$5,TRUE,$6::jsonb,$7,$8,$9)`,
        [
          id,
          staff.display_name,
          PRACTITIONER_ACCESS_PRESET.role,
          `+${normalizedWhatsapp}`,
          normalizedWhatsapp,
          JSON.stringify({ 'appointment:view': true }),
          PRACTITIONER_ACCESS_PRESET.businessRole,
          PRACTITIONER_ACCESS_PRESET.calendarScope,
          PRACTITIONER_ACCESS_PRESET.serviceScope,
        ]
      );
      await audit(client, operator, id, {
        requestId,
        preset: 'employee_practitioner_view_only_v1',
        identityBinding: 'operator_attested_current_whatsapp',
        createdPrincipal: true,
        credentialMaterialCreated: false,
        capabilities: [...PRACTITIONER_ACCESS_PRESET.capabilities],
      });
      await client.query('COMMIT');
      return { status: 'enabled', staffId: id, access: accessProjection() };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error?.code === '23505') {
        throw new WorkspaceStaffError(
          'WORKSPACE_STAFF_ACCESS_IDENTITY_CONFLICT',
          'Canonical staff access identity changed concurrently. Reload and retry.',
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    resolveManageAccess,
    requireManageAccess,
    enableWorkspaceAccess,
  };
}

const service = createWorkspaceStaffAccessService();

module.exports = {
  STAFF_ACCESS_MANAGE_CAPABILITY,
  PRACTITIONER_ACCESS_PRESET,
  evaluateStaffAccessManageAuthority,
  enabledCapabilities,
  isLeastPrivilegePractitionerAccess,
  accessProjection,
  createWorkspaceStaffAccessService,
  ...service,
};
