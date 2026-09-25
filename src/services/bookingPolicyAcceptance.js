'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const {
  BOOKING_POLICY_TEXT,
  BOOKING_POLICY_UPDATED,
  BOOKING_POLICY_VERSION,
} = require('../config/bookingPolicyAuthority');
const {
  CALENDAR_CAPABILITIES,
  resolveCalendarAuthority,
  hasCapability,
  allowsAppointmentTarget,
} = require('./calendarAuthorization');

class BookingPolicyAcceptanceError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'BookingPolicyAcceptanceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canonicalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^27[678]\d{8}$/.test(digits)) return digits;
  if (/^0[678]\d{8}$/.test(digits)) return `27${digits.slice(1)}`;
  return null;
}

function safeRequestKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{32,80}$/.test(key) ? key : null;
}

function randomRequestKey(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('base64url');
}

function requestPaths(row) {
  if (!row) return null;
  return {
    policyVersion: String(row.policy_version || ''),
    clinicPath: `/booking-policy/${row.clinic_request_key}`,
    clientPath: `/booking-policy/${row.client_request_key}`,
    clientMobile: String(row.phone_snapshot || ''),
  };
}

async function acquireClient(db) {
  if (db && typeof db.connect === 'function') {
    const client = await db.connect();
    return { client, release: () => client.release() };
  }
  if (db && typeof db.query === 'function') return { client: db, release: () => {} };
  throw new TypeError('Booking policy acceptance requires a database query interface.');
}

function activeFutureAppointment(row, now = new Date()) {
  if (!row) return false;
  if (!['scheduled', 'confirmed'].includes(String(row.status || '').toLowerCase())) return false;
  const start = new Date(row.starts_at);
  const current = new Date(now);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(current.getTime()) && start.getTime() > current.getTime();
}

function channelLabel(channel) {
  const key = String(channel || '').toLowerCase();
  if (key === 'clinic_device') return 'In clinic on Shiloh device';
  if (key === 'secure_link' || key === 'payment_link') return 'Secure link';
  if (key === 'my_shiloh') return 'My Shiloh';
  if (key === 'whatsapp') return 'WhatsApp';
  return 'Shiloh';
}

function createBookingPolicyAcceptanceService({
  db = pool,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  async function appointmentIdentity(queryable, appointmentId, { lock = false } = {}) {
    const id = positiveId(appointmentId);
    if (!id) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_APPOINTMENT_INVALID', 'Booking reference is invalid.', 400);
    const result = await queryable.query(
      `SELECT a.id,a.crm_v2_client_id,a.starts_at,a.status,a.source,
              c.name AS client_name,c.normalized_mobile,c.status AS client_status
         FROM appointments a
         JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
        WHERE a.id=$1
        ${lock ? 'FOR UPDATE OF a,c' : ''}`,
      [id],
    );
    return result.rows[0] || null;
  }

  async function ensureForAppointment({
    queryable = db,
    appointmentId,
    crmV2ClientId = null,
    phone = null,
    adminId = null,
  } = {}) {
    const identity = await appointmentIdentity(queryable, appointmentId, { lock: true });
    if (!identity) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_APPOINTMENT_NOT_FOUND', 'This booking could not be found.', 404);
    }
    if (!String(identity.source || '').startsWith('shiloh_calendar')) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_CHANNEL_UNSUPPORTED', 'This booking uses its existing policy-acceptance flow.', 409);
    }
    if (!activeFutureAppointment(identity, now())) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_APPOINTMENT_NOT_ACTIVE', 'This booking is no longer available for policy acceptance.', 410);
    }
    const clientId = positiveId(crmV2ClientId) || positiveId(identity.crm_v2_client_id);
    if (!clientId || clientId !== Number(identity.crm_v2_client_id) || identity.client_status !== 'active') {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_CLIENT_CHANGED', 'The client record changed before terms review could be prepared.', 409);
    }
    const mobile = canonicalPhone(phone || identity.normalized_mobile);
    if (!mobile || mobile !== canonicalPhone(identity.normalized_mobile)) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_CLIENT_CHANGED', 'The client mobile changed before terms review could be prepared.', 409);
    }

    const clinicKey = randomRequestKey(randomBytes);
    const clientKey = randomRequestKey(randomBytes);
    await queryable.query(
      `INSERT INTO booking_policy_acceptance_requests(
         appointment_id,crm_v2_client_id,phone_snapshot,policy_version,policy_text_snapshot,
         policy_updated_snapshot,clinic_request_key,client_request_key,created_by_admin_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (appointment_id) DO NOTHING`,
      [
        Number(identity.id),
        clientId,
        mobile,
        BOOKING_POLICY_VERSION,
        BOOKING_POLICY_TEXT,
        BOOKING_POLICY_UPDATED,
        clinicKey,
        clientKey,
        positiveId(adminId),
      ],
    );
    const request = await queryable.query(
      `SELECT appointment_id,crm_v2_client_id,phone_snapshot,policy_version,policy_text_snapshot,
              policy_updated_snapshot,clinic_request_key,client_request_key,consumed_at,revoked_at,created_at
         FROM booking_policy_acceptance_requests
        WHERE appointment_id=$1
        LIMIT 1`,
      [Number(identity.id)],
    );
    const row = request.rows[0];
    if (!row
      || Number(row.crm_v2_client_id) !== clientId
      || canonicalPhone(row.phone_snapshot) !== mobile) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_REQUEST_CHANGED', 'The terms-review request changed. Please reopen the booking.', 409);
    }
    return requestPaths(row);
  }

  async function policyGateForAppointment({ queryable = db, appointmentId } = {}) {
    const id = positiveId(appointmentId);
    if (!id) return { required: false, accepted: false, request: null };
    const result = await queryable.query(
      `SELECT r.appointment_id,r.crm_v2_client_id,r.phone_snapshot,r.policy_version,
              r.clinic_request_key,r.client_request_key,r.consumed_at,r.revoked_at,
              a.id AS acceptance_id,a.accepted_at,a.channel
         FROM booking_policy_acceptance_requests r
         LEFT JOIN LATERAL (
           SELECT bpa.id,bpa.accepted_at,bpa.channel
             FROM booking_policy_acceptances bpa
            WHERE bpa.appointment_id=r.appointment_id
              AND bpa.policy_version=r.policy_version
            ORDER BY bpa.accepted_at DESC,bpa.id DESC
            LIMIT 1
         ) a ON TRUE
        WHERE r.appointment_id=$1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0] || null;
    if (!row) return { required: false, accepted: false, request: null };
    const accepted = Boolean(row.acceptance_id);
    return {
      required: !accepted,
      accepted,
      revoked: Boolean(row.revoked_at),
      policyVersion: row.policy_version,
      acceptedAt: row.accepted_at || null,
      channel: row.channel || null,
      request: requestPaths(row),
    };
  }

  async function loadPublicRequest(requestKey) {
    const key = safeRequestKey(requestKey);
    if (!key) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_NOT_FOUND', 'This terms link is not available.', 404);
    const result = await db.query(
      `SELECT r.appointment_id,r.crm_v2_client_id,r.phone_snapshot,r.policy_version,
              r.policy_text_snapshot,r.policy_updated_snapshot,r.clinic_request_key,r.client_request_key,
              r.consumed_at,r.revoked_at,r.created_at,
              a.starts_at,a.status,a.source,
              c.name AS client_name,c.normalized_mobile,c.status AS client_status,
              CASE WHEN r.clinic_request_key=$1 THEN 'clinic_device' ELSE 'secure_link' END AS acceptance_channel,
              accepted.accepted_at,accepted.channel AS accepted_channel
         FROM booking_policy_acceptance_requests r
         JOIN appointments a ON a.id=r.appointment_id
         JOIN crm_v2_clients c ON c.id=r.crm_v2_client_id
         LEFT JOIN LATERAL (
           SELECT bpa.accepted_at,bpa.channel
             FROM booking_policy_acceptances bpa
            WHERE bpa.appointment_id=r.appointment_id
              AND bpa.policy_version=r.policy_version
            ORDER BY bpa.accepted_at DESC,bpa.id DESC
            LIMIT 1
         ) accepted ON TRUE
        WHERE r.clinic_request_key=$1 OR r.client_request_key=$1
        LIMIT 1`,
      [key],
    );
    const row = result.rows[0] || null;
    if (!row) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_NOT_FOUND', 'This terms link is not available.', 404);
    if (row.revoked_at || !activeFutureAppointment(row, now())) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_EXPIRED', 'This booking is no longer available for terms acceptance.', 410);
    }
    if (Number(row.crm_v2_client_id) !== positiveId(row.crm_v2_client_id)
      || row.client_status !== 'active'
      || canonicalPhone(row.phone_snapshot) !== canonicalPhone(row.normalized_mobile)) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_CLIENT_CHANGED', 'The client details changed. Please ask the Shiloh team to reopen the booking.', 409);
    }
    return {
      appointmentId: Number(row.appointment_id),
      crmV2ClientId: Number(row.crm_v2_client_id),
      clientName: String(row.client_name || 'Client'),
      phone: String(row.phone_snapshot || ''),
      policyVersion: String(row.policy_version),
      policyText: String(row.policy_text_snapshot || ''),
      policyUpdated: String(row.policy_updated_snapshot || ''),
      channel: String(row.acceptance_channel),
      accepted: Boolean(row.accepted_at),
      acceptedAt: row.accepted_at || null,
      acceptedChannel: row.accepted_channel || null,
      requestKey: key,
      startsAt: row.starts_at,
    };
  }

  async function recordAcceptance(queryable, {
    appointmentId = null,
    crmV2ClientId = null,
    phone,
    policyVersion = BOOKING_POLICY_VERSION,
    channel,
    serviceText = null,
  } = {}) {
    const mobile = canonicalPhone(phone);
    if (!mobile) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_PHONE_INVALID', 'A valid client mobile is required.', 409);
    const appointment = positiveId(appointmentId);
    const clientId = positiveId(crmV2ClientId);
    if (!appointment) {
      const inserted = await queryable.query(
        `INSERT INTO booking_policy_acceptances(phone,policy_version,accepted_at,channel,service_text,crm_v2_client_id,appointment_id)
         VALUES($1,$2,NOW(),$3,$4,$5,NULL)
         RETURNING id,accepted_at,channel,policy_version`,
        [mobile, policyVersion, channel, serviceText, clientId],
      );
      return inserted.rows[0] || null;
    }
    const inserted = await queryable.query(
      `INSERT INTO booking_policy_acceptances(
         phone,policy_version,accepted_at,channel,service_text,crm_v2_client_id,appointment_id
       ) VALUES($1,$2,NOW(),$3,$4,$5,$6)
       ON CONFLICT (appointment_id,policy_version) WHERE appointment_id IS NOT NULL DO NOTHING
       RETURNING id,accepted_at,channel,policy_version`,
      [mobile, policyVersion, channel, serviceText || `Booking #${appointment}`, clientId, appointment],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await queryable.query(
      `SELECT id,accepted_at,channel,policy_version
         FROM booking_policy_acceptances
        WHERE appointment_id=$1 AND policy_version=$2
        ORDER BY accepted_at DESC,id DESC
        LIMIT 1`,
      [appointment, policyVersion],
    );
    return existing.rows[0] || null;
  }

  async function acceptRequest(requestKey) {
    const key = safeRequestKey(requestKey);
    if (!key) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_NOT_FOUND', 'This terms link is not available.', 404);
    const { client, release } = await acquireClient(db);
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const requestResult = await client.query(
        `SELECT r.*,
                CASE WHEN r.clinic_request_key=$1 THEN 'clinic_device' ELSE 'secure_link' END AS acceptance_channel
           FROM booking_policy_acceptance_requests r
          WHERE r.clinic_request_key=$1 OR r.client_request_key=$1
          FOR UPDATE`,
        [key],
      );
      const request = requestResult.rows[0] || null;
      if (!request) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_NOT_FOUND', 'This terms link is not available.', 404);
      if (request.revoked_at) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_EXPIRED', 'This terms link is no longer available.', 410);

      const identity = await appointmentIdentity(client, request.appointment_id, { lock: true });
      if (!identity || !activeFutureAppointment(identity, now())) {
        throw new BookingPolicyAcceptanceError('BOOKING_POLICY_LINK_EXPIRED', 'This booking is no longer available for terms acceptance.', 410);
      }
      if (Number(identity.crm_v2_client_id) !== Number(request.crm_v2_client_id)
        || identity.client_status !== 'active'
        || canonicalPhone(identity.normalized_mobile) !== canonicalPhone(request.phone_snapshot)) {
        throw new BookingPolicyAcceptanceError('BOOKING_POLICY_CLIENT_CHANGED', 'The client details changed. Please ask the Shiloh team to reopen the booking.', 409);
      }

      const acceptance = await recordAcceptance(client, {
        appointmentId: Number(request.appointment_id),
        crmV2ClientId: Number(request.crm_v2_client_id),
        phone: request.phone_snapshot,
        policyVersion: request.policy_version,
        channel: request.acceptance_channel,
        serviceText: `Booking #${request.appointment_id}`,
      });
      await client.query(
        `UPDATE booking_policy_acceptance_requests
            SET consumed_at=COALESCE(consumed_at,NOW())
          WHERE appointment_id=$1`,
        [Number(request.appointment_id)],
      );
      await client.query(
        `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
         VALUES('booking_policy.accepted','appointment',$1,$2::jsonb)`,
        [Number(request.appointment_id), JSON.stringify({
          crmV2ClientId: Number(request.crm_v2_client_id),
          policyVersion: String(request.policy_version),
          channel: String(acceptance?.channel || request.acceptance_channel),
          acceptanceId: positiveId(acceptance?.id),
        })],
      );
      await client.query('COMMIT');
      began = false;
      return {
        appointmentId: Number(request.appointment_id),
        crmV2ClientId: Number(request.crm_v2_client_id),
        policyVersion: String(request.policy_version),
        channel: String(acceptance?.channel || request.acceptance_channel),
        acceptedAt: acceptance?.accepted_at || null,
        clientName: String(identity.client_name || 'Client'),
      };
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      release();
    }
  }

  async function recordPaymentLinkAcceptance({
    queryable = db,
    appointmentId = null,
    phone,
    policyVersion = BOOKING_POLICY_VERSION,
  } = {}) {
    const appointment = positiveId(appointmentId);
    if (!appointment) {
      return recordAcceptance(queryable, {
        phone,
        policyVersion,
        channel: 'payment_link',
        serviceText: 'Shiloh payment',
      });
    }
    const identity = await appointmentIdentity(queryable, appointment);
    const mobile = canonicalPhone(phone);
    const clientId = identity && mobile && mobile === canonicalPhone(identity.normalized_mobile)
      ? positiveId(identity.crm_v2_client_id)
      : null;
    return recordAcceptance(queryable, {
      appointmentId: appointment,
      crmV2ClientId: clientId,
      phone,
      policyVersion,
      channel: 'payment_link',
      serviceText: `Booking #${appointment}`,
    });
  }

  async function acceptanceForAppointment({ queryable = db, appointmentId } = {}) {
    const id = positiveId(appointmentId);
    if (!id) return null;
    const result = await queryable.query(
      `SELECT id,phone,policy_version,accepted_at,channel,crm_v2_client_id,appointment_id
         FROM booking_policy_acceptances
        WHERE appointment_id=$1
        ORDER BY accepted_at DESC,id DESC
        LIMIT 1`,
      [id],
    );
    return result.rows[0] || null;
  }

  async function listForClient({ crmV2ClientId, phone, limit = 20 } = {}) {
    const clientId = positiveId(crmV2ClientId);
    const mobile = canonicalPhone(phone);
    if (!clientId) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const result = await db.query(
      `SELECT bpa.id,bpa.policy_version,bpa.accepted_at,bpa.channel,bpa.appointment_id,
              COALESCE(aps.service_name_snapshot,a.title) AS service_name,
              a.starts_at
         FROM booking_policy_acceptances bpa
         LEFT JOIN appointments a ON a.id=bpa.appointment_id
         LEFT JOIN LATERAL (
           SELECT service_name_snapshot
             FROM appointment_services
            WHERE appointment_id=a.id
            ORDER BY position,id
            LIMIT 1
         ) aps ON TRUE
        WHERE bpa.crm_v2_client_id=$1
           OR (bpa.crm_v2_client_id IS NULL AND $2::text IS NOT NULL AND bpa.phone=$2)
        ORDER BY bpa.accepted_at DESC,bpa.id DESC
        LIMIT $3`,
      [clientId, mobile, safeLimit],
    );
    return result.rows.map(row => ({
      id: Number(row.id),
      policyVersion: String(row.policy_version || ''),
      acceptedAt: row.accepted_at,
      channel: String(row.channel || ''),
      channelLabel: channelLabel(row.channel),
      appointmentId: positiveId(row.appointment_id),
      serviceName: row.service_name || null,
      startsAt: row.starts_at || null,
    }));
  }

  async function readinessForAppointments(appointmentIds = []) {
    const ids = [...new Set((appointmentIds || []).map(positiveId).filter(Boolean))];
    if (!ids.length) return {};
    const result = await db.query(
      `SELECT a.id,
              req.policy_version AS requested_policy_version,req.consumed_at,req.revoked_at,
              acc.accepted_at,acc.channel AS acceptance_channel,acc.policy_version AS accepted_policy_version,
              bdr.state AS deposit_state,bdr.required_amount AS deposit_required_amount,
              delivery.status AS confirmation_status,delivery.sent_at,
              delivery.provider_delivered_at,delivery.provider_read_at
         FROM appointments a
         LEFT JOIN booking_policy_acceptance_requests req ON req.appointment_id=a.id
         LEFT JOIN LATERAL (
           SELECT bpa.accepted_at,bpa.channel,bpa.policy_version
             FROM booking_policy_acceptances bpa
            WHERE bpa.appointment_id=a.id
              AND (req.policy_version IS NULL OR bpa.policy_version=req.policy_version)
            ORDER BY bpa.accepted_at DESC,bpa.id DESC
            LIMIT 1
         ) acc ON TRUE
         LEFT JOIN booking_deposit_requirement_members member ON member.appointment_id=a.id
         LEFT JOIN booking_deposit_requirements bdr ON bdr.id=member.requirement_id
         LEFT JOIN customer_message_deliveries delivery
           ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
        WHERE a.id=ANY($1::bigint[])`,
      [ids],
    );
    return Object.fromEntries(result.rows.map(row => {
      const termsState = row.accepted_at ? 'accepted' : row.requested_policy_version ? 'awaiting' : 'not_recorded';
      let confirmationState = 'not_started';
      if (row.provider_read_at || row.provider_delivered_at || row.sent_at || String(row.confirmation_status) === 'sent') confirmationState = 'sent';
      else if (['pending', 'failed', 'claimed'].includes(String(row.confirmation_status || ''))) confirmationState = 'pending';
      return [Number(row.id), {
        terms: {
          state: termsState,
          policyVersion: row.accepted_policy_version || row.requested_policy_version || null,
          acceptedAt: row.accepted_at || null,
          channel: row.acceptance_channel || null,
          channelLabel: row.acceptance_channel ? channelLabel(row.acceptance_channel) : null,
        },
        deposit: {
          state: row.deposit_state || 'not_started',
          requiredAmount: row.deposit_required_amount == null ? null : Number(row.deposit_required_amount).toFixed(2),
        },
        confirmation: { state: confirmationState },
      }];
    }));
  }

  async function operatorReadiness({ adminId, appointmentId } = {}) {
    const admin = await resolveCalendarAuthority(db, adminId);
    if (!admin || !hasCapability(admin.calendarAuthority, CALENDAR_CAPABILITIES.VIEW)) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_READINESS_FORBIDDEN', 'Current staff authority does not permit this booking view.', 403);
    }
    const id = positiveId(appointmentId);
    if (!id) throw new BookingPolicyAcceptanceError('BOOKING_POLICY_APPOINTMENT_INVALID', 'Booking reference is invalid.', 400);
    const scope = await db.query(
      `SELECT a.id,
              ARRAY(SELECT ast.staff_id FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position,ast.id) AS staff_ids,
              ARRAY(SELECT aps.service_id FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position,aps.id) AS service_ids
         FROM appointments a
        WHERE a.id=$1
        LIMIT 1`,
      [id],
    );
    const row = scope.rows[0];
    if (!row || !allowsAppointmentTarget(admin.calendarAuthority, {
      staffIds: (row.staff_ids || []).map(Number),
      serviceIds: (row.service_ids || []).map(Number),
    })) {
      throw new BookingPolicyAcceptanceError('BOOKING_POLICY_READINESS_NOT_FOUND', 'Booking readiness was not found.', 404);
    }
    const readiness = (await readinessForAppointments([id]))[id] || {
      terms: { state: 'not_recorded', policyVersion: null, acceptedAt: null, channel: null, channelLabel: null },
      deposit: { state: 'not_started', requiredAmount: null },
      confirmation: { state: 'not_started' },
    };
    const gate = await policyGateForAppointment({ appointmentId: id });
    const canHelpAcceptance = gate.required
      && !gate.revoked
      && hasCapability(admin.calendarAuthority, CALENDAR_CAPABILITIES.BOOKING_CREATE)
      && hasCapability(admin.calendarAuthority, CALENDAR_CAPABILITIES.CLIENT_LOOKUP);
    return {
      appointmentId: id,
      ...readiness,
      policyActions: canHelpAcceptance ? gate.request : null,
    };
  }

  return {
    ensureForAppointment,
    policyGateForAppointment,
    loadPublicRequest,
    acceptRequest,
    recordPaymentLinkAcceptance,
    acceptanceForAppointment,
    listForClient,
    readinessForAppointments,
    operatorReadiness,
  };
}

const service = createBookingPolicyAcceptanceService();

module.exports = {
  BookingPolicyAcceptanceError,
  positiveId,
  canonicalPhone,
  safeRequestKey,
  randomRequestKey,
  requestPaths,
  activeFutureAppointment,
  channelLabel,
  createBookingPolicyAcceptanceService,
  ...service,
};
