'use strict';

const { pool } = require('../db/pool');

class MyShilohBookingHistoryVisibilityError extends Error {
  constructor(code, message, httpStatus = 422) {
    super(message);
    this.name = 'MyShilohBookingHistoryVisibilityError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeVisibilityPayload(payload) {
  const allowed = new Set(['appointmentId', 'hidden']);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some(key => !allowed.has(key))
    || !positiveId(payload.appointmentId) || typeof payload.hidden !== 'boolean') {
    throw new MyShilohBookingHistoryVisibilityError(
      'MY_SHILOH_BOOKING_HISTORY_INPUT_INVALID', 'Choose a previous request and try again.',
    );
  }
  return { appointmentId: positiveId(payload.appointmentId), hidden: payload.hidden };
}

function createMyShilohBookingHistoryVisibilityService({ db = pool, now = () => new Date() } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh booking history database is required');

  async function setVisibility({ sessionId, crmV2ClientId, appointmentId, hidden } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) {
      throw new MyShilohBookingHistoryVisibilityError(
        'MY_SHILOH_BOOKING_HISTORY_SESSION_INVALID', 'Please sign in again.', 401,
      );
    }
    const requested = normalizeVisibilityPayload({ appointmentId, hidden });
    // Check and lock the canonical ownership and legacy state in the mutation,
    // rather than trusting the card a client last loaded. The locks serialize
    // against appointment/approval changes without editing either record.
    const result = await db.query(
      `/* myShilohBookingHistoryVisibility:set */
       WITH eligible_request AS MATERIALIZED (
         SELECT a.id,a.crm_v2_client_id
           FROM appointments a
           JOIN appointment_booking_approvals aba ON aba.appointment_id=a.id
           JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
           JOIN client_browser_sessions s ON s.crm_v2_client_id=c.id
          WHERE s.id=$1 AND s.crm_v2_client_id=$2
            AND s.revoked_at IS NULL AND s.expires_at>$5::timestamptz
            AND c.status='active' AND s.issued_at<=$5::timestamptz
            AND s.auth_method IN ('sms_code','passkey','passkey_recovery','whatsapp_challenge','crm_details')
            AND a.id=$3 AND a.crm_v2_client_id=$2 AND a.client_id IS NULL
            AND a.status='cancelled' AND aba.status='declined'
            AND aba.decision_note='workspace_cannot_accommodate'
            AND aba.requested_starts_at IS NOT NULL AND aba.requested_ends_at IS NOT NULL
          FOR UPDATE OF a,aba
       )
       INSERT INTO my_shiloh_booking_history_visibility (crm_v2_client_id,appointment_id,hidden)
       SELECT crm_v2_client_id,id,$4::boolean FROM eligible_request
       ON CONFLICT (crm_v2_client_id,appointment_id) DO UPDATE
         SET hidden=EXCLUDED.hidden,
             updated_at=CASE
               WHEN my_shiloh_booking_history_visibility.hidden IS DISTINCT FROM EXCLUDED.hidden
               THEN NOW() ELSE my_shiloh_booking_history_visibility.updated_at END
       RETURNING appointment_id,hidden`,
      [session, clientId, requested.appointmentId, requested.hidden, now()],
    );
    const row = result.rows[0];
    if (!row) {
      // Do not distinguish missing, foreign or ineligible appointments.
      throw new MyShilohBookingHistoryVisibilityError(
        'MY_SHILOH_BOOKING_HISTORY_UNAVAILABLE', 'This previous request is unavailable. Reload Bookings and try again.', 404,
      );
    }
    return { appointmentId: Number(row.appointment_id), hidden: row.hidden };
  }

  return { setVisibility };
}

module.exports = {
  MyShilohBookingHistoryVisibilityError,
  normalizeVisibilityPayload,
  createMyShilohBookingHistoryVisibilityService,
};
