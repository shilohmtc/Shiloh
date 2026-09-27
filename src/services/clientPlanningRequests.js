'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { isDerivedGlobalCoordinator } = require('./workspaceBookingRequestRouting');

class ClientPlanningRequestError extends Error {
  constructor(code, message, httpStatus = 422) {
    super(message);
    this.name = 'ClientPlanningRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function boundedText(value, maximum, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ClientPlanningRequestError('PLANNING_INVALID_TEXT', `Please check ${label}.`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length > maximum) throw new ClientPlanningRequestError('PLANNING_TEXT_TOO_LONG', `Please shorten ${label}.`);
  return text || null;
}

function validate(input = {}, now = new Date()) {
  const clientId = positiveId(input.crmV2ClientId);
  if (!clientId) throw new ClientPlanningRequestError('PLANNING_CLIENT_INVALID', 'Please sign in again.', 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input.submissionKey || ''))) {
    throw new ClientPlanningRequestError('PLANNING_SUBMISSION_INVALID', 'Please reload My Shiloh and try again.');
  }
  if (!['flexible', 'group'].includes(input.kind)) throw new ClientPlanningRequestError('PLANNING_KIND_INVALID', 'Choose the kind of visit you have in mind.');
  if (input.serviceId != null && input.serviceId !== '') throw new ClientPlanningRequestError('PLANNING_SERVICE_INVALID', 'Please describe the visit for Reception.');
  const serviceId = null;
  const detail = boundedText(input.serviceDetail, 160, 'the treatment or experience');
  if (!serviceId && !detail) throw new ClientPlanningRequestError('PLANNING_SERVICE_REQUIRED', 'Tell Reception what you have in mind.');
  const date = input.preferredDate == null || input.preferredDate === '' ? null : String(input.preferredDate);
  const parsed = date ? new Date(`${date}T12:00:00+02:00`) : null;
  const exact = date && !Number.isNaN(parsed.getTime())
    && new Intl.DateTimeFormat('en-CA', { timeZone:'Africa/Johannesburg', year:'numeric', month:'2-digit', day:'2-digit' }).format(parsed) === date;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !exact || new Date(`${date}T23:59:59+02:00`) < now)) {
    throw new ClientPlanningRequestError('PLANNING_DATE_INVALID', 'Choose a future date, or leave it open.');
  }
  const daypart = input.preferredDaypart == null || input.preferredDaypart === '' ? null : input.preferredDaypart;
  if (daypart && !['morning','afternoon','any'].includes(daypart)) throw new ClientPlanningRequestError('PLANNING_DAYPART_INVALID', 'Choose a preferred time of day.');
  const practitionerId = input.practitionerId == null || input.practitionerId === '' ? null : positiveId(input.practitionerId);
  if (input.practitionerId != null && input.practitionerId !== '' && !practitionerId) throw new ClientPlanningRequestError('PLANNING_PRACTITIONER_INVALID', 'Choose a valid practitioner.');
  const guests = input.guestCount == null || input.guestCount === '' ? null : Number(input.guestCount);
  if (input.kind === 'group' && (!Number.isSafeInteger(guests) || guests < 2 || guests > 1000000)) {
    throw new ClientPlanningRequestError('PLANNING_GUESTS_REQUIRED', 'Tell Reception approximately how many guests are coming.');
  }
  if (input.kind === 'flexible' && guests != null) throw new ClientPlanningRequestError('PLANNING_GUESTS_INVALID', 'Guest count is for group requests.');
  if (typeof input.specialOccasion !== 'boolean') throw new ClientPlanningRequestError('PLANNING_OCCASION_CHOICE_REQUIRED', 'Choose Yes or No for a special occasion.');
  const occasion = boundedText(input.occasionNote, 160, 'the occasion');
  if (input.specialOccasion && !occasion) throw new ClientPlanningRequestError('PLANNING_OCCASION_REQUIRED', 'Tell Reception what the occasion is.');
  if (!input.specialOccasion && occasion) throw new ClientPlanningRequestError('PLANNING_OCCASION_CONFLICT', 'Please check your special occasion answer.');
  return {
    clientId, submissionKey: input.submissionKey.toLowerCase(), kind: input.kind,
    serviceId, detail, date, daypart, practitionerId, guests,
    specialOccasion: input.specialOccasion, occasion,
    note: boundedText(input.clientNote, 500, 'your planning note'),
  };
}

function createClientPlanningRequestService({ db = pool, now = () => new Date() } = {}) {
  async function practitioners() {
    const result = await db.query(`SELECT id,display_name FROM staff WHERE status='active'
      AND client_bookable=TRUE AND resource_type='practitioner'
      AND COALESCE(business_role,'') <> 'tenant_practitioner' ORDER BY display_name,id`);
    return result.rows.map(row => ({ id:Number(row.id), name:row.display_name }));
  }

  async function submit(input) {
    const item = validate(input, now());
    const digest = crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');
    const client = await db.query('SELECT id FROM crm_v2_clients WHERE id=$1 AND status=\'active\' LIMIT 1', [item.clientId]);
    if (!client.rowCount) throw new ClientPlanningRequestError('PLANNING_CLIENT_CHANGED', 'Please sign in again.', 401);
    if (item.practitionerId) {
      const staff = await db.query(`SELECT 1 FROM staff WHERE id=$1 AND status='active' AND client_bookable=TRUE AND resource_type='practitioner' AND COALESCE(business_role,'') <> 'tenant_practitioner' LIMIT 1`, [item.practitionerId]);
      if (!staff.rowCount) throw new ClientPlanningRequestError('PLANNING_PRACTITIONER_CHANGED', 'That practitioner is no longer available for client requests.', 409);
    }
    const result = await db.query(`
      INSERT INTO client_planning_requests
        (submission_key,payload_digest,crm_v2_client_id,request_kind,service_id,service_detail,preferred_date,preferred_daypart,
         practitioner_id,guest_count,special_occasion,occasion_note,client_note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (submission_key) DO NOTHING RETURNING id`, [
      item.submissionKey,digest,item.clientId,item.kind,item.serviceId,item.detail,item.date,item.daypart,
      item.practitionerId,item.guests,item.specialOccasion,item.occasion,item.note,
    ]);
    if (result.rowCount) return { id:Number(result.rows[0].id), status:'requested', created:true };
    const replay = await db.query('SELECT id,crm_v2_client_id,status,payload_digest FROM client_planning_requests WHERE submission_key=$1', [item.submissionKey]);
    if (Number(replay.rows[0]?.crm_v2_client_id) !== item.clientId || replay.rows[0]?.payload_digest !== digest) {
      throw new ClientPlanningRequestError('PLANNING_SUBMISSION_CONFLICT', 'This request has changed. Please reload My Shiloh and try again.', 409);
    }
    return { id:Number(replay.rows[0].id), status:replay.rows[0].status, created:false };
  }

  async function forClient(crmV2ClientId) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return [];
    const result = await db.query(`SELECT r.id,r.request_kind,r.status,r.service_detail,r.preferred_date,r.preferred_daypart,r.guest_count,
      special_occasion,occasion_note,client_note,requested_at,planning_started_at,linked_appointment_id,
      s.name AS service_name FROM client_planning_requests r LEFT JOIN services s ON s.id=r.service_id
      WHERE r.crm_v2_client_id=$1 ORDER BY r.requested_at DESC,r.id DESC LIMIT 15`, [clientId]);
    return result.rows;
  }

  async function forReception(principal) {
    if (!isDerivedGlobalCoordinator(principal)) return [];
    const result = await db.query(`SELECT r.id,r.request_kind,r.status,r.service_detail,r.preferred_date,r.preferred_daypart,
      r.guest_count,r.special_occasion,r.occasion_note,r.client_note,r.requested_at,r.planning_started_at,
      c.name AS client_name,s.name AS service_name,p.display_name AS practitioner_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',candidate.id,'startsAt',candidate.starts_at) ORDER BY candidate.starts_at)
        FROM (SELECT a.id,a.starts_at FROM appointments a
              WHERE a.crm_v2_client_id=r.crm_v2_client_id AND a.status IN ('scheduled','confirmed')
                AND a.starts_at>NOW() ORDER BY a.starts_at LIMIT 8) candidate),'[]'::jsonb) AS candidate_appointments
      FROM client_planning_requests r JOIN crm_v2_clients c ON c.id=r.crm_v2_client_id
      LEFT JOIN services s ON s.id=r.service_id LEFT JOIN staff p ON p.id=r.practitioner_id
      WHERE r.status IN ('requested','planning') ORDER BY r.requested_at,r.id LIMIT 100`);
    return result.rows;
  }

  async function decide({ principal, id, action, appointmentId = null }) {
    if (!isDerivedGlobalCoordinator(principal)) throw new ClientPlanningRequestError('PLANNING_FORBIDDEN', 'Reception planning access is required.', 403);
    const requestId = positiveId(id);
    const adminId = positiveId(principal?.id || principal?.calendarAuthority?.operatorAdminId);
    if (!requestId || !adminId || !['start_planning','decline','arranged'].includes(action)) throw new ClientPlanningRequestError('PLANNING_ACTION_INVALID', 'Please reload and try again.');
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const current = await connection.query('SELECT * FROM client_planning_requests WHERE id=$1 FOR UPDATE', [requestId]);
      const row = current.rows[0];
      if (!row || !['requested','planning'].includes(row.status)) throw new ClientPlanningRequestError('PLANNING_ALREADY_RESOLVED', 'This request has changed. Please refresh.', 409);
      let linked = null;
      if (action === 'arranged') {
        linked = positiveId(appointmentId);
        if (!linked) throw new ClientPlanningRequestError('PLANNING_APPOINTMENT_REQUIRED', 'Choose the appointment arranged for this client.');
        const matching = await connection.query(`SELECT id FROM appointments WHERE id=$1 AND crm_v2_client_id=$2 AND status IN ('scheduled','confirmed') LIMIT 1`, [linked,row.crm_v2_client_id]);
        if (!matching.rowCount) throw new ClientPlanningRequestError('PLANNING_APPOINTMENT_MISMATCH', 'That appointment does not belong to this client.', 409);
      }
      const status = action === 'start_planning' ? 'planning' : action === 'decline' ? 'declined' : 'arranged';
      const result = await connection.query(`UPDATE client_planning_requests SET status=$2,
        planning_started_at=CASE WHEN $2='planning' THEN COALESCE(planning_started_at,NOW()) ELSE planning_started_at END,
        planning_by_admin_id=CASE WHEN $2='planning' THEN COALESCE(planning_by_admin_id,$3) ELSE planning_by_admin_id END,
        decided_at=CASE WHEN $2 IN ('declined','arranged') THEN NOW() ELSE NULL END,
        decided_by_admin_id=CASE WHEN $2 IN ('declined','arranged') THEN $3 ELSE NULL END,
        linked_appointment_id=$4,updated_at=NOW() WHERE id=$1 RETURNING id,status`, [requestId,status,adminId,linked]);
      await connection.query('COMMIT');
      return { id:Number(result.rows[0].id), status:result.rows[0].status };
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { connection.release(); }
  }

  return { submit, forClient, forReception, decide, practitioners };
}

module.exports = { ClientPlanningRequestError, validate, createClientPlanningRequestService };
