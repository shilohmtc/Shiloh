'use strict';

const { pool } = require('../db/pool');
const {
  BOOKING_POLICY_VERSION,
  BOOKING_POLICY_TEXT,
} = require('../config/bookingPolicyAuthority');

class InPersonBookingPolicyError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'InPersonBookingPolicyError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function acquire(db) {
  if (db && typeof db.connect === 'function') {
    return db.connect().then(client => ({ client, release: () => client.release() }));
  }
  return Promise.resolve({ client: db, release: () => {} });
}

function createInPersonBookingPolicyService({ db = pool, now = () => new Date() } = {}) {
  async function appointmentContext(appointmentId, queryable = db) {
    const id = positiveId(appointmentId);
    if (!id) throw new InPersonBookingPolicyError('IN_PERSON_POLICY_INVALID_APPOINTMENT', 'A valid appointment is required.', 400);
    const result = await queryable.query(
      `SELECT a.id,a.status,a.starts_at,a.crm_v2_client_id,
              c.name AS client_name,c.normalized_mobile,c.status AS client_status,
              COALESCE((SELECT string_agg(aps.service_name_snapshot, ' + ' ORDER BY aps.id)
                          FROM appointment_services aps WHERE aps.appointment_id=a.id),'Appointment') AS service_text,
              COALESCE((SELECT string_agg(ast.staff_name_snapshot, ' + ' ORDER BY ast.position)
                          FROM appointment_staff ast WHERE ast.appointment_id=a.id),'Shiloh') AS therapist_text
         FROM appointments a
         JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id
        WHERE a.id=$1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row || !row.crm_v2_client_id) {
      throw new InPersonBookingPolicyError('IN_PERSON_POLICY_APPOINTMENT_NOT_FOUND', 'This appointment is not available for client terms acceptance.', 404);
    }
    if (row.client_status !== 'active') {
      throw new InPersonBookingPolicyError('IN_PERSON_POLICY_CLIENT_INACTIVE', 'This client record is no longer active.', 409);
    }
    if (!['scheduled','confirmed'].includes(String(row.status || '').toLowerCase())) {
      throw new InPersonBookingPolicyError('IN_PERSON_POLICY_APPOINTMENT_INACTIVE', 'Terms cannot be accepted for this appointment in its current state.', 409);
    }
    if (new Date(row.starts_at).getTime() <= now().getTime()) {
      throw new InPersonBookingPolicyError('IN_PERSON_POLICY_APPOINTMENT_STARTED', 'Terms acceptance is only available for a future appointment.', 409);
    }
    const accepted = await queryable.query(
      `SELECT id,policy_version,accepted_at,channel
         FROM booking_policy_acceptances
        WHERE appointment_id=$1
          AND policy_version=$2
        ORDER BY accepted_at DESC,id DESC
        LIMIT 1`,
      [id, BOOKING_POLICY_VERSION],
    );
    return {
      appointmentId: id,
      crmV2ClientId: Number(row.crm_v2_client_id),
      clientName: row.client_name,
      mobile: row.normalized_mobile,
      startsAt: row.starts_at,
      serviceText: row.service_text,
      therapistText: row.therapist_text,
      policyVersion: BOOKING_POLICY_VERSION,
      policyText: BOOKING_POLICY_TEXT,
      acceptance: accepted.rows[0] || null,
    };
  }

  async function recordClinicDeviceAcceptance({ appointmentId } = {}) {
    const { client, release } = await acquire(db);
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const id = positiveId(appointmentId);
      if (!id) throw new InPersonBookingPolicyError('IN_PERSON_POLICY_INVALID_APPOINTMENT', 'A valid appointment is required.', 400);
      await client.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [id]);
      const context = await appointmentContext(id, client);
      const inserted = await client.query(
        `INSERT INTO booking_policy_acceptances(
           phone,policy_version,accepted_at,channel,service_text,preferred_date,preferred_time,therapist_text,
           crm_v2_client_id,appointment_id
         )
         VALUES(
           $1,$2,NOW(),'clinic_device',$3,
           TO_CHAR(($4::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date,'YYYY-MM-DD'),
           TO_CHAR(($4::timestamptz AT TIME ZONE 'Africa/Johannesburg')::time,'HH24:MI'),
           $5,$6,$7
         )
         ON CONFLICT (appointment_id,policy_version,channel)
           WHERE appointment_id IS NOT NULL AND channel IN ('clinic_device','payment_link')
         DO NOTHING
         RETURNING id,policy_version,accepted_at,channel`,
        [context.mobile, BOOKING_POLICY_VERSION, context.serviceText, context.startsAt, context.therapistText, context.crmV2ClientId, context.appointmentId],
      );
      const acceptance = inserted.rows[0] || (await client.query(
        `SELECT id,policy_version,accepted_at,channel
           FROM booking_policy_acceptances
          WHERE appointment_id=$1 AND policy_version=$2 AND channel='clinic_device'
          ORDER BY accepted_at DESC,id DESC LIMIT 1`,
        [context.appointmentId, BOOKING_POLICY_VERSION],
      )).rows[0];
      await client.query('COMMIT');
      began = false;
      return { ...context, acceptance };
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      release();
    }
  }

  async function listClientAcceptanceHistory({ clientId, mobile, limit = 20 } = {}) {
    const id = positiveId(clientId);
    if (!id) return [];
    const safeMobile = String(mobile || '').trim();
    const result = await db.query(
      `SELECT id,policy_version,accepted_at,channel,service_text,appointment_id
         FROM booking_policy_acceptances
        WHERE crm_v2_client_id=$1
           OR (crm_v2_client_id IS NULL AND phone=$2)
        ORDER BY accepted_at DESC,id DESC
        LIMIT $3`,
      [id, safeMobile, Math.max(1, Math.min(Number(limit) || 20, 50))],
    );
    return result.rows;
  }

  async function readinessForAppointments(appointmentIds = []) {
    const ids = [...new Set((appointmentIds || []).map(positiveId).filter(Boolean))];
    if (!ids.length) return new Map();
    const result = await db.query(
      `SELECT a.id AS appointment_id,a.status,
              EXISTS(
                SELECT 1 FROM booking_policy_acceptances bpa
                 WHERE bpa.appointment_id=a.id
              ) AS terms_accepted,
              (
                SELECT bdr.state
                  FROM booking_deposit_requirement_members bdm
                  JOIN booking_deposit_requirements bdr ON bdr.id=bdm.requirement_id
                 WHERE bdm.appointment_id=a.id
                 ORDER BY bdr.id DESC
                 LIMIT 1
              ) AS deposit_state
         FROM appointments a
        WHERE a.id = ANY($1::bigint[])`,
      [ids],
    );
    return new Map(result.rows.map(row => {
      const depositState = row.deposit_state || null;
      const confirmed = depositState
        ? ['satisfied','exempt'].includes(depositState)
        : String(row.status || '').toLowerCase() === 'confirmed';
      return [Number(row.appointment_id), {
        termsAccepted: row.terms_accepted === true,
        depositState,
        confirmed,
      }];
    }));
  }

  return { appointmentContext, recordClinicDeviceAcceptance, listClientAcceptanceHistory, readinessForAppointments };
}

module.exports = {
  InPersonBookingPolicyError,
  positiveId,
  createInPersonBookingPolicyService,
};
