'use strict';

const UNKNOWN = Object.freeze({ usage: 'Not yet confirmed', phoneAlerts: 'Unknown' });

function projectAppStatus(row) {
  if (!row) return { ...UNKNOWN };
  return {
    usage: row.used_before === true ? 'Used before' : 'Not yet confirmed',
    phoneAlerts: row.alerts_enabled === true ? 'Enabled'
      : row.active_setup === false ? 'Setup needed' : 'Unknown',
  };
}

// Only boolean evidence leaves this read: no session, device, key or endpoint data.
// Tenant/private profiles do not expose the client's clinic account activity.
async function readClientAppStatus({ db, clientId, scope } = {}) {
  if (scope?.kind !== 'clinic' || scope.ownerStaffId != null) return { ...UNKNOWN };
  try {
    const result = await db.query(`/* workspaceClientAppStatus:clinic */
      SELECT EXISTS (SELECT 1 FROM client_browser_sessions s
               WHERE s.crm_v2_client_id=c.id AND s.last_used_at IS NOT NULL
                 AND s.last_used_at>=s.issued_at AND s.last_used_at<=NOW()
                 AND s.last_used_at<s.expires_at
                 AND (s.revoked_at IS NULL OR s.last_used_at<=s.revoked_at)) AS used_before,
             EXISTS (SELECT 1 FROM my_shiloh_push_subscriptions p
               WHERE p.crm_v2_client_id=c.id AND p.enabled=TRUE AND p.revoked_at IS NULL) AS active_setup,
             EXISTS (SELECT 1 FROM my_shiloh_push_subscriptions p
               WHERE p.crm_v2_client_id=c.id AND p.enabled=TRUE AND p.revoked_at IS NULL
                 AND p.last_push_error IS NULL AND p.endpoint ~ '^https://'
                 AND BTRIM(p.p256dh)<>'' AND BTRIM(p.auth)<>'') AS alerts_enabled
        FROM crm_v2_clients c
       WHERE c.id=$1 AND c.status='active'
         AND EXISTS (SELECT 1 FROM crm_v2_client_relationships rel
           WHERE rel.client_id=c.id AND rel.status='active'
             AND rel.relationship_type='clinic' AND rel.owner_staff_id IS NULL)`, [clientId]);
    return projectAppStatus(result.rows[0]);
  } catch (_) {
    return { ...UNKNOWN };
  }
}

module.exports = { projectAppStatus, readClientAppStatus };
