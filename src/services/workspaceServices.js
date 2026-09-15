const crypto = require('crypto');
const { pool } = require('../db/pool');
const { serviceVisibilityAllows } = require('./calendarAuthorization');

const SERVICES_VIEW_CAPABILITY = 'services:view';
const SERVICES_MANAGE_CAPABILITY = 'services:manage';
const SERVICES_LIST_PAGE_SIZE = 30;

class WorkspaceServicesError extends Error {
  constructor(code, message, httpStatus, details = null) {
    super(message);
    this.name = 'WorkspaceServicesError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (details) this.details = details;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function evaluatePrincipal(rows = [], capability, key) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const principal = rows[0];
  const adminId = positiveId(principal.id);
  if (!adminId || principal.admin_active !== true) return null;
  if (principal.staff_id != null && principal.staff_status !== 'active') return null;
  if (permissionSet(principal.permissions)[capability] !== true) return null;
  const linkedStaffId = positiveId(principal.staff_id);
  const businessRole = String(principal.business_role || '').trim().toLowerCase();
  const serviceScope = String(principal.service_scope || '').trim().toLowerCase();
  if (businessRole === 'tenant_practitioner' && !linkedStaffId) return null;
  return {
    key,
    operatorAdminId: adminId,
    displayName: String(principal.display_name || 'Staff').trim() || 'Staff',
    linkedStaffId,
    businessRole,
    serviceScope,
    capability,
  };
}

function evaluateServicesReadAuthority(rows = []) {
  return evaluatePrincipal(rows, SERVICES_VIEW_CAPABILITY, 'workspace_services_view_v1');
}

function evaluateServicesManageAuthority(rows = []) {
  return evaluatePrincipal(rows, SERVICES_MANAGE_CAPABILITY, 'workspace_services_manage_v1');
}

function isTenantAssignedServicesAuthority(authority) {
  return authority?.businessRole === 'tenant_practitioner'
    && positiveId(authority?.linkedStaffId) != null;
}

function normalizeSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeStatus(value) {
  const status = String(value || 'active').trim().toLowerCase();
  if (status === 'all') return null;
  if (status === 'active' || status === 'inactive') return status;
  throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_STATUS', 'Service status filter is invalid.', 400);
}

function normalizeWritableStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'active' || status === 'inactive') return status;
  throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_STATUS', 'Service status must be active or inactive.', 400);
}

function normalizeOffset(value) {
  const offset = Number.parseInt(value, 10);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(offset, 100000);
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 180) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_NAME', 'Service name must be between 1 and 180 characters.', 400);
  }
  return name;
}

function normalizeMinutes(value, field) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_TIMING', `${field} must be a non-negative whole number.`, 400);
  }
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_TIMING', `${field} must be a non-negative whole number.`, 400);
  }
  return minutes;
}

function normalizePrice(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_PRICE', 'Price must be a non-negative amount with at most two decimals.', 400);
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_PRICE', 'Price is outside the canonical NUMERIC(12,2) range.', 400);
  }
  return amount.toFixed(2);
}

function normalizeDisplayPrice(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length > 120) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_DISPLAY_PRICE', 'Display price must be 120 characters or fewer.', 400);
  }
  return text || null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0 || value == null || value === '') return false;
  throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_BOOLEAN', 'Variable price must be true or false.', 400);
}

function requireRequestId(value) {
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_REQUEST', 'A valid operation request identifier is required.', 400);
  }
  return requestId;
}

function totalServiceMinutes(service) {
  return Number(service?.duration_minutes || 0)
    + Number(service?.processing_time_minutes || 0)
    + Number(service?.extra_time_minutes || 0);
}

function projectBookingEligibility(service, assignedStaff = null) {
  const count = Array.isArray(assignedStaff)
    ? assignedStaff.filter(item => item.status === 'active' && item.client_bookable === true).length
    : Number(service?.client_bookable_staff_count || 0);
  return {
    serviceActive: service?.status === 'active',
    clientBookableStaffCount: count,
    eligible: service?.status === 'active' && count > 0,
    authority: 'read_projection_only',
  };
}

function serviceRevision(service, assignedStaffIds = []) {
  const stable = {
    id: Number(service?.id),
    name: String(service?.name || ''),
    duration_minutes: Number(service?.duration_minutes || 0),
    processing_time_minutes: Number(service?.processing_time_minutes || 0),
    extra_time_minutes: Number(service?.extra_time_minutes || 0),
    variable_price: service?.variable_price === true,
    price: service?.price == null ? null : String(service.price),
    display_price: service?.display_price == null ? null : String(service.display_price),
    status: String(service?.status || ''),
    assigned_staff_ids: [...new Set((assignedStaffIds || []).map(Number).filter(positiveId))].sort((a, b) => a - b),
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function exactRevision(value) {
  const revision = String(value || '').trim();
  if (!/^[0-9a-f]{64}$/.test(revision)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_REVISION', 'Reload this service before retrying.', 400);
  }
  return revision;
}

function createWorkspaceServicesService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Services database is required');

  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return [];
    const result = await queryable.query(
      `/* workspaceServices:principal */
       SELECT a.id, a.staff_id, a.display_name, a.permissions, a.business_role, a.service_scope,
              a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }

  async function resolveAccess(adminId, queryable = db) {
    return evaluateServicesReadAuthority(await principalRows(adminId, queryable));
  }

  async function resolveManageAccess(adminId, queryable = db) {
    return evaluateServicesManageAuthority(await principalRows(adminId, queryable));
  }

  async function requireAccess(adminId, queryable = db) {
    const authority = await resolveAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_FORBIDDEN',
        'Current staff authority does not permit Services access.',
        403
      );
    }
    return authority;
  }

  async function requireManageAccess(adminId, queryable = db) {
    const authority = await resolveManageAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_MANAGE_FORBIDDEN',
        'Current canonical staff authority does not permit Services changes.',
        403
      );
    }
    return authority;
  }

  async function listServices({ adminId, q, status, offset } = {}) {
    const authority = await requireAccess(adminId);
    const search = normalizeSearch(q);
    const serviceStatus = normalizeStatus(status);
    const safeOffset = normalizeOffset(offset);
    const values = [];
    const where = [];
    if (isTenantAssignedServicesAuthority(authority)) {
      values.push(authority.linkedStaffId);
      const linkedStaffParam = `$${values.length}`;
      where.push(`EXISTS (
        SELECT 1 FROM staff_services scoped
         WHERE scoped.service_id=svc.id
           AND scoped.staff_id=${linkedStaffParam}
      )`);
      where.push(`(visibility.owner_staff_id IS NULL OR visibility.owner_staff_id=${linkedStaffParam})`);
    } else if (authority.businessRole !== 'booking_operator') {
      where.push('visibility.owner_staff_id IS NULL');
    }
    if (serviceStatus) {
      values.push(serviceStatus);
      where.push(`svc.status=$${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      where.push(`svc.name ILIKE $${values.length}`);
    }
    values.push(SERVICES_LIST_PAGE_SIZE + 1);
    const limitParam = `$${values.length}`;
    values.push(safeOffset);
    const offsetParam = `$${values.length}`;
    const result = await db.query(
      `/* workspaceServices:list */
       SELECT svc.id, svc.name, svc.duration_minutes,
              svc.processing_time_minutes, svc.extra_time_minutes,
              svc.variable_price, svc.price, svc.display_price, svc.status,
              sc.name AS category_name, visibility.owner_staff_id AS private_owner_staff_id,
              (SELECT COUNT(*)::int
                 FROM staff_services ss
                 JOIN staff st ON st.id=ss.staff_id
                WHERE ss.service_id=svc.id) AS assigned_staff_count,
              (SELECT COUNT(*)::int
                 FROM staff_services ss
                 JOIN staff st ON st.id=ss.staff_id
                WHERE ss.service_id=svc.id
                  AND st.status='active'
                  AND st.client_bookable=TRUE) AS client_bookable_staff_count
         FROM services svc
         LEFT JOIN service_categories sc ON sc.id=svc.category_id
         LEFT JOIN service_visibility_policies visibility ON visibility.service_id=svc.id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE WHEN svc.status='active' THEN 0 ELSE 1 END,
                 sc.display_order NULLS LAST,
                 svc.display_order,
                 LOWER(svc.name), svc.id
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values
    );
    const visibleRows = result.rows.filter(service => serviceVisibilityAllows(authority, service.private_owner_staff_id));
    const rows = visibleRows.slice(0, SERVICES_LIST_PAGE_SIZE).map(service => {
      const { private_owner_staff_id: _privateOwnerStaffId, ...publicService } = service;
      return {
        ...publicService,
        total_minutes: totalServiceMinutes(publicService),
        booking_eligibility: projectBookingEligibility(publicService),
      };
    });
    return {
      authority,
      services: rows,
      hasMore: visibleRows.length > SERVICES_LIST_PAGE_SIZE,
      offset: safeOffset,
      pageSize: SERVICES_LIST_PAGE_SIZE,
      query: search,
      status: serviceStatus,
    };
  }

  async function readAssignedStaff(queryable, serviceId) {
    const staffResult = await queryable.query(
      `/* workspaceServices:staff */
       SELECT st.id, st.display_name, st.resource_type, st.status, st.client_bookable
         FROM staff_services ss
         JOIN staff st ON st.id=ss.staff_id
        WHERE ss.service_id=$1
        ORDER BY CASE WHEN st.status='active' THEN 0 ELSE 1 END,
                 CASE WHEN st.client_bookable=TRUE THEN 0 ELSE 1 END,
                 LOWER(st.display_name), st.id`,
      [serviceId]
    );
    return staffResult.rows;
  }

  async function getServiceDetail({ adminId, serviceId } = {}) {
    const authority = await requireAccess(adminId);
    const id = positiveId(serviceId);
    if (!id) throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_ID', 'Service reference is invalid.', 400);

    const detailValues = [id];
    let assignmentClause = '';
    if (isTenantAssignedServicesAuthority(authority)) {
      detailValues.push(authority.linkedStaffId);
      assignmentClause = `AND EXISTS (
        SELECT 1 FROM staff_services scoped
         WHERE scoped.service_id=svc.id
           AND scoped.staff_id=$${detailValues.length}
      )`;
    }
    const serviceResult = await db.query(
      `/* workspaceServices:detail */
       SELECT svc.id, svc.name, svc.duration_minutes,
              svc.processing_time_minutes, svc.extra_time_minutes,
              svc.variable_price, svc.price, svc.display_price, svc.status,
              svc.customer_description, svc.booking_note,
              sc.name AS category_name, visibility.owner_staff_id AS private_owner_staff_id
         FROM services svc
         LEFT JOIN service_categories sc ON sc.id=svc.category_id
         LEFT JOIN service_visibility_policies visibility ON visibility.service_id=svc.id
        WHERE svc.id=$1
          ${assignmentClause}
        LIMIT 1`,
      detailValues
    );
    const service = serviceResult.rows[0];
    if (!service || !serviceVisibilityAllows(authority, service.private_owner_staff_id)) {
      throw new WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
    }
    delete service.private_owner_staff_id;

    const assignedStaff = await readAssignedStaff(db, id);
    const practitionerResult = await db.query(
      `/* workspaceServices:practitioners */
       SELECT st.id, st.display_name, st.status, st.client_bookable,
              EXISTS(
                SELECT 1 FROM staff_services ss
                 WHERE ss.staff_id=st.id AND ss.service_id=$1
              ) AS assigned
         FROM staff st
        WHERE st.resource_type='practitioner'
        ORDER BY CASE WHEN st.status='active' THEN 0 ELSE 1 END,
                 CASE WHEN st.client_bookable=TRUE THEN 0 ELSE 1 END,
                 LOWER(st.display_name), st.id`,
      [id]
    );
    const revision = serviceRevision(service, assignedStaff.map(row => row.id));

    return {
      authority,
      service: {
        ...service,
        total_minutes: totalServiceMinutes(service),
        revision,
      },
      assignedStaff,
      practitioners: practitionerResult.rows,
      bookingEligibility: projectBookingEligibility(service, assignedStaff),
    };
  }

  async function lockServiceState(client, serviceId, authority) {
    const id = positiveId(serviceId);
    if (!id) throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_ID', 'Service reference is invalid.', 400);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`workspace-service:${id}`]);
    const mutationValues = [id];
    let assignmentClause = '';
    if (isTenantAssignedServicesAuthority(authority)) {
      mutationValues.push(authority.linkedStaffId);
      assignmentClause = `AND EXISTS (
        SELECT 1 FROM staff_services scoped
         WHERE scoped.service_id=svc.id
           AND scoped.staff_id=$${mutationValues.length}
      )`;
    }
    const serviceResult = await client.query(
      `/* workspaceServices:mutation-service */
       SELECT svc.id, svc.name, svc.duration_minutes, svc.processing_time_minutes, svc.extra_time_minutes,
              svc.variable_price, svc.price, svc.display_price, svc.status,
              visibility.owner_staff_id AS private_owner_staff_id
         FROM services svc
         LEFT JOIN service_visibility_policies visibility ON visibility.service_id=svc.id
        WHERE svc.id=$1
          ${assignmentClause}
        FOR UPDATE OF svc`,
      mutationValues
    );
    const service = serviceResult.rows[0];
    if (!service || !serviceVisibilityAllows(authority, service.private_owner_staff_id)) {
      throw new WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
    }
    delete service.private_owner_staff_id;
    const assignmentResult = await client.query(
      `/* workspaceServices:mutation-assignments */
       SELECT staff_id
         FROM staff_services
        WHERE service_id=$1
        ORDER BY staff_id
        FOR UPDATE`,
      [id]
    );
    const assignedStaffIds = assignmentResult.rows.map(row => Number(row.staff_id));
    return { service, assignedStaffIds, revision: serviceRevision(service, assignedStaffIds) };
  }

  function requireCurrentRevision(state, expectedRevision) {
    const expected = exactRevision(expectedRevision);
    if (state.revision !== expected) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_STALE_REVISION',
        'This service changed. Reload canonical Services before retrying.',
        409
      );
    }
  }

  async function audit(client, operator, action, serviceId, metadata = {}) {
    await client.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
       VALUES($1,$2,'service',$3,$4::jsonb)`,
      [operator.operatorAdminId, action, serviceId, JSON.stringify(metadata)]
    );
  }

  async function inMutation({ adminId, serviceId, requestId: rawRequestId, expectedRevision, action, execute }) {
    if (typeof db.connect !== 'function') throw new Error('Workspace Services mutations require a transactional database.');
    const id = positiveId(serviceId);
    if (!id) throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_ID', 'Service reference is invalid.', 400);
    const requestId = requireRequestId(rawRequestId);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await requireManageAccess(adminId, client);
      const state = await lockServiceState(client, id, operator);
      requireCurrentRevision(state, expectedRevision);
      const result = await execute(client, operator, state);
      await audit(client, operator, action, id, { requestId, ...result.auditMetadata });
      await client.query('COMMIT');
      return { status: result.status || 'updated', serviceId: id, revision: result.revision };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateService({
    adminId, serviceId, expectedRevision, requestId,
    name, durationMinutes, processingTimeMinutes, extraTimeMinutes,
    price, displayPrice, variablePrice,
  } = {}) {
    const payload = {
      name: normalizeName(name),
      durationMinutes: normalizeMinutes(durationMinutes, 'Treatment duration'),
      processingTimeMinutes: normalizeMinutes(processingTimeMinutes, 'Processing time'),
      extraTimeMinutes: normalizeMinutes(extraTimeMinutes, 'Extra time'),
      price: normalizePrice(price),
      displayPrice: normalizeDisplayPrice(displayPrice),
      variablePrice: normalizeBoolean(variablePrice),
    };
    return inMutation({
      adminId, serviceId, expectedRevision, requestId,
      action: 'workspace.service_updated',
      execute: async (client, _operator, state) => {
        const before = {
          name: state.service.name,
          durationMinutes: Number(state.service.duration_minutes || 0),
          processingTimeMinutes: Number(state.service.processing_time_minutes || 0),
          extraTimeMinutes: Number(state.service.extra_time_minutes || 0),
          price: state.service.price == null ? null : String(state.service.price),
          displayPrice: state.service.display_price == null ? null : String(state.service.display_price),
          variablePrice: state.service.variable_price === true,
        };
        const updated = await client.query(
          `UPDATE services
              SET name=$2,
                  duration_minutes=$3,
                  processing_time_minutes=$4,
                  extra_time_minutes=$5,
                  price=$6::numeric,
                  display_price=$7,
                  variable_price=$8,
                  updated_at=NOW()
            WHERE id=$1
          RETURNING id, name, duration_minutes, processing_time_minutes, extra_time_minutes,
                    variable_price, price, display_price, status`,
          [
            state.service.id, payload.name, payload.durationMinutes, payload.processingTimeMinutes,
            payload.extraTimeMinutes, payload.price, payload.displayPrice, payload.variablePrice,
          ]
        );
        const next = updated.rows[0];
        if (!next) throw new WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
        return {
          revision: serviceRevision(next, state.assignedStaffIds),
          auditMetadata: { before, after: payload },
        };
      },
    });
  }

  async function setServiceStatus({ adminId, serviceId, expectedRevision, requestId, status } = {}) {
    const nextStatus = normalizeWritableStatus(status);
    return inMutation({
      adminId, serviceId, expectedRevision, requestId,
      action: 'workspace.service_status_changed',
      execute: async (client, _operator, state) => {
        const updated = await client.query(
          `UPDATE services
              SET status=$2, updated_at=NOW()
            WHERE id=$1
          RETURNING id, name, duration_minutes, processing_time_minutes, extra_time_minutes,
                    variable_price, price, display_price, status`,
          [state.service.id, nextStatus]
        );
        const next = updated.rows[0];
        return {
          revision: serviceRevision(next, state.assignedStaffIds),
          auditMetadata: {
            before: { status: state.service.status },
            after: { status: nextStatus },
            assignmentsPreserved: true,
            historicalAppointmentsUntouched: true,
          },
        };
      },
    });
  }

  async function requireCanonicalPractitioner(client, staffId, { activeOnly = false } = {}) {
    const id = positiveId(staffId);
    if (!id) throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_STAFF_ID', 'Practitioner reference is invalid.', 400);
    const result = await client.query(
      `/* workspaceServices:canonical-practitioner */
       SELECT id, display_name, status, client_bookable
         FROM staff
        WHERE id=$1
          AND resource_type='practitioner'
          ${activeOnly ? "AND status='active'" : ''}
        LIMIT 2`,
      [id]
    );
    if (result.rows.length !== 1) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_PRACTITIONER_UNAVAILABLE',
        activeOnly
          ? 'The selected practitioner is not one uniquely active canonical practitioner.'
          : 'The selected staff record is not one uniquely canonical practitioner.',
        409
      );
    }
    return result.rows[0];
  }

  async function requireAssignablePractitioner(client, staffId) {
    return requireCanonicalPractitioner(client, staffId, { activeOnly: true });
  }

  async function assignPractitioner({ adminId, serviceId, staffId, expectedRevision, requestId } = {}) {
    const practitionerId = positiveId(staffId);
    return inMutation({
      adminId, serviceId, expectedRevision, requestId,
      action: 'workspace.service_practitioner_assigned',
      execute: async (client, _operator, state) => {
        const practitioner = await requireAssignablePractitioner(client, practitionerId);
        await client.query(
          `INSERT INTO staff_services(staff_id,service_id)
           VALUES($1,$2)
           ON CONFLICT(staff_id,service_id) DO NOTHING`,
          [practitioner.id, state.service.id]
        );
        const assignedStaffIds = [...new Set([...state.assignedStaffIds, practitioner.id])].sort((a, b) => a - b);
        return {
          revision: serviceRevision(state.service, assignedStaffIds),
          auditMetadata: {
            staffId: practitioner.id,
            staffDisplayName: practitioner.display_name,
            idempotentMapping: true,
          },
        };
      },
    });
  }

  async function unassignPractitioner({ adminId, serviceId, staffId, expectedRevision, requestId } = {}) {
    const practitionerId = positiveId(staffId);
    if (!practitionerId) throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_STAFF_ID', 'Practitioner reference is invalid.', 400);
    return inMutation({
      adminId, serviceId, expectedRevision, requestId,
      action: 'workspace.service_practitioner_unassigned',
      execute: async (client, _operator, state) => {
        await requireCanonicalPractitioner(client, practitionerId);
        const removed = await client.query(
          `DELETE FROM staff_services
            WHERE staff_id=$1 AND service_id=$2
          RETURNING staff_id`,
          [practitionerId, state.service.id]
        );
        if (!removed.rows.length) {
          throw new WorkspaceServicesError('WORKSPACE_SERVICES_ASSIGNMENT_NOT_FOUND', 'That practitioner is no longer assigned to this service.', 409);
        }
        const assignedStaffIds = state.assignedStaffIds.filter(id => id !== practitionerId);
        return {
          revision: serviceRevision(state.service, assignedStaffIds),
          auditMetadata: {
            staffId: practitionerId,
            historicalAppointmentsUntouched: true,
          },
        };
      },
    });
  }

  return {
    resolveAccess,
    resolveManageAccess,
    requireAccess,
    requireManageAccess,
    listServices,
    getServiceDetail,
    updateService,
    setServiceStatus,
    assignPractitioner,
    unassignPractitioner,
  };
}

const service = createWorkspaceServicesService();

module.exports = {
  SERVICES_VIEW_CAPABILITY,
  SERVICES_MANAGE_CAPABILITY,
  SERVICES_LIST_PAGE_SIZE,
  WorkspaceServicesError,
  positiveId,
  permissionSet,
  evaluateServicesReadAuthority,
  evaluateServicesManageAuthority,
  isTenantAssignedServicesAuthority,
  normalizeSearch,
  normalizeStatus,
  normalizeWritableStatus,
  normalizeOffset,
  normalizeName,
  normalizeMinutes,
  normalizePrice,
  normalizeDisplayPrice,
  normalizeBoolean,
  totalServiceMinutes,
  projectBookingEligibility,
  serviceRevision,
  createWorkspaceServicesService,
  ...service,
};
