const { pool } = require("../db/pool");
const { CLIENT_RELATIONSHIP_TYPES, validClientScope, positiveId } = require('./clientRelationshipScope');

function clampLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function scopeSql(scope, relationshipAlias, ownerParam = null) {
  if (!validClientScope(scope)) return null;
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    if (!ownerParam) throw new Error('Tenant client scope requires an owner parameter');
    return `${relationshipAlias}.relationship_type='tenant_staff' AND ${relationshipAlias}.owner_staff_id=${ownerParam}`;
  }
  return `${relationshipAlias}.relationship_type='clinic' AND ${relationshipAlias}.owner_staff_id IS NULL`;
}

function appointmentScopeSql(scope, appointmentExpression, ownerParam = null) {
  if (!validClientScope(scope)) return null;
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    if (!ownerParam) throw new Error('Tenant client scope requires an owner parameter');
    return `EXISTS (
      SELECT 1
        FROM appointment_services scope_aps
        JOIN service_visibility_policies scope_visibility
          ON scope_visibility.service_id=scope_aps.service_id
         AND scope_visibility.visibility_scope='tenant_private'
       WHERE scope_aps.appointment_id=${appointmentExpression}
         AND scope_visibility.owner_staff_id=${ownerParam}
    )`;
  }
  return `(
    NOT EXISTS (
      SELECT 1 FROM appointment_services scope_any
       WHERE scope_any.appointment_id=${appointmentExpression}
    )
    OR EXISTS (
      SELECT 1
        FROM appointment_services scope_aps
        LEFT JOIN service_visibility_policies scope_visibility
          ON scope_visibility.service_id=scope_aps.service_id
         AND scope_visibility.visibility_scope='tenant_private'
       WHERE scope_aps.appointment_id=${appointmentExpression}
         AND scope_visibility.service_id IS NULL
    )
  )`;
}

async function listClients({ q, status, limit, offset, scope }) {
  const values = [];
  const where = [];
  const scoped = validClientScope(scope);
  let ownerParam = null;
  if (scoped && scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    values.push(positiveId(scope.ownerStaffId));
    ownerParam = `$${values.length}`;
  }
  if (scoped) where.push(scopeSql(scope, 'relationship', ownerParam));
  if (status) {
    values.push(status);
    where.push(`${scoped ? 'relationship' : 'c'}.status = $${values.length}`);
  }
  const search = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (search) {
    values.push(`%${search}%`);
    const nameParam = `$${values.length}`;
    const mobileDigits = search.replace(/[^0-9]/g, '');
    values.push(mobileDigits ? `%${mobileDigits}%` : null);
    const mobileParam = `$${values.length}`;
    where.push(`(c.name ILIKE ${nameParam} OR (${mobileParam}::text IS NOT NULL AND c.normalized_mobile LIKE ${mobileParam}))`);
  }
  values.push(clampLimit(limit, 25, 50)); const limitParam = `$${values.length}`;
  values.push(parseOffset(offset)); const offsetParam = `$${values.length}`;
  const appointmentScope = scoped ? appointmentScopeSql(scope, 'a_last.id', ownerParam) : null;
  const result = await pool.query(`
    /* workspaceClients:list:crm_v2 */
    SELECT c.id, c.name, c.normalized_mobile,
           TO_CHAR(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
           c.gender, c.profile_status, c.mobile_verified_at,
           ${scoped ? 'relationship.status' : 'c.status'} AS status,
           (SELECT MAX(a_last.starts_at)
              FROM appointments a_last
             WHERE a_last.crm_v2_client_id=c.id
               AND a_last.client_id IS NULL
               ${appointmentScope ? `AND ${appointmentScope}` : ''}) AS last_appointment_at
    FROM crm_v2_clients c
    ${scoped ? 'JOIN crm_v2_client_relationships relationship ON relationship.client_id=c.id' : ''}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY LOWER(c.name), c.id
    LIMIT ${limitParam} OFFSET ${offsetParam}`, values);
  return result.rows;
}

async function getClient(id, { scope } = {}) {
  const scoped = validClientScope(scope);
  const values = [id];
  let ownerParam = null;
  if (scoped && scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    values.push(positiveId(scope.ownerStaffId));
    ownerParam = `$${values.length}`;
  }
  const relationshipFilter = scoped ? scopeSql(scope, 'relationship', ownerParam) : null;
  const result = await pool.query(`
    /* workspaceClients:detail:crm_v2 */
    SELECT c.id, c.name, c.normalized_mobile,
           TO_CHAR(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
           c.gender, c.profile_status, c.mobile_verified_at,
           ${scoped ? 'relationship.status' : 'c.status'} AS status
      FROM crm_v2_clients c
      ${scoped ? 'JOIN crm_v2_client_relationships relationship ON relationship.client_id=c.id' : ''}
     WHERE c.id=$1
       ${relationshipFilter ? `AND ${relationshipFilter}` : ''}
     LIMIT 1`, values);
  return result.rows[0] || null;
}

async function getClientAppointments(id, { limit, offset, scope }) {
  const values = [id];
  const scoped = validClientScope(scope);
  let ownerParam = null;
  if (scoped && scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    values.push(positiveId(scope.ownerStaffId));
    ownerParam = `$${values.length}`;
  }
  const appointmentScope = scoped ? appointmentScopeSql(scope, 'a.id', ownerParam) : null;
  values.push(clampLimit(limit, 20, 50)); const limitParam = `$${values.length}`;
  values.push(parseOffset(offset)); const offsetParam = `$${values.length}`;
  const result = await pool.query(`
    /* workspaceClients:history:crm_v2_xor */
    SELECT a.id, a.starts_at, a.ends_at, a.status, a.title,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'name', aps.service_name_snapshot, 'price', aps.price_snapshot, 'durationMinutes', aps.duration_minutes_snapshot)
             ORDER BY aps.position) FROM appointment_services aps WHERE aps.appointment_id = a.id), '[]'::jsonb) AS services,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ast.staff_name_snapshot)
             ORDER BY ast.position) FROM appointment_staff ast WHERE ast.appointment_id = a.id), '[]'::jsonb) AS staff
      FROM appointments a
      JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
     WHERE c.id=$1
       AND a.crm_v2_client_id=$1
       AND a.client_id IS NULL
       ${appointmentScope ? `AND ${appointmentScope}` : ''}
     ORDER BY a.starts_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`, values);
  return result.rows;
}

async function listServices({ status, categoryId, limit, offset }) {
  const values = []; const where = [];
  if (status) { values.push(status); where.push(`s.status = $${values.length}`); }
  if (categoryId) { values.push(categoryId); where.push(`s.category_id = $${values.length}`); }
  values.push(clampLimit(limit, 100)); const lp = `$${values.length}`;
  values.push(parseOffset(offset)); const op = `$${values.length}`;
  const result = await pool.query(`
    SELECT s.id, s.name, s.duration_minutes, s.processing_time_minutes, s.extra_time_minutes,
           s.variable_price, s.price, s.display_price, s.display_order, s.is_default, s.status,
           s.external_source, s.external_id, s.created_at, s.updated_at,
           sc.id AS category_id, sc.name AS category_name
    FROM services s LEFT JOIN service_categories sc ON sc.id = s.category_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY sc.display_order NULLS LAST, s.display_order, s.name LIMIT ${lp} OFFSET ${op}`, values);
  return result.rows;
}

async function listStaff({ status, limit, offset }) {
  const values = []; const where = [];
  if (status) { values.push(status); where.push(`st.status = $${values.length}`); }
  values.push(clampLimit(limit, 100)); const lp = `$${values.length}`;
  values.push(parseOffset(offset)); const op = `$${values.length}`;
  const result = await pool.query(`
    SELECT st.id, st.display_name, st.resource_type, st.status, st.source_name, st.created_at, st.updated_at,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
             ORDER BY s.name) FROM staff_services ss JOIN services s ON s.id = ss.service_id WHERE ss.staff_id = st.id), '[]'::jsonb) AS services
    FROM staff st ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY st.display_name LIMIT ${lp} OFFSET ${op}`, values);
  return result.rows;
}

async function listAppointments({ status, clientId, from, to, limit, offset }) {
  const values = []; const where = [];
  for (const [value, sql] of [[status, "a.status"], [clientId, "a.client_id"]]) {
    if (value) { values.push(value); where.push(`${sql} = $${values.length}`); }
  }
  if (from) { values.push(from); where.push(`a.starts_at >= $${values.length}`); }
  if (to) { values.push(to); where.push(`a.starts_at < $${values.length}`); }
  values.push(clampLimit(limit)); const lp = `$${values.length}`;
  values.push(parseOffset(offset)); const op = `$${values.length}`;
  const result = await pool.query(`
    SELECT a.id, a.client_id, c.display_name AS client_name, a.location_id, l.name AS location_name,
           a.starts_at, a.ends_at, a.status, a.title, a.total_price, a.currency, a.source, a.created_at, a.updated_at
    FROM appointments a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN locations l ON l.id = a.location_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.starts_at DESC LIMIT ${lp} OFFSET ${op}`, values);
  return result.rows;
}

async function getAppointment(id) {
  const result = await pool.query(`
    SELECT a.*, c.display_name AS client_name, l.name AS location_name,
           COALESCE((SELECT jsonb_agg(to_jsonb(aps) ORDER BY aps.position) FROM appointment_services aps WHERE aps.appointment_id = a.id), '[]'::jsonb) AS services,
           COALESCE((SELECT jsonb_agg(to_jsonb(ast) ORDER BY ast.position) FROM appointment_staff ast WHERE ast.appointment_id = a.id), '[]'::jsonb) AS staff,
           COALESCE((SELECT jsonb_agg(to_jsonb(ash) ORDER BY ash.changed_at) FROM appointment_status_history ash WHERE ash.appointment_id = a.id), '[]'::jsonb) AS status_history
    FROM appointments a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN locations l ON l.id = a.location_id
    WHERE a.id = $1`, [id]);
  return result.rows[0] || null;
}

module.exports = { listClients, getClient, getClientAppointments, listServices, listStaff, listAppointments, getAppointment };
