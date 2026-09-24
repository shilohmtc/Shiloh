const { pool } = require('../db/pool');
const {
  WorkspaceServicesError,
  positiveId,
  permissionSet,
  normalizeName,
  normalizeCategoryId,
  normalizePrice,
  normalizeDisplayPrice,
  normalizeCustomerDescription,
  normalizeBoolean,
} = require('./workspaceServices');

const SERVICES_CREATE_CAPABILITY = 'services:create';
const CREATE_ROLES = new Set(['owner', 'business_admin', 'booking_operator', 'tenant_practitioner']);

function requireRequestId(value) {
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_REQUEST', 'A valid operation request identifier is required.', 400);
  }
  return requestId;
}

function normalizeDuration(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_TIMING', 'Treatment duration must be a whole number of minutes.', 400);
  }
  const duration = Number(raw);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_TIMING', 'Treatment duration must be between 1 and 1440 minutes.', 400);
  }
  return duration;
}

function normalizeStaffIds(value) {
  const source = Array.isArray(value) ? value : [value];
  const ids = [...new Set(source.map(positiveId).filter(Boolean))].sort((a, b) => a - b);
  if (!ids.length || ids.length > 30) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_STAFF_ID', 'Choose at least one eligible practitioner.', 400);
  }
  return ids;
}

function normalizeCreatePayload(input = {}) {
  const variablePrice = normalizeBoolean(input.variablePrice);
  const price = normalizePrice(input.price);
  const displayPrice = normalizeDisplayPrice(input.displayPrice);
  if (!variablePrice && price == null) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_PRICE_REQUIRED', 'A fixed-price service requires a price.', 400);
  }
  if (variablePrice && price == null && !displayPrice) {
    throw new WorkspaceServicesError('WORKSPACE_SERVICES_PRICE_REQUIRED', 'A variable-price service requires a base price or display price.', 400);
  }
  return {
    name: normalizeName(input.name),
    categoryId: normalizeCategoryId(input.categoryId),
    durationMinutes: normalizeDuration(input.durationMinutes),
    variablePrice,
    price,
    displayPrice,
    customerDescription: normalizeCustomerDescription(input.customerDescription),
    staffIds: normalizeStaffIds(input.staffIds ?? input.staffId),
  };
}

function evaluateCreatePrincipal(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  const adminId = positiveId(row.id);
  const linkedStaffId = row.staff_id == null ? null : positiveId(row.staff_id);
  const businessRole = String(row.business_role || '').trim();
  if (!adminId || row.admin_active !== true || !CREATE_ROLES.has(businessRole)) return null;
  if (linkedStaffId && (row.staff_status !== 'active' || row.staff_resource_type !== 'practitioner')) return null;
  if (permissionSet(row.permissions)[SERVICES_CREATE_CAPABILITY] !== true) return null;
  if (businessRole === 'tenant_practitioner' && !linkedStaffId) return null;
  return {
    key: 'workspace_services_create_v1',
    operatorAdminId: adminId,
    linkedStaffId,
    businessRole,
    displayName: String(row.display_name || 'Staff').trim() || 'Staff',
    capability: SERVICES_CREATE_CAPABILITY,
  };
}

function createWorkspaceServiceCreationService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace service creation database is required');

  async function principalRows(adminId, queryable = db) {
    const id = positiveId(adminId);
    if (!id) return [];
    const result = await queryable.query(
      `/* workspaceServiceCreation:principal */
       SELECT a.id, a.staff_id, a.display_name, a.business_role, a.permissions,
              a.active AS admin_active, st.status AS staff_status,
              st.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff st ON st.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return result.rows;
  }

  async function resolveCreateAccess(adminId, queryable = db) {
    return evaluateCreatePrincipal(await principalRows(adminId, queryable));
  }

  async function requireCreateAccess(adminId, queryable = db) {
    const authority = await resolveCreateAccess(adminId, queryable);
    if (!authority) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_CREATE_FORBIDDEN',
        'Current canonical staff authority does not permit service creation.',
        403
      );
    }
    return authority;
  }

  async function canonicalCategory(queryable, categoryId) {
    const result = await queryable.query(
      `/* workspaceServiceCreation:category */
       SELECT id, name, display_order, status
         FROM service_categories
        WHERE id=$1 AND status='active'
        LIMIT 2`,
      [categoryId]
    );
    if (result.rows.length !== 1) {
      throw new WorkspaceServicesError('WORKSPACE_SERVICES_CATEGORY_UNAVAILABLE', 'The selected category is no longer an active canonical service category.', 409);
    }
    return result.rows[0];
  }

  async function canonicalPractitioners(queryable, staffIds) {
    const result = await queryable.query(
      `/* workspaceServiceCreation:practitioners */
       SELECT id, display_name, status, resource_type
         FROM staff
        WHERE id = ANY($1::bigint[])
          AND status='active'
          AND resource_type='practitioner'
        ORDER BY id`,
      [staffIds]
    );
    if (result.rows.length !== staffIds.length) {
      throw new WorkspaceServicesError(
        'WORKSPACE_SERVICES_PRACTITIONER_UNAVAILABLE',
        'One or more selected practitioners are not uniquely active canonical practitioners.',
        409
      );
    }
    return result.rows;
  }

  async function listCreateOptions(adminId) {
    const authority = await requireCreateAccess(adminId);
    const values = [];
    let where = "st.status='active' AND st.resource_type='practitioner'";
    if (authority.businessRole === 'tenant_practitioner') {
      values.push(authority.linkedStaffId);
      where += ` AND st.id=$${values.length}`;
    }
    const result = await db.query(
      `/* workspaceServiceCreation:options */
       SELECT st.id, st.display_name
         FROM staff st
        WHERE ${where}
        ORDER BY LOWER(st.display_name), st.id`,
      values
    );
    const categories = await db.query(
      `/* workspaceServiceCreation:categories */
       SELECT id, name, display_order
         FROM service_categories
        WHERE status='active'
        ORDER BY display_order, LOWER(name), id`
    );
    return {
      authority: { businessRole: authority.businessRole, linkedStaffId: authority.linkedStaffId },
      practitioners: result.rows.map(row => ({ id: Number(row.id), displayName: row.display_name })),
      categories: categories.rows.map(row => ({ id: Number(row.id), name: row.name, displayOrder: Number(row.display_order || 0) })),
    };
  }

  async function determinePrivateOwner(client, staffIds) {
    if (staffIds.length !== 1) return null;
    const result = await client.query(
      `SELECT DISTINCT a.staff_id
         FROM staff_admin_accounts a
         JOIN staff st ON st.id=a.staff_id
        WHERE a.active=TRUE
          AND a.business_role='tenant_practitioner'
          AND a.staff_id=$1
          AND st.status='active'
          AND st.resource_type='practitioner'`,
      [staffIds[0]]
    );
    return result.rows.length === 1 ? staffIds[0] : null;
  }

  async function createService({ adminId, requestId: rawRequestId, ...input } = {}) {
    if (typeof db.connect !== 'function') throw new Error('Workspace service creation requires a transactional database.');
    const requestId = requireRequestId(rawRequestId);
    const payload = normalizeCreatePayload(input);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const operator = await requireCreateAccess(adminId, client);
      if (operator.businessRole === 'tenant_practitioner') {
        if (payload.staffIds.length !== 1 || payload.staffIds[0] !== operator.linkedStaffId) {
          throw new WorkspaceServicesError(
            'WORKSPACE_SERVICES_CREATE_SCOPE_DENIED',
            'Tenant practitioners may create services only for their own canonical practitioner profile.',
            403
          );
        }
      }
      const category = await canonicalCategory(client, payload.categoryId);
      const practitioners = await canonicalPractitioners(client, payload.staffIds);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`workspace-service-create:${payload.name.toLowerCase()}`]
      );
      const duplicate = await client.query(
        `SELECT id FROM services WHERE LOWER(BTRIM(name))=LOWER(BTRIM($1)) LIMIT 1`,
        [payload.name]
      );
      if (duplicate.rows.length) {
        throw new WorkspaceServicesError(
          'WORKSPACE_SERVICE_NAME_EXISTS',
          'A canonical service with that name already exists. Use the existing service instead.',
          409
        );
      }
      const inserted = await client.query(
        `INSERT INTO services(
           category_id,name,duration_minutes,processing_time_minutes,extra_time_minutes,
           variable_price,price,display_price,customer_description,display_order,status
         )
         VALUES(
           $1,$2,$3,0,0,$4,$5::numeric,$6,$7,
           COALESCE((SELECT MAX(display_order)+1 FROM services),0),'active'
         )
         RETURNING id,category_id,name,duration_minutes,processing_time_minutes,extra_time_minutes,
                   variable_price,price,display_price,customer_description,status`,
        [category.id, payload.name, payload.durationMinutes, payload.variablePrice, payload.price, payload.displayPrice, payload.customerDescription]
      );
      const service = inserted.rows[0];
      for (const staffId of payload.staffIds) {
        await client.query(
          `INSERT INTO staff_services(staff_id,service_id) VALUES($1,$2)
           ON CONFLICT(staff_id,service_id) DO NOTHING`,
          [staffId, service.id]
        );
      }
      const privateOwnerStaffId = await determinePrivateOwner(client, payload.staffIds);
      if (privateOwnerStaffId) {
        await client.query(
          `INSERT INTO service_visibility_policies(service_id,visibility_scope,owner_staff_id)
           VALUES($1,'tenant_private',$2)
           ON CONFLICT(service_id) DO UPDATE
             SET visibility_scope='tenant_private', owner_staff_id=EXCLUDED.owner_staff_id, updated_at=NOW()`,
          [service.id, privateOwnerStaffId]
        );
      }
      await client.query(
        `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
         VALUES($1,'workspace.service_created','service',$2,$3::jsonb)`,
        [operator.operatorAdminId, service.id, JSON.stringify({
          requestId,
          category: { id: Number(category.id), name: category.name },
          staffIds: payload.staffIds,
          practitionerCount: practitioners.length,
          visibility: privateOwnerStaffId ? 'tenant_private' : 'ordinary',
          privateOwnerStaffId,
          pricing: { variablePrice: payload.variablePrice, hasPrice: payload.price != null, hasDisplayPrice: Boolean(payload.displayPrice) },
          publicDescription: { approvedAtCreation: true, characterCount: payload.customerDescription.length },
        })]
      );
      await client.query('COMMIT');
      return {
        status: 'created',
        service: {
          id: Number(service.id),
          categoryId: Number(service.category_id),
          categoryName: category.name,
          name: service.name,
          durationMinutes: Number(service.duration_minutes || 0),
          processingTimeMinutes: Number(service.processing_time_minutes || 0),
          extraTimeMinutes: Number(service.extra_time_minutes || 0),
          variablePrice: service.variable_price === true,
          price: service.price == null ? null : Number(service.price),
          displayPrice: service.display_price || null,
          customerDescription: service.customer_description,
          status: service.status,
          staffIds: payload.staffIds,
          privateOwnerStaffId,
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  return { resolveCreateAccess, requireCreateAccess, canonicalCategory, listCreateOptions, createService };
}

const service = createWorkspaceServiceCreationService();

module.exports = {
  SERVICES_CREATE_CAPABILITY,
  CREATE_ROLES,
  normalizeDuration,
  normalizeStaffIds,
  normalizeCreatePayload,
  evaluateCreatePrincipal,
  createWorkspaceServiceCreationService,
  ...service,
};
