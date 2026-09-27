'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');
const {
  createCrmV2ClientService, CrmV2Error, normalizeName, normalizeMobile, normalizeDateOfBirth,
} = require('./crmV2ClientService');
const { createWorkspaceClientMutationService } = require('./workspaceClientMutations');
const clientForms = require('./clientConsultationForms');
const { createWorkspaceFormsService } = require('./workspaceForms');
const { resolveCalendarAuthority,hasCapability,CALENDAR_CAPABILITIES } = require('./calendarAuthorization');

const SESSION_MS = 12 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function token() { return crypto.randomBytes(32).toString('base64url'); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validToken(value) { return TOKEN_PATTERN.test(String(value || '')); }

class CheckinError extends Error {
  constructor(message, status = 400) { super(message); this.httpStatus = status; }
}

function createClinicIpadCheckinService({ db = pool, now = () => new Date(), randomToken = token,
  clientMutations = createWorkspaceClientMutationService({ db }),
  formsAuthority = createWorkspaceFormsService({ db }), formService = clientForms } = {}) {
  async function canActivate(adminId) {
    const authority = await clientMutations.resolveManageAccess(adminId);
    return authority?.clientScope?.kind === 'clinic' ? authority : null;
  }
  async function deviceFor(rawToken, queryable = db) {
    if (!validToken(rawToken)) return null;
    const result = await queryable.query(
      `SELECT id,activated_by_admin_id FROM clinic_checkin_devices
       WHERE token_hash=$1 AND revoked_at IS NULL LIMIT 1`, [digest(rawToken)]);
    return result.rows[0] || null;
  }

  async function activate(adminId) {
    const authority = await canActivate(adminId);
    if (!authority) throw new CheckinError('Clinic client management access is required.', 403);
    const value = randomToken();
    if (!validToken(value)) throw new Error('Invalid generated check-in capability');
    const result = await db.query(
      `INSERT INTO clinic_checkin_devices(token_hash,activated_by_admin_id)
       VALUES($1,$2) RETURNING id`, [digest(value), authority.operatorAdminId]);
    return { deviceId: result.rows[0].id, token: value };
  }

  async function revoke(adminId, deviceId) {
    const authority = await clientMutations.resolveManageAccess(adminId);
    if (!authority || authority.clientScope.kind !== 'clinic') throw new CheckinError('Clinic client management access is required.', 403);
    if (!/^\d+$/.test(String(deviceId || ''))) throw new CheckinError('Invalid device reference');
    const result = await db.query(
      `UPDATE clinic_checkin_devices SET revoked_at=NOW()
       WHERE id=$1 AND revoked_at IS NULL RETURNING id`, [deviceId]);
    if (result.rowCount) {
      const claimed = await db.query(
        `UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
         WHERE device_id=$1 AND status IN ('queued','claimed')
         RETURNING assignment_id,form_token_hash`,[deviceId,now()]);
      for (const row of claimed.rows) if (row.form_token_hash) await db.query(
        `UPDATE consultation_form_assignments SET access_expires_at=$3
         WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
    }
    return result.rowCount === 1;
  }

  async function listDevices(adminId) {
    if (!await canActivate(adminId)) throw new CheckinError('Clinic client management access is required.', 403);
    const result = await db.query(
      `SELECT id,created_at,revoked_at FROM clinic_checkin_devices
       ORDER BY created_at DESC,id DESC LIMIT 30`);
    return result.rows;
  }

  async function listFormAssignments(adminId, appointmentId) {
    if (!await canActivate(adminId)) throw new CheckinError('Clinic client management access is required.', 403);
    const formsAccess = await formsAuthority.resolveAccess(adminId);
    if (formsAccess?.formScope !== 'all_business') throw new CheckinError('Forms access is required.', 403);
    const bookingAccess = await resolveCalendarAuthority(db,adminId);
    if (bookingAccess?.calendarAuthority?.calendarScope !== 'all_business'
      || !hasCapability(bookingAccess.calendarAuthority,CALENDAR_CAPABILITIES.BOOKING_CREATE)
      || !hasCapability(bookingAccess.calendarAuthority,CALENDAR_CAPABILITIES.CLIENT_LOOKUP)) {
      throw new CheckinError('Reception booking access is required.',403);
    }
    if (!/^\d+$/.test(String(appointmentId || ''))) throw new CheckinError('Invalid appointment reference.');
    const result = await db.query(
      `SELECT a.id,a.status,t.title,c.name AS client_name,
              right(c.normalized_mobile,4) AS mobile_last4,ap.starts_at
         FROM consultation_form_assignments a
       JOIN appointments ap ON ap.id=a.appointment_id
       JOIN crm_v2_clients c ON c.id=ap.crm_v2_client_id AND c.status='active'
       JOIN crm_v2_client_relationships rel ON rel.client_id=ap.crm_v2_client_id
         AND rel.relationship_type='clinic' AND rel.status='active'
       JOIN consultation_form_template_versions v ON v.id=a.template_version_id
       JOIN consultation_form_templates t ON t.id=v.template_id AND t.status='active'
         WHERE ap.id=$1 AND ap.client_id IS NULL AND ap.status IN ('scheduled','confirmed')
         AND a.crm_v2_client_id=ap.crm_v2_client_id AND a.client_id IS NULL
         AND a.status IN ('not_sent','sent','opened')
         AND NOT EXISTS (SELECT 1 FROM clinic_checkin_form_handoffs h
           WHERE h.assignment_id=a.id AND h.status IN ('queued','claimed') AND h.expires_at>NOW())
         ORDER BY a.id`, [appointmentId]);
    return result.rows;
  }

  async function queueForm(adminId, deviceId, appointmentId, assignmentId) {
    const assignments = await listFormAssignments(adminId,appointmentId);
    const selected = assignments.find(row => String(row.id) === String(assignmentId));
    if (!selected) throw new CheckinError('This form is not available for that appointment.', 409);
    if (selected.status !== 'not_sent') throw new CheckinError('This form was already sent. Ask the client to use their secure link.',409);
    if (!/^\d+$/.test(String(deviceId || ''))) throw new CheckinError('Invalid iPad reference.');
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(-$1::bigint)',[selected.id]);
      const assignment=await connection.query(
        `SELECT status FROM consultation_form_assignments WHERE id=$1 FOR UPDATE`,[selected.id]);
      if (assignment.rows[0]?.status!=='not_sent') throw new CheckinError('This form changed. Please refresh the appointment.',409);
      const prepared=await connection.query(
        `SELECT id FROM clinic_checkin_form_handoffs
         WHERE assignment_id=$1 AND status IN ('queued','claimed') AND expires_at>$2 LIMIT 1`,
        [selected.id,now()]);
      if (prepared.rowCount) throw new CheckinError('This form is already prepared for another visit.',409);
      const device = await connection.query(
        `SELECT id FROM clinic_checkin_devices WHERE id=$1 AND revoked_at IS NULL FOR UPDATE`,[deviceId]);
      if (!device.rowCount) throw new CheckinError('This iPad is not active.',404);
      const inUse = await connection.query(
        `SELECT id FROM clinic_checkin_form_handoffs
         WHERE device_id=$1 AND status='claimed' AND expires_at>$2 LIMIT 1`,[deviceId,now()]);
      if (inUse.rowCount) throw new CheckinError('Finish the current client’s form before queuing another.',409);
      await connection.query(
        `UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
         WHERE device_id=$1 AND status='queued'`,[deviceId,now()]);
      await connection.query(
        `INSERT INTO clinic_checkin_form_handoffs
         (device_id,assignment_id,queued_by_admin_id,expires_at)
         VALUES($1,$2,$3,$4)`,[deviceId,selected.id,adminId,new Date(now().getTime()+15*60*1000)]);
      await connection.query('COMMIT');
      return { queued:true };
    } catch(error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }

  async function readyForm(rawDeviceToken) {
    const device = await deviceFor(rawDeviceToken);
    if (!device) return false;
    const result = await db.query(
      `SELECT id FROM clinic_checkin_form_handoffs
       WHERE device_id=$1 AND status='queued' AND expires_at>$2 LIMIT 1`,[device.id,now()]);
    return result.rowCount === 1;
  }

  async function beginForm(rawDeviceToken,{ mobile,dateOfBirth } = {}) {
    const device = await deviceFor(rawDeviceToken);
    if (!device) throw new CheckinError('Please ask reception to set up this iPad.',401);
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const pending = await connection.query(
        `SELECT id,assignment_id,attempts FROM clinic_checkin_form_handoffs
         WHERE device_id=$1 AND status='queued' AND expires_at>$2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,[device.id,now()]);
      if (!pending.rowCount) throw new CheckinError('Please ask reception to prepare your form.',409);
      const identity = await connection.query(
        `SELECT c.normalized_mobile,c.date_of_birth::text AS date_of_birth
         FROM consultation_form_assignments a
         JOIN appointments ap ON ap.id=a.appointment_id
           AND ap.crm_v2_client_id=a.crm_v2_client_id AND ap.client_id IS NULL
         JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id AND c.status='active'
         WHERE a.id=$1 AND a.client_id IS NULL
           AND a.status IN ('not_sent','sent','opened')
           AND ap.status IN ('scheduled','confirmed') LIMIT 1`,[pending.rows[0].assignment_id]);
      let dob=null;
      try { dob=normalizeDateOfBirth(dateOfBirth,{required:true}); } catch (_error) { /* Count invalid values as attempts. */ }
      const client=identity.rows[0];
      if (!client || !dob || !normalizeMobile(mobile)
        || client.normalized_mobile!==normalizeMobile(mobile)
        || String(client.date_of_birth||'')!==dob) {
        await connection.query(
          `UPDATE clinic_checkin_form_handoffs
           SET attempts=attempts+1,
               status=CASE WHEN attempts>=4 THEN 'cancelled' ELSE status END,
               finished_at=CASE WHEN attempts>=4 THEN $2 ELSE finished_at END
           WHERE id=$1`,[pending.rows[0].id,now()]);
        await connection.query('COMMIT');
        return { verified:false };
      }
      const form = await formService.issueAccessToken({ assignmentId:pending.rows[0].assignment_id });
      const visit = randomToken();
      if (!validToken(visit)) throw new Error('Invalid generated form session');
      const expiresAt = new Date(now().getTime()+40*60*1000);
      const bounded = await connection.query(
        `UPDATE consultation_form_assignments SET access_expires_at=$3
         WHERE id=$1 AND access_token_hash=$2`,
        [pending.rows[0].assignment_id,clientForms.hashAccessToken(form.token),expiresAt]);
      if (bounded.rowCount !== 1) throw new CheckinError('This form changed. Ask reception to prepare it again.',409);
      await connection.query(
        `UPDATE clinic_checkin_form_handoffs
         SET status='claimed',form_token_hash=$2,visit_token_hash=$3,expires_at=$4
         WHERE id=$1`,[pending.rows[0].id,clientForms.hashAccessToken(form.token),digest(visit),expiresAt]);
      await connection.query('COMMIT');
      return { formToken:form.token,visitToken:visit };
    } catch(error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }

  async function formAccess(rawFormToken,rawVisitToken) {
    if (!validToken(rawFormToken)) return { kiosk:false };
    const result = await db.query(
      `SELECT h.id,h.status,h.visit_token_hash,h.expires_at,d.revoked_at
       FROM clinic_checkin_form_handoffs h
       JOIN clinic_checkin_devices d ON d.id=h.device_id
       WHERE h.form_token_hash=$1 LIMIT 1`,[digest(rawFormToken)]);
    const row = result.rows[0];
    if (!row) return { kiosk:false };
    return { kiosk:true,allowed:row.status==='claimed' && !row.revoked_at
      && new Date(row.expires_at)>now() && validToken(rawVisitToken)
      && row.visit_token_hash===digest(rawVisitToken) };
  }

  async function finishForm(rawFormToken,rawVisitToken) {
    const access = await formAccess(rawFormToken,rawVisitToken);
    if (!access.kiosk || !access.allowed) return false;
    const result = await db.query(
      `UPDATE clinic_checkin_form_handoffs SET status='finished',finished_at=$3
       WHERE form_token_hash=$1 AND visit_token_hash=$2 AND status='claimed'
       RETURNING assignment_id`,[digest(rawFormToken),digest(rawVisitToken),now()]);
    if (result.rowCount) await db.query(
      `UPDATE consultation_form_assignments SET access_expires_at=$3
       WHERE id=$1 AND access_token_hash=$2`,[result.rows[0].assignment_id,digest(rawFormToken),now()]);
    return result.rowCount===1;
  }

  async function cancelDeviceForm(rawDeviceToken) {
    const device = await deviceFor(rawDeviceToken);
    if (!device) return;
    const result = await db.query(
      `UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
       WHERE device_id=$1 AND status='claimed' RETURNING assignment_id,form_token_hash`,[device.id,now()]);
    for (const row of result.rows) await db.query(
      `UPDATE consultation_form_assignments SET access_expires_at=$3
       WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
  }

  async function begin(rawDeviceToken) {
    const device = await deviceFor(rawDeviceToken);
    if (!device) throw new CheckinError('Please ask reception to set up this iPad.', 401);
    const recent = await db.query(
      `SELECT COUNT(*)::int AS attempts FROM clinic_checkin_sessions
       WHERE device_id=$1 AND created_at>$2`,[device.id,new Date(now().getTime()-60*60*1000)]);
    if (Number(recent.rows[0]?.attempts||0)>=30) throw new CheckinError('Please ask reception to help with check-in.',429);
    const value = randomToken();
    if (!validToken(value)) throw new Error('Invalid generated check-in session');
    const expiresAt = new Date(now().getTime() + SESSION_MS);
    await db.query(
      `INSERT INTO clinic_checkin_sessions(device_id,token_hash,expires_at)
       VALUES($1,$2,$3)`, [device.id, digest(value), expiresAt]);
    return { token: value, expiresAt };
  }

  async function active(rawDeviceToken, rawSessionToken, queryable = db, lock = false) {
    const device = await deviceFor(rawDeviceToken, queryable);
    if (!device || !validToken(rawSessionToken)) return null;
    const result = await queryable.query(
      `SELECT id,device_id FROM clinic_checkin_sessions
       WHERE device_id=$1 AND token_hash=$2 AND status='active'
         AND expires_at>$3 LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [device.id, digest(rawSessionToken), now()]);
    return result.rows[0] || null;
  }

  async function finish(rawDeviceToken, rawSessionToken) {
    const current = await active(rawDeviceToken, rawSessionToken);
    if (!current) return false;
    const result = await db.query(
      `UPDATE clinic_checkin_sessions SET status='cancelled',finished_at=$2
       WHERE id=$1 AND status='active' RETURNING id`, [current.id, now()]);
    return result.rowCount === 1;
  }

  async function register({ deviceToken, sessionToken, name, mobile, dateOfBirth }) {
    const cleanName = normalizeName(name);
    const normalizedMobile = normalizeMobile(mobile);
    let dob;
    try { dob = normalizeDateOfBirth(dateOfBirth, { required: true }); }
    catch (error) {
      if (error instanceof CrmV2Error) throw new CheckinError('Please check your date of birth.', 422);
      throw error;
    }
    if (!cleanName || !normalizedMobile) throw new CheckinError('Please check your name and mobile number.', 422);
    const connection = await db.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const session = await active(deviceToken, sessionToken, connection, true);
      if (!session) throw new CheckinError('This check-in has ended. Please ask reception to start again.', 410);
      // Existing clients and ambiguous identities go to reception without any
      // client details being disclosed to the person holding the tablet.
      const repo = new PostgresCrmV2ClientRepository(connection);
      await repo.lockNormalizedMobile(normalizedMobile);
      const byPhone = await repo.findActiveByNormalizedMobile(normalizedMobile, { forUpdate: true });
      const byIdentity = await connection.query(
        `SELECT id FROM crm_v2_clients WHERE status='active'
         AND lower(name)=lower($1) AND date_of_birth=$2::date LIMIT 1`, [cleanName, dob]);
      let state = 'needs_staff';
      let clientId = null;
      if (!byPhone.length && !byIdentity.rowCount) {
        const crm = createCrmV2ClientService({ repository: repo });
        const created = await crm.createClient({ name: cleanName, mobile: normalizedMobile,
          actorReference: `clinic_ipad:${session.device_id}` });
        if (created.status === 'created') {
          const updated = await crm.updateClient({ clientId: created.client.id,
            dateOfBirth: dob, actorReference: `clinic_ipad:${session.device_id}` });
          if (updated.status !== 'updated') throw new CheckinError('Please ask reception to finish your check-in.', 409);
          clientId = created.client.id;
          await connection.query(
            `INSERT INTO crm_v2_client_relationships
             (client_id,relationship_type,owner_staff_id,status,source)
             VALUES($1,'clinic',NULL,'active','clinic_ipad_checkin')
             ON CONFLICT (client_id) WHERE relationship_type='clinic'
             DO UPDATE SET status='active',updated_at=NOW()`, [clientId]);
          state = 'completed';
        }
      }
      await connection.query(
        `UPDATE clinic_checkin_sessions
         SET status=$2,crm_v2_client_id=$3,finished_at=$4 WHERE id=$1`,
        [session.id, state, clientId, now()]);
      await connection.query('COMMIT');
      return { state };
    } catch (error) {
      try { await connection.query('ROLLBACK'); } catch (_error) { /* Preserve original error. */ }
      throw error;
    } finally { connection.release(); }
  }

  return { canActivate, activate, revoke, listDevices, listFormAssignments, queueForm,
    readyForm, beginForm, formAccess, finishForm, cancelDeviceForm,
    deviceFor, begin, active, finish, register };
}

module.exports = { createClinicIpadCheckinService, CheckinError, SESSION_MS, validToken };
