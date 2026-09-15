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

function createWorkspaceCommunicationEvidenceService({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace communication evidence database is required');

  async function listForClient({ clientId, waId, limit, scope } = {}) {
    const id = positiveId(clientId);
    if (!id) return [];
    const safeLimit = boundedLimit(limit);
    const normalizedWaId = normalizeWaId(waId);
    const scoped = validClientScope(scope);
    const values = [id];
    let ownerParam = null;
    if (scoped && scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
      values.push(scopedPositiveId(scope.ownerStaffId));
      ownerParam = `$${values.length}`;
    }
    values.push(safeLimit);
    const limitParam = `$${values.length}`;
    const appointmentPredicate = scoped ? appointmentScopeSql('appointment_id', scope, ownerParam) : null;

    const deliveries = await db.query(
      `/* workspaceCommunicationEvidence:messageDeliveries */
       SELECT appointment_id, message_kind, status, claimed_at, sent_at, last_attempt_at, updated_at,
              template_name, provider_sent_at, provider_delivered_at,
              provider_read_at, provider_failed_at
         FROM customer_message_deliveries
        WHERE crm_v2_client_id=$1
          ${appointmentPredicate ? `AND appointment_id IS NOT NULL AND ${appointmentPredicate}` : ''}
        ORDER BY COALESCE(provider_read_at, provider_delivered_at, provider_failed_at,
                          provider_sent_at, sent_at, last_attempt_at, claimed_at) DESC
        LIMIT ${limitParam}`,
      values
    );

    const reschedules = await db.query(
      `/* workspaceCommunicationEvidence:reschedules */
       SELECT appointment_id, client_notified_at, client_notification_last_error,
              client_notification_claimed_at, client_notification_suppressed_at, updated_at
         FROM appointment_reschedule_requests
        WHERE crm_v2_client_id=$1
          ${appointmentPredicate ? `AND appointment_id IS NOT NULL AND ${appointmentPredicate}` : ''}
          AND (client_notified_at IS NOT NULL
            OR client_notification_last_error IS NOT NULL
            OR client_notification_claimed_at IS NOT NULL
            OR client_notification_suppressed_at IS NOT NULL)
        ORDER BY COALESCE(client_notified_at, client_notification_suppressed_at,
                          client_notification_claimed_at, updated_at) DESC
        LIMIT ${limitParam}`,
      values
    );

    let careRows = [];
    // Customer-care rows have no appointment relationship. They remain visible
    // to the clinic relationship, but never cross into a tenant client base.
    if (normalizedWaId && (!scoped || scope.kind === CLIENT_RELATIONSHIP_TYPES.CLINIC)) {
      const care = await db.query(
        `/* workspaceCommunicationEvidence:customerCare */
         SELECT event_type, sent_at
           FROM customer_care_delivery_log
          WHERE client_wa_id=$1
          ORDER BY sent_at DESC
          LIMIT $2`,
        [normalizedWaId, safeLimit]
      );
      careRows = care.rows || [];
    }

    return mergeEvidence([
      (deliveries.rows || []).map(messageDeliveryEntry),
      (reschedules.rows || []).map(rescheduleEntry),
      careRows.map(careDeliveryEntry),
    ], safeLimit);
  }

  function crossClientEntry(entry, row) {
    if (!entry) return null;
    const clientId = positiveId(row?.client_id);
    if (!clientId) return null;
    return {
      ...entry,
      clientId,
      clientName: String(row?.client_name || 'Unnamed client').trim() || 'Unnamed client',
      mobileLast4: String(row?.normalized_mobile || '').replace(/[^0-9]/g, '').slice(-4) || null,
    };
  }

  async function listRecent({ limit, scope } = {}) {
    const safeLimit = boundedLimit(limit);
    const scoped = validClientScope(scope);
    const values = [];
    let ownerParam = null;
    if (scoped && scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
      values.push(scopedPositiveId(scope.ownerStaffId));
      ownerParam = `$${values.length}`;
    }
    values.push(safeLimit);
    const limitParam = `$${values.length}`;
    const relationshipPredicate = scoped ? activeRelationshipSql('c.id', scope, ownerParam) : null;
    const deliveryAppointmentPredicate = scoped ? appointmentScopeSql('d.appointment_id', scope, ownerParam) : null;
    const rescheduleAppointmentPredicate = scoped ? appointmentScopeSql('r.appointment_id', scope, ownerParam) : null;

    const deliveries = await db.query(
      `/* workspaceCommunicationEvidence:recentMessageDeliveries */
       SELECT c.id AS client_id,c.name AS client_name,c.normalized_mobile,
              d.appointment_id,d.message_kind,d.status,d.claimed_at,d.sent_at,
              d.last_attempt_at,d.updated_at,d.template_name,d.provider_sent_at,
              d.provider_delivered_at,d.provider_read_at,d.provider_failed_at
         FROM customer_message_deliveries d
         JOIN crm_v2_clients c ON c.id=d.crm_v2_client_id
        WHERE c.status='active'
          ${relationshipPredicate ? `AND ${relationshipPredicate}` : ''}
          ${deliveryAppointmentPredicate ? `AND d.appointment_id IS NOT NULL AND ${deliveryAppointmentPredicate}` : ''}
        ORDER BY COALESCE(d.provider_read_at,d.provider_delivered_at,d.provider_failed_at,
                          d.provider_sent_at,d.sent_at,d.last_attempt_at,d.claimed_at,d.updated_at) DESC
        LIMIT ${limitParam}`,
      values
    );
    const reschedules = await db.query(
      `/* workspaceCommunicationEvidence:recentReschedules */
       SELECT c.id AS client_id,c.name AS client_name,c.normalized_mobile,
              r.appointment_id,r.client_notified_at,r.client_notification_last_error,
              r.client_notification_claimed_at,r.client_notification_suppressed_at,r.updated_at
         FROM appointment_reschedule_requests r
         JOIN crm_v2_clients c ON c.id=r.crm_v2_client_id
        WHERE c.status='active'
          ${relationshipPredicate ? `AND ${relationshipPredicate}` : ''}
          ${rescheduleAppointmentPredicate ? `AND r.appointment_id IS NOT NULL AND ${rescheduleAppointmentPredicate}` : ''}
          AND (r.client_notified_at IS NOT NULL OR r.client_notification_last_error IS NOT NULL
            OR r.client_notification_claimed_at IS NOT NULL OR r.client_notification_suppressed_at IS NOT NULL)
        ORDER BY COALESCE(r.client_notified_at,r.client_notification_suppressed_at,
                          r.client_notification_claimed_at,r.updated_at) DESC
        LIMIT ${limitParam}`,
      values
    );
    let careRows = [];
    if (!scoped || scope.kind === CLIENT_RELATIONSHIP_TYPES.CLINIC) {
      const careValues = [];
      const careWhere = ["c.status='active'"];
      if (scoped) careWhere.push(activeRelationshipSql('c.id', scope, null));
      careValues.push(safeLimit);
      const care = await db.query(
        `/* workspaceCommunicationEvidence:recentCustomerCare */
         SELECT c.id AS client_id,c.name AS client_name,c.normalized_mobile,
                care.event_type,care.sent_at
           FROM customer_care_delivery_log care
           JOIN crm_v2_clients c ON c.normalized_mobile=care.client_wa_id
          WHERE ${careWhere.join(' AND ')}
          ORDER BY care.sent_at DESC
          LIMIT $1`,
        careValues
      );
      careRows = care.rows || [];
    }
    return mergeEvidence([
      (deliveries.rows || []).map(row => crossClientEntry(messageDeliveryEntry(row), row)),
      (reschedules.rows || []).map(row => crossClientEntry(rescheduleEntry(row), row)),
      careRows.map(row => crossClientEntry(careDeliveryEntry(row), row)),
    ], safeLimit);
  }

  return { listForClient, listRecent };
}

const service = createWorkspaceCommunicationEvidenceService();

module.exports = {
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
