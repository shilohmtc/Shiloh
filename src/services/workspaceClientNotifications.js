const { pool } = require('../db/pool');
const {
  sendCustomerBookingConfirmationForAppointment,
  providerOutcome,
  recoveryState,
} = require('./customerBookingConfirmation');
const { assertTemplateSendAllowed } = require('./metaTemplateContracts');

const CLIENT_LOOKUP_CAPABILITY = 'client:lookup';
const CLIENT_NOTIFY_CAPABILITY = 'client:notify';
const WORKSPACE_CLIENT_NOTIFY_PROVIDER_GATE = 'SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY';

class WorkspaceClientNotificationError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceClientNotificationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function evaluateClientNotificationAuthority(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const principal = rows[0];
  const adminId = positiveId(principal.id);
  if (!adminId || principal.admin_active !== true) return null;
  if (principal.staff_id != null && principal.staff_status !== 'active') return null;
  const permissions = permissionSet(principal.permissions);
  if (permissions[CLIENT_LOOKUP_CAPABILITY] !== true || permissions[CLIENT_NOTIFY_CAPABILITY] !== true) return null;
  return {
    key: 'workspace_client_notify_v1',
    operatorAdminId: adminId,
    displayName: String(principal.display_name || 'Staff').trim() || 'Staff',
    capability: CLIENT_NOTIFY_CAPABILITY,
    requiredVisibilityCapability: CLIENT_LOOKUP_CAPABILITY,
  };
}

function channelReady(env = process.env) {
  // Production WhatsApp sends are retired; injected environments retain historical test fixtures.
  if (env === process.env) return false;
  return String(env[WORKSPACE_CLIENT_NOTIFY_PROVIDER_GATE] || '').trim().toLowerCase() === 'true'
    && Boolean(String(env.PHONE_NUMBER_ID || '').trim())
    && Boolean(String(env.WHATSAPP_TOKEN || '').trim())
    && Boolean(String(env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE || '').trim());
}

async function defaultProviderGuard(env = process.env) {
  const template = String(env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE || '').trim();
  if (!template) throw new Error('Booking confirmation template is not configured');
  return assertTemplateSendAllowed(template, String(env.WHATSAPP_TEMPLATE_LANGUAGE || 'en').trim() || 'en');
}

function validCrmV2Mobile(value) {
  return /^27[678][0-9]{8}$/.test(String(value || '').trim());
}

function safeProviderFailureExplanation(providerError) {
  const code = providerError && typeof providerError === 'object' && !Array.isArray(providerError)
    ? String(providerError.code ?? '').trim()
    : '';
  if (code === '131042') {
    return 'WhatsApp rejected this delivery because the business account has a payment or eligibility issue.';
  }
  if (code === '131026') {
    return 'WhatsApp could not deliver this message to the recipient.';
  }
  return 'WhatsApp reported a delivery failure. No additional safe detail is available.';
}

function deliveryExplanation(row, outcome) {
  if (outcome === 'failed') return safeProviderFailureExplanation(row?.provider_error);
  if (outcome === 'uncertain') return 'Shiloh cannot confirm whether WhatsApp accepted or delivered this message.';
  if (outcome === 'pending' || outcome === 'sending') return 'The booking confirmation has not yet reached a final delivery state.';
  if (outcome === 'not_sent') return 'No booking confirmation delivery has been recorded.';
  return 'The latest recorded WhatsApp delivery evidence is shown above.';
}

function confirmationProjection(row, now = new Date()) {
  if (!row?.appointment_id) return { status: 'not_sent', statusLabel: 'Not sent', lastEvidenceAt: null, recoverable: false };
  const outcome = row.already_sent === true && !row.delivery_status ? 'sent' : providerOutcome({
    status: row.delivery_status,
    provider_sent_at: row.provider_sent_at,
    provider_delivered_at: row.provider_delivered_at,
    provider_read_at: row.provider_read_at,
    provider_failed_at: row.provider_failed_at,
  });
  const recovery = row.already_sent === true && !row.delivery_status
    ? { recoverable: false, reason: 'already_sent' }
    : recoveryState(row.delivery_status ? {
    status: row.delivery_status,
    claimed_at: row.claimed_at,
    updated_at: row.delivery_updated_at,
    last_attempt_at: row.last_attempt_at,
    provider_sent_at: row.provider_sent_at,
    provider_delivered_at: row.provider_delivered_at,
    provider_read_at: row.provider_read_at,
    provider_failed_at: row.provider_failed_at,
  } : null, now);
  const labels = {
    read: 'Read on WhatsApp', delivered: 'Delivered on WhatsApp', provider_sent: 'Sent to WhatsApp',
    sent: 'Sent by Shiloh', failed: 'Failed', uncertain: 'Delivery uncertain',
    pending: 'Queued / pending', sending: 'Sending', not_sent: 'Not sent',
  };
  const evidenceTimes = outcome === 'read' ? [row.provider_read_at]
    : outcome === 'delivered' ? [row.provider_delivered_at]
      : outcome === 'provider_sent' ? [row.provider_sent_at]
        : outcome === 'failed' ? [row.provider_failed_at, row.last_attempt_at]
          : outcome === 'sent' ? [row.sent_at]
            : [row.last_attempt_at, row.claimed_at, row.delivery_updated_at];
  return {
    status: outcome,
    statusLabel: labels[outcome] || 'Unknown / uncertain',
    lastEvidenceAt: evidenceTimes.find(Boolean) || null,
    deliveryExplanation: deliveryExplanation(row, outcome),
    recoverable: recovery.recoverable,
    recoveryReason: recovery.reason,
  };
}

function previewState(row, env = process.env, now = new Date()) {
  if (!row) return { canSend: false, reason: 'client_not_found' };
  if (row.client_status !== 'active') return { canSend: false, reason: 'client_inactive' };
  if (!validCrmV2Mobile(row.normalized_mobile)) return { canSend: false, reason: 'recipient_missing' };
  if (!row.appointment_id) return { canSend: false, reason: 'no_upcoming_appointment' };
  if (!['scheduled', 'confirmed'].includes(String(row.appointment_status || ''))) return { canSend: false, reason: 'appointment_not_eligible' };
  if (new Date(row.starts_at).getTime() <= now.getTime()) return { canSend: false, reason: 'appointment_not_eligible' };
  if (row.delivery_recipient_mobile && String(row.delivery_recipient_mobile) !== String(row.normalized_mobile)) {
    return { canSend: false, reason: 'recipient_changed' };
  }
  const confirmation = confirmationProjection(row, now);
  if (!confirmation.recoverable) {
    return { canSend: false, reason: confirmation.recoveryReason === 'already_in_progress' ? 'already_in_progress' : 'already_sent', confirmation };
  }
  if (!channelReady(env)) return { canSend: false, reason: 'channel_unavailable' };
  return { canSend: true, reason: null, confirmation };
}

function publicReason(reason) {
  switch (reason) {
    case 'recipient_missing': return 'This client does not have a valid canonical WhatsApp/mobile recipient.';
    case 'no_upcoming_appointment': return 'There is no upcoming Shiloh-owned appointment available for a booking confirmation.';
    case 'already_sent': return 'A booking confirmation is already recorded as sent for this appointment.';
    case 'already_in_progress': return 'This booking confirmation is already queued or being sent.';
    case 'recipient_changed': return 'The canonical client mobile changed after this confirmation obligation was created. Review the client before sending.';
    case 'appointment_not_eligible': return 'This appointment is no longer eligible for a booking confirmation.';
    case 'evidence_changed': return 'The booking-confirmation evidence changed before recovery. Refresh and review it again.';
    case 'channel_unavailable': return 'Automated WhatsApp booking confirmations are retired. Review the appointment in Workspace and contact the client through an approved Shiloh channel if needed.';
    case 'provider_unavailable': return 'The approved Shiloh booking-confirmation provider contract is not currently ready. Nothing can be sent.';
    case 'client_inactive': return 'This canonical client is not active.';
    case 'practitioner_approval_required': return 'The appointment still requires practitioner approval before a confirmation can be sent.';
    case 'appointment_not_found': return 'The appointment is no longer available.';
    default: return 'The booking confirmation was not sent.';
  }
}

function recoveryExplanation(state = {}) {
  if (state.canSend === true) return 'Retry is available through Shiloh’s existing booking-confirmation channel.';
  return publicReason(state.reason);
}

function createWorkspaceClientNotificationService({
  db = pool,
  env = process.env,
  sender = sendCustomerBookingConfirmationForAppointment,
  providerGuard = defaultProviderGuard,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace client notification database is required');
  if (typeof sender !== 'function') throw new Error('Workspace client notification sender is required');
  if (typeof providerGuard !== 'function') throw new Error('Workspace client notification provider guard is required');

  async function resolveAccess(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* workspaceClientNotifications:principal */
       SELECT a.id, a.staff_id, a.display_name, a.permissions,
              a.active AS admin_active, s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1
          AND a.active=TRUE
        LIMIT 2`,
      [id]
    );
    return evaluateClientNotificationAuthority(result.rows);
  }

  async function requireAccess(adminId) {
    const authority = await resolveAccess(adminId);
    if (!authority) {
      throw new WorkspaceClientNotificationError(
        'WORKSPACE_CLIENT_NOTIFY_FORBIDDEN',
        'Current staff authority does not permit client notifications.',
        403
      );
    }
    return authority;
  }

  async function loadPreviewRow(clientId) {
    const result = await db.query(
      `/* workspaceClientNotifications:preview */
       SELECT c.id AS client_id, c.name AS client_name, c.normalized_mobile,
              c.mobile_verified_at, c.status AS client_status,
              a.id AS appointment_id, a.starts_at, a.ends_at,
              a.status AS appointment_status, a.source, l.name AS location_name,
              COALESCE((SELECT string_agg(aps.service_name_snapshot, ' + ' ORDER BY aps.position)
                          FROM appointment_services aps WHERE aps.appointment_id=a.id), a.title, 'Shiloh appointment') AS service_name,
              COALESCE((SELECT string_agg(ast.staff_name_snapshot, ' + ' ORDER BY ast.position)
                          FROM appointment_staff ast WHERE ast.appointment_id=a.id), 'Shiloh practitioner') AS staff_name,
              delivery.status AS delivery_status, delivery.claimed_at, delivery.sent_at,
              delivery.updated_at AS delivery_updated_at, delivery.last_attempt_at,
              delivery.recipient_mobile AS delivery_recipient_mobile,
              delivery.provider_sent_at, delivery.provider_delivered_at,
              delivery.provider_read_at, delivery.provider_failed_at,
              delivery.provider_error,
              CASE WHEN a.id IS NULL THEN FALSE ELSE EXISTS(
                SELECT 1 FROM crm_audit_events e
                 WHERE e.action='customer.booking_confirmation_sent'
                   AND e.entity_type='appointment'
                   AND e.entity_id=a.id
              ) END AS already_sent
         FROM crm_v2_clients c
         LEFT JOIN LATERAL (
           SELECT candidate.*
             FROM appointments candidate
            WHERE candidate.crm_v2_client_id=c.id
              AND candidate.client_id IS NULL
              AND candidate.status <> 'cancelled'
              AND candidate.starts_at >= NOW()
            ORDER BY candidate.starts_at ASC, candidate.id ASC
            LIMIT 1
         ) a ON TRUE
         LEFT JOIN locations l ON l.id=a.location_id
         LEFT JOIN customer_message_deliveries delivery
           ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
        WHERE c.id=$1
        LIMIT 1`,
      [clientId]
    );
    return result.rows[0] || null;
  }

  async function getPreview({ adminId, clientId } = {}) {
    const authority = await requireAccess(adminId);
    const id = positiveId(clientId);
    if (!id) {
      throw new WorkspaceClientNotificationError(
        'WORKSPACE_CLIENT_NOTIFY_INVALID_CLIENT',
        'Client reference is invalid.',
        400
      );
    }
    const row = await loadPreviewRow(id);
    if (!row) {
      throw new WorkspaceClientNotificationError(
        'WORKSPACE_CLIENT_NOTIFY_CLIENT_NOT_FOUND',
        'Canonical client was not found.',
        404
      );
    }
    let state = previewState(row, env);
    let providerReady = false;
    if (state.canSend) {
      try {
        await providerGuard(env);
        providerReady = true;
      } catch (_error) {
        state = { canSend: false, reason: 'provider_unavailable' };
      }
    }
    return {
      authority,
      client: {
        id: Number(row.client_id),
        name: String(row.client_name || 'Unnamed client'),
        normalizedMobile: String(row.normalized_mobile || ''),
        mobileVerifiedAt: row.mobile_verified_at || null,
        status: row.client_status,
      },
      appointment: row.appointment_id ? {
        id: Number(row.appointment_id),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.appointment_status,
        source: row.source,
        locationName: row.location_name || 'Shiloh',
        serviceName: row.service_name || 'Shiloh appointment',
        staffName: row.staff_name || 'Shiloh practitioner',
      } : null,
      alreadySent: row.already_sent === true,
      confirmation: state.confirmation || confirmationProjection(row),
      channelReady: channelReady(env),
      providerReady,
      canSend: state.canSend,
      reason: state.reason,
      reasonMessage: state.reason ? publicReason(state.reason) : null,
      recoveryExplanation: recoveryExplanation(state),
    };
  }

  async function loadAppointmentRow(appointmentId) {
    const result = await db.query(
      `/* workspaceClientNotifications:appointmentConfirmation */
       SELECT c.id AS client_id,c.name AS client_name,c.normalized_mobile,
              c.mobile_verified_at,c.status AS client_status,
              a.id AS appointment_id,a.starts_at,a.ends_at,a.status AS appointment_status,a.source,
              l.name AS location_name,
              COALESCE((SELECT string_agg(aps.service_name_snapshot, ' + ' ORDER BY aps.position)
                          FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
              COALESCE((SELECT string_agg(ast.staff_name_snapshot, ' + ' ORDER BY ast.position)
                          FROM appointment_staff ast WHERE ast.appointment_id=a.id),'Shiloh practitioner') AS staff_name,
              delivery.status AS delivery_status,delivery.claimed_at,delivery.sent_at,
              delivery.updated_at AS delivery_updated_at,delivery.last_attempt_at,
              delivery.recipient_mobile AS delivery_recipient_mobile,
              delivery.provider_sent_at,delivery.provider_delivered_at,
              delivery.provider_read_at,delivery.provider_failed_at,
              delivery.provider_error,
              EXISTS(SELECT 1 FROM crm_audit_events audit
                      WHERE audit.action='customer.booking_confirmation_sent'
                        AND audit.entity_type='appointment' AND audit.entity_id=a.id) AS already_sent
         FROM appointments a
         JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
         LEFT JOIN locations l ON l.id=a.location_id
         LEFT JOIN customer_message_deliveries delivery
           ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
        WHERE a.id=$1 AND a.client_id IS NULL
        LIMIT 1`,
      [appointmentId]
    );
    return result.rows[0] || null;
  }

  function publicAppointmentConfirmation(row, now = new Date()) {
    if (!row) return null;
    const state = previewState(row, env, now);
    const confirmation = state.confirmation || confirmationProjection(row, now);
    return {
      client: {
        id: Number(row.client_id),
        name: String(row.client_name || 'Unnamed client'),
        mobileLast4: String(row.normalized_mobile || '').slice(-4),
        status: row.client_status,
      },
      appointment: {
        id: Number(row.appointment_id), startsAt: row.starts_at, endsAt: row.ends_at,
        status: row.appointment_status, source: row.source,
        locationName: row.location_name || 'Shiloh', serviceName: row.service_name || 'Shiloh appointment',
        staffName: row.staff_name || 'Shiloh practitioner',
      },
      confirmation,
      canSend: state.canSend,
      canRecover: state.canSend,
      actionLabel: confirmation.status === 'not_sent' ? 'Send booking confirmation' : 'Re-send booking confirmation',
      reason: state.reason,
      reasonMessage: state.reason ? publicReason(state.reason) : null,
      recoveryExplanation: recoveryExplanation(state),
    };
  }

  async function getAppointmentConfirmation({ adminId, appointmentId, now = new Date() } = {}) {
    const authority = await requireAccess(adminId);
    const id = positiveId(appointmentId);
    if (!id) throw new WorkspaceClientNotificationError('WORKSPACE_CLIENT_NOTIFY_INVALID_APPOINTMENT', 'Appointment reference is invalid.', 400);
    const row = await loadAppointmentRow(id);
    if (!row) throw new WorkspaceClientNotificationError('WORKSPACE_CLIENT_NOTIFY_APPOINTMENT_NOT_FOUND', 'Appointment was not found in canonical Workspace CRM.', 404);
    const preview = publicAppointmentConfirmation(row, now);
    if (preview.canSend) {
      try {
        await providerGuard(env);
      } catch (_error) {
        preview.canSend = false;
        preview.canRecover = false;
        preview.reason = 'provider_unavailable';
        preview.reasonMessage = publicReason('provider_unavailable');
        preview.recoveryExplanation = recoveryExplanation({ canSend: false, reason: 'provider_unavailable' });
      }
    }
    return { authority, ...preview };
  }

  async function listBookingConfirmationExceptions({ adminId, now = new Date() } = {}) {
    const authority = await requireAccess(adminId);
    const result = await db.query(
      `/* workspaceClientNotifications:exceptions */
       SELECT c.id AS client_id,c.name AS client_name,c.normalized_mobile,c.mobile_verified_at,c.status AS client_status,
              a.id AS appointment_id,a.starts_at,a.ends_at,a.status AS appointment_status,a.source,l.name AS location_name,
              COALESCE((SELECT string_agg(aps.service_name_snapshot, ' + ' ORDER BY aps.position)
                          FROM appointment_services aps WHERE aps.appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
              COALESCE((SELECT string_agg(ast.staff_name_snapshot, ' + ' ORDER BY ast.position)
                          FROM appointment_staff ast WHERE ast.appointment_id=a.id),'Shiloh practitioner') AS staff_name,
              delivery.status AS delivery_status,delivery.claimed_at,delivery.sent_at,
              delivery.updated_at AS delivery_updated_at,delivery.last_attempt_at,
              delivery.recipient_mobile AS delivery_recipient_mobile,
              delivery.provider_sent_at,delivery.provider_delivered_at,
              delivery.provider_read_at,delivery.provider_failed_at,
              delivery.provider_error,
              EXISTS(SELECT 1 FROM crm_audit_events audit
                      WHERE audit.action='customer.booking_confirmation_sent'
                        AND audit.entity_type='appointment' AND audit.entity_id=a.id) AS already_sent
         FROM appointments a
         JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
         LEFT JOIN locations l ON l.id=a.location_id
         LEFT JOIN customer_message_deliveries delivery
           ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
        WHERE a.client_id IS NULL AND a.source='shiloh_calendar'
          AND a.created_at>=NOW()-INTERVAL '30 days'
          AND a.starts_at>NOW() AND a.status IN ('scheduled','confirmed')
        ORDER BY a.starts_at,a.id
        LIMIT 100`
    );
    let providerReady = true;
    try { await providerGuard(env); } catch (_error) { providerReady = false; }
    const exceptions = (result.rows || []).map(row => {
      const item = publicAppointmentConfirmation(row, now);
      if (item?.canRecover && !providerReady) {
        item.canSend = false;
        item.canRecover = false;
        item.reason = 'provider_unavailable';
        item.reasonMessage = publicReason('provider_unavailable');
        item.recoveryExplanation = recoveryExplanation({ canSend: false, reason: 'provider_unavailable' });
      }
      return item;
    })
      .filter(item => item && !['read', 'delivered', 'provider_sent', 'sent'].includes(item.confirmation.status));
    return { authority, exceptions, generatedAt: now.toISOString() };
  }

  async function sendBookingConfirmation({ adminId, clientId, appointmentId } = {}) {
    const preview = appointmentId != null
      ? await getAppointmentConfirmation({ adminId, appointmentId })
      : await getPreview({ adminId, clientId });
    if (!preview.canSend || !preview.appointment?.id) {
      throw new WorkspaceClientNotificationError(
        'WORKSPACE_CLIENT_NOTIFY_NOT_SENDABLE',
        preview.reasonMessage || 'Booking confirmation cannot be sent from this state.',
        preview.reason === 'already_sent' ? 409 : 400
      );
    }

    let result;
    try {
      result = await sender(preview.appointment.id, {
        db, env, recovery: true, operatorAdminId: preview.authority.operatorAdminId,
      });
    } catch (_error) {
      throw new WorkspaceClientNotificationError(
        'WORKSPACE_CLIENT_NOTIFY_SEND_FAILED',
        'The WhatsApp delivery attempt failed. No successful delivery claim is being made.',
        503
      );
    }

    if (result?.sent === true) {
      return {
        sent: true,
        clientId: preview.client.id,
        appointmentId: preview.appointment.id,
        message: 'Booking confirmation accepted by the existing Shiloh delivery path.',
      };
    }

    const reason = String(result?.reason || 'send_failed');
    throw new WorkspaceClientNotificationError(
      reason === 'already_sent' ? 'WORKSPACE_CLIENT_NOTIFY_ALREADY_SENT' : 'WORKSPACE_CLIENT_NOTIFY_NOT_SENT',
      publicReason(reason),
      reason === 'already_sent' ? 409 : 503
    );
  }

  return {
    resolveAccess, requireAccess, getPreview, getAppointmentConfirmation,
    listBookingConfirmationExceptions, sendBookingConfirmation,
  };
}

const service = createWorkspaceClientNotificationService();

module.exports = {
  CLIENT_LOOKUP_CAPABILITY,
  CLIENT_NOTIFY_CAPABILITY,
  WORKSPACE_CLIENT_NOTIFY_PROVIDER_GATE,
  WorkspaceClientNotificationError,
  positiveId,
  evaluateClientNotificationAuthority,
  channelReady,
  defaultProviderGuard,
  validCrmV2Mobile,
  safeProviderFailureExplanation,
  deliveryExplanation,
  recoveryExplanation,
  confirmationProjection,
  previewState,
  publicReason,
  createWorkspaceClientNotificationService,
  ...service,
};
