'use strict';

const { pool } = require('../db/pool');
const { CLIENT_RELATIONSHIP_TYPES, appointmentScopePredicate } = require('./clientRelationshipScope');

const COORDINATOR_ROLES = new Set(['owner', 'business_admin', 'booking_operator']);

function canReviewChangeDelivery(authority, notificationAuthority) {
  return Boolean(notificationAuthority && COORDINATOR_ROLES.has(authority?.businessRole)
    && authority?.clientScope?.kind === CLIENT_RELATIONSHIP_TYPES.CLINIC);
}

function projectChangeDelivery(row) {
  const status = String(row.status || '');
  const kind = String(row.change_kind || '');
  const label = kind === 'cancellation' ? 'Cancellation update' : 'Appointment update';
  return {
    id: Number(row.audit_event_id),
    appointmentId: Number(row.appointment_id),
    clientId: Number(row.client_id),
    clientName: String(row.client_name || 'Client'),
    label,
    status: status === 'sending' ? 'uncertain' : status === 'failed' ? 'failed' : 'waiting',
    statusLabel: status === 'sending' ? 'Send status uncertain' : status === 'failed' ? 'Send attempt failed' : 'Waiting for channel',
    updatedAt: row.updated_at,
    nextAction: status === 'sending'
      ? 'Check the client communication record before any new send. WhatsApp may have accepted the previous attempt.'
      : status === 'failed'
        ? 'Shiloh retains this update for retry. Review the client record and contact the client directly if timely notice matters.'
        : 'The approved WhatsApp template is not ready. Review the client record and contact the client directly if timely notice matters.',
  };
}

function createWorkspaceChangeDeliveryAttentionService({ db = pool } = {}) {
  async function list({ authority, notificationAuthority } = {}) {
    if (!canReviewChangeDelivery(authority, notificationAuthority)) return [];
    const scope = appointmentScopePredicate('a.id', authority.clientScope, 1);
    const result = await db.query(`/* workspaceChangeDeliveryAttention:clinic */
      SELECT n.audit_event_id,n.appointment_id,n.change_kind,n.status,n.updated_at,
             c.id AS client_id,c.name AS client_name
        FROM customer_change_notifications n
        JOIN appointments a ON a.id=n.appointment_id AND a.crm_v2_client_id IS NOT NULL AND a.client_id IS NULL
        JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
       WHERE n.created_at>=NOW()-INTERVAL '30 days'
         AND ((n.status='failed')
           OR (n.status='pending' AND n.last_error IS NOT NULL)
           OR (n.status='sending' AND n.updated_at<NOW()-INTERVAL '15 minutes'))
         AND EXISTS (SELECT 1 FROM crm_v2_client_relationships rel
           WHERE rel.client_id=c.id AND rel.relationship_type='clinic'
             AND rel.owner_staff_id IS NULL AND rel.status='active')
         AND ${scope.sql}
       ORDER BY n.updated_at DESC,n.audit_event_id DESC LIMIT 30`, scope.values);
    return result.rows.map(projectChangeDelivery);
  }
  return { list };
}

module.exports = { canReviewChangeDelivery, projectChangeDelivery, createWorkspaceChangeDeliveryAttentionService };
