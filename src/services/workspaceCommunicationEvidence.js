const { pool } = require('../db/pool');
const {
  CLIENT_RELATIONSHIP_TYPES,
  validClientScope,
  positiveId: scopedPositiveId,
} = require('./clientRelationshipScope');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function boundedLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeWaId(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return /^27\d{9}$/.test(digits) ? digits : null;
}

function humanize(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Shiloh notification';
  return text.replace(/\b\w/g, character => character.toUpperCase());
}

const INTENT_LABELS = Object.freeze({
  booking_confirmation: 'Booking confirmation',
  initial_booking_confirmation: 'Booking confirmation',
  booking_confirmation_v2: 'Booking confirmation',
  booking_update: 'Booking update',
  cancellation_confirmation: 'Cancellation confirmation',
  appointment_reminder: 'Appointment reminder',
  appointment_reminder_actions: 'Appointment reminder',
  appointment_followup: 'Appointment follow-up',
  appointment_followup_v2: 'Appointment follow-up',
  birthday: 'Birthday message',
  birthday_v2: 'Birthday message',
  reschedule_confirmation: 'Reschedule confirmation',
});

function intentLabel(value) {
  const key = String(value || '').trim().toLowerCase();
  return INTENT_LABELS[key] || humanize(key);
}

function messageDeliveryEntry(row) {
  let status = null;
  let statusLabel = null;
  let occurredAt = null;

  if (row?.provider_read_at) {
    status = 'read'; statusLabel = 'Read on WhatsApp'; occurredAt = row.provider_read_at;
  } else if (row?.provider_delivered_at) {
    status = 'delivered'; statusLabel = 'Delivered on WhatsApp'; occurredAt = row.provider_delivered_at;
  } else if (row?.provider_failed_at) {
    status = 'failed'; statusLabel = 'WhatsApp delivery failed'; occurredAt = row.provider_failed_at;
  } else if (row?.provider_sent_at) {
    status = 'provider_sent'; statusLabel = 'Sent to WhatsApp'; occurredAt = row.provider_sent_at;
  } else {
    const deliveryStatus = String(row?.status || '').trim().toLowerCase();
    if (deliveryStatus === 'sent') {
      status = 'sent'; statusLabel = 'Sent by Shiloh'; occurredAt = row?.sent_at;
    } else if (deliveryStatus === 'failed') {
      status = 'failed'; statusLabel = 'Send attempt failed'; occurredAt = row?.last_attempt_at || row?.claimed_at;
    } else if (deliveryStatus === 'uncertain') {
      status = 'uncertain'; statusLabel = 'Delivery uncertain'; occurredAt = row?.last_attempt_at || row?.claimed_at;
    } else if (['pending', 'queued', 'sending'].includes(deliveryStatus) || (!deliveryStatus && row?.claimed_at)) {
      status = 'pending'; statusLabel = 'Pending'; occurredAt = row?.claimed_at || row?.updated_at;
    } else {
      status = 'unknown'; statusLabel = 'Unknown'; occurredAt = row?.updated_at || row?.last_attempt_at || row?.claimed_at;
    }
  }

  if (!occurredAt) return null;
  return {
    intent: String(row?.message_kind || 'notification'),
    label: intentLabel(row?.message_kind),
    status,
    statusLabel,
    occurredAt,
    appointmentId: positiveId(row?.appointment_id),
    templateName: String(row?.template_name || '').trim() || null,
  };
}

function careDeliveryEntry(row) {
  if (!row?.sent_at) return null;
  return {
    intent: String(row?.event_type || 'customer_care'),
    label: intentLabel(row?.event_type),
    status: 'sent',
    statusLabel: 'Sent by Shiloh',
    occurredAt: row.sent_at,
    appointmentId: null,
    templateName: null,
  };
}

function rescheduleEntry(row) {
  let status = null;
  let statusLabel = null;
  let occurredAt = null;
  if (row?.client_notified_at) {
    status = 'sent'; statusLabel = 'Sent by Shiloh'; occurredAt = row.client_notified_at;
  } else if (row?.client_notification_suppressed_at) {
    status = 'suppressed'; statusLabel = 'Suppressed'; occurredAt = row.client_notification_suppressed_at;
  } else if (row?.client_notification_last_error) {
    status = 'failed'; statusLabel = 'Send attempt failed'; occurredAt = row.client_notification_claimed_at || row.updated_at;
  } else if (row?.client_notification_claimed_at) {
    status = 'pending'; statusLabel = 'Pending'; occurredAt = row.client_notification_claimed_at;
  }
  if (!occurredAt) return null;
  return {
    intent: 'reschedule_confirmation',
    label: 'Reschedule confirmation',
    status,
    statusLabel,
    occurredAt,
    appointmentId: positiveId(row?.appointment_id),
    templateName: null,
  };
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeEvidence(groups, limit) {
  const seen = new Set();
  return groups.flat().filter(Boolean).sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt)).filter(entry => {
    const key = `${entry.clientId || ''}|${entry.intent}|${entry.appointmentId || ''}|${entry.status}|${new Date(entry.occurredAt).toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function appointmentScopeSql(appointmentExpression, scope, ownerParam) {
  if (!validClientScope(scope)) return null;
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    return `EXISTS (
      SELECT 1
        FROM appointment_services scoped_aps
        JOIN service_visibility_policies scoped_visibility
          ON scoped_visibility.service_id=scoped_aps.service_id
         AND scoped_visibility.visibility_scope='tenant_private'
       WHERE scoped_aps.appointment_id=${appointmentExpression}
         AND scoped_visibility.owner_staff_id=${ownerParam}
    )`;
  }
  return `(
    NOT EXISTS (
      SELECT 1 FROM appointment_services scoped_any
       WHERE scoped_any.appointment_id=${appointmentExpression}
    )
    OR EXISTS (
      SELECT 1
        FROM appointment_services scoped_aps
        LEFT JOIN service_visibility_policies scoped_visibility
          ON scoped_visibility.service_id=scoped_aps.service_id
         AND scoped_visibility.visibility_scope='tenant_private'
       WHERE scoped_aps.appointment_id=${appointmentExpression}
         AND scoped_visibility.service_id IS NULL
    )
  )`;
}

function activeRelationshipSql(clientExpression, scope, ownerParam) {
  if (!validClientScope(scope)) return null;
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    return `EXISTS (
      SELECT 1 FROM crm_v2_client_relationships scoped_relationship
       WHERE scoped_relationship.client_id=${clientExpression}
         AND scoped_relationship.relationship_type='tenant_staff'
         AND scoped_relationship.owner_staff_id=${ownerParam}
         AND scoped_relationship.status='active'
    )`;
  }
  return `EXISTS (
    SELECT 1 FROM crm_v2_client_relationships scoped_relationship
     WHERE scoped_relationship.client_id=${clientExpression}
       AND scoped_relationship.relationship_type='clinic'
       AND scoped_relationship.owner_staff_id IS NULL
       AND scoped_relationship.status='active'
  )`;
}

function appNotificationEntry(row) {
  if (!row?.created_at) return null;
  return {
    intent: String(row.category || 'system'), label: String(row.title || 'My Shiloh update'),
    status: 'available', statusLabel: 'Available in My Shiloh', occurredAt: row.created_at,
    appointmentId: positiveId(row.appointment_id), templateName: null,
    clientId: positiveId(row.client_id), clientName: String(row.client_name || 'Client'),
  };
}

function createWorkspaceCommunicationEvidenceService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace communication evidence database is required');
  async function read({ clientId, limit, scope } = {}) {
    if (!validClientScope(scope)) throw new Error('A valid client relationship scope is required');
    const values = [];
    const where = ["c.status='active'", 'n.expires_at>NOW()'];
    if (clientId != null) { values.push(clientId); where.push(`c.id=$${values.length}`); }
    let ownerParam = null;
    if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
      values.push(scopedPositiveId(scope.ownerStaffId)); ownerParam = `$${values.length}`;
    }
    where.push(activeRelationshipSql('c.id', scope, ownerParam));
    const appointmentPredicate = appointmentScopeSql('a.id', scope, ownerParam);
    // Only recognized appointment event keys can establish appointment scope.
    // Shared-client payments, forms and rewards must not leak to tenant staff.
    where.push(scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF
      ? `a.id IS NOT NULL AND ${appointmentPredicate}`
      : `(linked.appointment_id IS NULL OR (a.id IS NOT NULL AND ${appointmentPredicate}))`);
    values.push(boundedLimit(limit));
    const result = await db.query(`/* workspaceCommunicationEvidence:myShiloh */
      SELECT n.category,n.title,n.created_at,a.id AS appointment_id,c.id AS client_id,c.name AS client_name
        FROM my_shiloh_push_notifications n JOIN crm_v2_clients c ON c.id=n.crm_v2_client_id
        CROSS JOIN LATERAL (SELECT CASE
          WHEN n.event_key ~ '^appointment-[a-z_-]+:[1-9][0-9]{0,9}:'
            OR n.event_key ~ '^booking-proposal:[1-9][0-9]{0,9}:'
          THEN split_part(n.event_key,':',2)::bigint ELSE NULL END AS appointment_id) linked
        LEFT JOIN appointments a ON a.id=linked.appointment_id AND a.crm_v2_client_id=c.id AND a.client_id IS NULL
       WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC,n.id DESC LIMIT $${values.length}`, values);
    return result.rows.map(appNotificationEntry).filter(Boolean);
  }
  async function listForClient({ clientId, limit, scope } = {}) {
    const id = positiveId(clientId);
    return id ? read({ clientId: id, limit, scope }) : [];
  }
  async function listRecent({ limit, scope } = {}) { return read({ limit, scope }); }
  return { listForClient, listRecent };
}

const service = createWorkspaceCommunicationEvidenceService();

module.exports = {
  appNotificationEntry,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  boundedLimit,
  normalizeWaId,
  humanize,
  intentLabel,
  messageDeliveryEntry,
  careDeliveryEntry,
  rescheduleEntry,
  mergeEvidence,
  createWorkspaceCommunicationEvidenceService,
  ...service,
};
