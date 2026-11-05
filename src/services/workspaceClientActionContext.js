'use strict';

// Client-specific financial actions require both their financial capability and
// the same clinic relationship/lookup boundary used by the client record.
async function requireClientActionContext(db, adminId, clientId, { lock = false } = {}) {
  const id = Number(clientId);
  const deny = (message, status = 403) => Object.assign(new Error(message), { code: 'WORKSPACE_CLIENT_ACTION_FORBIDDEN', httpStatus: status });
  if (!Number.isSafeInteger(id) || id <= 0) throw deny('Choose a valid client record.', 400);
  const principals = await db.query(`/* clientAction:principal */
    SELECT a.id,a.staff_id,a.display_name,a.permissions,a.business_role,a.active AS admin_active,s.status AS staff_status
    FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id
    WHERE a.id=$1 AND a.active=TRUE ${lock ? 'FOR SHARE OF a' : ''}`, [adminId]);
  const { evaluateClientReadAuthority } = require('./workspaceClients');
  const authority = evaluateClientReadAuthority(principals.rows);
  if (!authority || authority.clientScope.kind !== 'clinic') throw deny('Your access does not include financial actions for this client.');
  const result = await db.query(`/* clientAction:client */
    SELECT c.id,c.name,c.normalized_mobile,c.mobile_verified_at,c.updated_at
    FROM crm_v2_clients c JOIN crm_v2_client_relationships r ON r.client_id=c.id
    WHERE c.id=$1 AND c.status='active' AND r.status='active'
      AND r.relationship_type='clinic' AND r.owner_staff_id IS NULL
    ${lock ? 'FOR SHARE OF c,r' : ''}`, [id]);
  if (result.rows.length !== 1) throw deny('This active clinic client is no longer available. Refresh the client record.', 404);
  return result.rows[0];
}
module.exports = { requireClientActionContext };
