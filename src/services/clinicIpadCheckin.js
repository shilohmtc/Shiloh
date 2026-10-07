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
function newSetupCode() { return String(crypto.randomInt(0,10_000_000_000)).padStart(10,'0'); }
function newPairId() { return crypto.randomBytes(16).toString('base64url'); }
function validPairId(value) { return /^[A-Za-z0-9_-]{22}$/.test(String(value||'')); }

class CheckinError extends Error {
  constructor(message, status = 400) { super(message); this.httpStatus = status; }
}

function createClinicIpadCheckinService({ db = pool, now = () => new Date(), randomToken = token, randomSetupCode = newSetupCode,
  randomPairId = newPairId,
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

  async function createSetupCode(adminId) {
    const authority = await canActivate(adminId);
    if (!authority) throw new CheckinError('Clinic client management access is required.',403);
    for (let attempt=0;attempt<3;attempt++) {
      const code=randomSetupCode();
      if (!/^\d{10}$/.test(code)) throw new Error('Invalid generated setup code');
      const result=await db.query(
        `INSERT INTO clinic_checkin_setup_codes(code_hash,created_by_admin_id,expires_at)
         VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING code_hash`,
        [digest(code),authority.operatorAdminId,new Date(now().getTime()+5*60*1000)]);
      if (result.rowCount) return { code,expiresInSeconds:300 };
    }
    throw new Error('Could not generate a unique setup code');
  }

  async function redeemSetupCode(code) {
    if (!/^\d{10}$/.test(String(code||''))) throw new CheckinError('That setup code is invalid or has expired.',409);
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const used=await connection.query(
        `UPDATE clinic_checkin_setup_codes SET redeemed_at=$2
         WHERE code_hash=$1 AND redeemed_at IS NULL AND expires_at>$2
         RETURNING created_by_admin_id`,[digest(code),now()]);
      if (!used.rowCount) throw new CheckinError('That setup code is invalid or has expired.',409);
      const value=randomToken();
      if (!validToken(value)) throw new Error('Invalid generated check-in capability');
      const device=await connection.query(
        `INSERT INTO clinic_checkin_devices(token_hash,activated_by_admin_id)
         VALUES($1,$2) RETURNING id`,[digest(value),used.rows[0].created_by_admin_id]);
      await connection.query(
        `UPDATE clinic_checkin_setup_codes SET device_id=$2 WHERE code_hash=$1`,[digest(code),device.rows[0].id]);
      await connection.query('COMMIT');
      return { deviceId:device.rows[0].id,token:value };
    } catch(error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }

  async function startPair() {
    const value=randomToken(),pairId=randomPairId();
    if (!validToken(value) || !validPairId(pairId)) throw new Error('Invalid generated iPad pairing');
    await db.query(
      `INSERT INTO clinic_checkin_pairings(pair_id,device_token_hash,expires_at)
       VALUES($1,$2,$3)`,[pairId,digest(value),new Date(now().getTime()+5*60*1000)]);
    return { pairId,token:value };
  }

  async function pairFor(rawToken,pairId) {
    if (!validToken(rawToken) || !validPairId(pairId)) return null;
    const result=await db.query(
      `SELECT device_id FROM clinic_checkin_pairings
       WHERE pair_id=$1 AND device_token_hash=$2 AND expires_at>$3 LIMIT 1`,
      [pairId,digest(rawToken),now()]);
    return result.rows[0]||null;
  }

  async function pairDetails(adminId,pairId) {
    if (!await canActivate(adminId)) throw new CheckinError('Clinic client management access is required.',403);
    if (!validPairId(pairId)) throw new CheckinError('Invalid iPad pairing.',404);
    const result=await db.query(
      `SELECT device_id FROM clinic_checkin_pairings WHERE pair_id=$1 AND expires_at>$2 LIMIT 1`,
      [pairId,now()]);
    return result.rows[0]||null;
  }

  async function approvePair(adminId,pairId) {
    const authority=await canActivate(adminId);
    if (!authority) throw new CheckinError('Clinic client management access is required.',403);
    if (!validPairId(pairId)) throw new CheckinError('Invalid iPad pairing.',404);
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const pending=await connection.query(
        `SELECT device_token_hash FROM clinic_checkin_pairings
         WHERE pair_id=$1 AND expires_at>$2 AND approved_at IS NULL FOR UPDATE`,[pairId,now()]);
      if (!pending.rowCount) throw new CheckinError('This QR code has expired or was already approved.',409);
      const device=await connection.query(
        `INSERT INTO clinic_checkin_devices(token_hash,activated_by_admin_id)
         VALUES($1,$2) RETURNING id`,[pending.rows[0].device_token_hash,authority.operatorAdminId]);
      await connection.query(
        `UPDATE clinic_checkin_pairings SET approved_by_admin_id=$2,approved_at=$3,device_id=$4
         WHERE pair_id=$1`,[pairId,authority.operatorAdminId,now(),device.rows[0].id]);
      await connection.query('COMMIT');
      return {deviceId:device.rows[0].id};
    }catch(error){await connection.query('ROLLBACK');throw error;}
    finally{connection.release();}
  }

  async function revoke(adminId, deviceId) {
    const authority = await clientMutations.resolveManageAccess(adminId);
    if (!authority || authority.clientScope.kind !== 'clinic') throw new CheckinError('Clinic client management access is required.', 403);
    if (!/^\d+$/.test(String(deviceId || ''))) throw new CheckinError('Invalid device reference');
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const result=await connection.query(`UPDATE clinic_checkin_devices SET revoked_at=$2
        WHERE id=$1 AND revoked_at IS NULL RETURNING id`,[deviceId,now()]);
      if (result.rowCount) {
        const cancelled=await connection.query(`UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
          WHERE device_id=$1 AND status IN ('queued','claimed') RETURNING *`,[deviceId,now()]);
        for (const row of cancelled.rows) {
          if (row.form_token_hash) await connection.query(`UPDATE consultation_form_assignments SET access_expires_at=$3
            WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
          await handoverAudit(connection,'clinic_ipad_handover_revoked',authority.operatorAdminId,row);
        }
      }
      await connection.query('COMMIT');
      return result.rowCount===1;
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
  }

  async function listDevices(adminId) {
    if (!await canActivate(adminId)) throw new CheckinError('Clinic client management access is required.', 403);
    const result = await db.query(
      `SELECT id,created_at,revoked_at FROM clinic_checkin_devices
       ORDER BY created_at DESC,id DESC LIMIT 30`);
    return result.rows;
  }

  async function requireFormPreparationAccess(adminId) {
    if (!await canActivate(adminId)) throw new CheckinError('Clinic client management access is required.', 403);
    const formsAccess = await formsAuthority.resolveAccess(adminId);
    if (formsAccess?.formScope !== 'all_business') throw new CheckinError('Forms access is required.', 403);
    const bookingAccess = await resolveCalendarAuthority(db,adminId);
    if (bookingAccess?.calendarAuthority?.calendarScope !== 'all_business'
      || !hasCapability(bookingAccess.calendarAuthority,CALENDAR_CAPABILITIES.BOOKING_CREATE)
      || !hasCapability(bookingAccess.calendarAuthority,CALENDAR_CAPABILITIES.CLIENT_LOOKUP)) {
      throw new CheckinError('Reception booking access is required.',403);
    }
  }

  async function listFormAssignments(adminId, appointmentId) {
    await requireFormPreparationAccess(adminId);
    if (!/^\d+$/.test(String(appointmentId || ''))) throw new CheckinError('Invalid appointment reference.');
    const result = await db.query(
      `SELECT a.id,a.status,t.title,c.name AS client_name,
              right(c.normalized_mobile,4) AS mobile_last4,ap.starts_at,h.id AS handoff_id,h.device_id AS handoff_device_id,h.status AS handoff_status
         FROM consultation_form_assignments a
       JOIN appointments ap ON ap.id=a.appointment_id
       JOIN crm_v2_clients c ON c.id=ap.crm_v2_client_id AND c.status='active'
       JOIN crm_v2_client_relationships rel ON rel.client_id=ap.crm_v2_client_id
         AND rel.relationship_type='clinic' AND rel.status='active'
       JOIN consultation_form_template_versions v ON v.id=a.template_version_id
       JOIN consultation_form_templates t ON t.id=v.template_id AND t.status='active'
       LEFT JOIN LATERAL (SELECT id,device_id,status FROM clinic_checkin_form_handoffs existing
         WHERE existing.assignment_id=a.id AND existing.status IN ('queued','claimed') AND existing.expires_at>NOW()
         ORDER BY existing.id DESC LIMIT 1) h ON TRUE
         WHERE ap.id=$1 AND ap.client_id IS NULL AND ap.status IN ('scheduled','confirmed')
         AND a.crm_v2_client_id=ap.crm_v2_client_id AND a.client_id IS NULL
         AND a.status IN ('not_sent','sent','opened')
         ORDER BY a.id`, [appointmentId]);
    return result.rows;
  }

  function identityRevision(row) {
    return digest(JSON.stringify([String(row.crm_v2_client_id),String(row.appointment_id),
      String(row.template_version_id),row.normalized_mobile,row.date_of_birth,row.name,
      String(row.client_updated_at),String(row.starts_at),String(row.appointment_updated_at),row.appointment_status]));
  }
  async function boundIdentity(connection, assignmentId) {
    const result = await connection.query(
      `SELECT a.crm_v2_client_id,a.appointment_id,a.template_version_id,
              c.normalized_mobile,c.date_of_birth::text AS date_of_birth,c.name,
              c.updated_at AS client_updated_at,ap.starts_at,ap.updated_at AS appointment_updated_at,ap.status AS appointment_status
       FROM consultation_form_assignments a
       JOIN appointments ap ON ap.id=a.appointment_id AND ap.crm_v2_client_id=a.crm_v2_client_id
       JOIN crm_v2_clients c ON c.id=a.crm_v2_client_id AND c.status='active'
       JOIN consultation_form_template_versions v ON v.id=a.template_version_id
       JOIN consultation_form_templates t ON t.id=v.template_id AND t.status='active'
       WHERE a.id=$1 AND a.client_id IS NULL AND ap.client_id IS NULL
         AND a.status IN ('not_sent','sent','opened') AND ap.status IN ('scheduled','confirmed')
         AND EXISTS (SELECT 1 FROM crm_v2_client_relationships rel WHERE rel.client_id=c.id
           AND rel.relationship_type='clinic' AND rel.status='active')
       FOR UPDATE OF a,ap,c`,[assignmentId]);
    return result.rows[0];
  }
  async function handoverAudit(connection,event,actor,handoff,extra={}) {
    await connection.query(
      `INSERT INTO staff_auth_security_events(event_type,operator_admin_id,metadata)
       VALUES($1,$2,$3::jsonb)`,[event,actor,JSON.stringify({handoffId:handoff.id,
        deviceId:handoff.device_id,assignmentId:handoff.assignment_id,
        clientId:handoff.crm_v2_client_id,appointmentId:handoff.appointment_id,...extra})]);
  }
  async function queueForm(adminId, deviceId, appointmentId, assignmentId) {
    const assignments = await listFormAssignments(adminId,appointmentId);
    const selected = assignments.find(row => String(row.id) === String(assignmentId));
    if (!selected) throw new CheckinError('This form is not available for that appointment.',409);
    if (!/^\d+$/.test(String(deviceId || ''))) throw new CheckinError('Invalid iPad reference.');
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      const device = await connection.query(
        `SELECT id FROM clinic_checkin_devices WHERE id=$1 AND revoked_at IS NULL FOR UPDATE`,[deviceId]);
      if (!device.rowCount) throw new CheckinError('This iPad is not active.',404);
      await connection.query('SELECT pg_advisory_xact_lock(-$1::bigint)',[selected.id]);
      const identity = await boundIdentity(connection,selected.id);
      if (!identity || String(identity.appointment_id)!==String(appointmentId)) throw new CheckinError('This form changed. Please refresh the appointment.',409);
      const prepared=await connection.query(
        `SELECT id FROM clinic_checkin_form_handoffs
         WHERE assignment_id=$1 AND status IN ('queued','claimed') AND expires_at>$2 LIMIT 1`,[selected.id,now()]);
      if (prepared.rowCount) throw new CheckinError('This form is already prepared.',409);
      const inUse = await connection.query(
        `SELECT id FROM clinic_checkin_form_handoffs
         WHERE device_id=$1 AND status='claimed' AND expires_at>$2 LIMIT 1`,[deviceId,now()]);
      if (inUse.rowCount) throw new CheckinError('Finish the current client’s form before preparing another.',409);
      const cancelled = await connection.query(
        `UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
         WHERE device_id=$1 AND status IN ('queued','claimed') RETURNING *`,[deviceId,now()]);
      for (const row of cancelled.rows) await handoverAudit(connection,'clinic_ipad_handover_cancelled',adminId,row);
      const result=await connection.query(
        `INSERT INTO clinic_checkin_form_handoffs
         (device_id,assignment_id,queued_by_admin_id,expires_at,crm_v2_client_id,appointment_id,identity_revision)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [deviceId,selected.id,adminId,new Date(now().getTime()+15*60*1000),identity.crm_v2_client_id,appointmentId,identityRevision(identity)]);
      await handoverAudit(connection,'clinic_ipad_handover_prepared',adminId,result.rows[0]);
      await connection.query('COMMIT');
      return { queued:true,handoffId:result.rows[0].id };
    } catch(error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }
  async function lockedHandoff(connection,deviceId,handoffId=null) {
    // Same lock order as preparation and revocation: device, handoff, assignment/client.
    const device=await connection.query(
      `SELECT id FROM clinic_checkin_devices WHERE id=$1 AND revoked_at IS NULL FOR UPDATE`,[deviceId]);
    if (!device.rowCount) throw new CheckinError('This iPad is not active.',401);
    const pending=await connection.query(
      `SELECT * FROM clinic_checkin_form_handoffs WHERE device_id=$1 AND status='queued'
       AND expires_at>$2 AND ($3::bigint IS NULL OR id=$3) ORDER BY id DESC LIMIT 1 FOR UPDATE`,[deviceId,now(),handoffId]);
    const row=pending.rows[0];
    if (!row?.identity_revision) throw new CheckinError('Please ask reception to prepare your form again.',409);
    const identity=await boundIdentity(connection,row.assignment_id);
    if (!identity || String(identity.crm_v2_client_id)!==String(row.crm_v2_client_id)
      || String(identity.appointment_id)!==String(row.appointment_id)
      || identityRevision(identity)!==row.identity_revision) {
      throw new CheckinError('The client or appointment details changed. Reception must check and prepare the form again.',409);
    }
    return {row,identity};
  }
  async function confirmHandover(adminId,deviceId,handoffId,confirmed) {
    if (confirmed!==true) throw new CheckinError('Confirm the person and physical iPad before handover.',422);
    if (!/^\d+$/.test(String(deviceId||'')) || !/^\d+$/.test(String(handoffId||''))) throw new CheckinError('Invalid handover reference.');
    // Reuse every preparation authority, even when posting directly.
    await requireFormPreparationAccess(adminId);
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const {row}=await lockedHandoff(connection,deviceId,handoffId);
      if (row.handed_over_at) throw new CheckinError('This handover was already confirmed.',409);
      await connection.query(`UPDATE clinic_checkin_form_handoffs SET handed_over_at=$2,handed_over_by_admin_id=$3 WHERE id=$1`,[row.id,now(),adminId]);
      await handoverAudit(connection,'clinic_ipad_handover_confirmed',adminId,row);
      await connection.query('COMMIT');
      return {handedOver:true};
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
  }
  async function cancelHandover(adminId,deviceId,handoffId) {
    await requireFormPreparationAccess(adminId);
    if (!/^\d+$/.test(String(deviceId||'')) || !/^\d+$/.test(String(handoffId||''))) throw new CheckinError('Invalid handover reference.');
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT id FROM clinic_checkin_devices WHERE id=$1 FOR UPDATE',[deviceId]);
      const result=await connection.query(`UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$3
        WHERE id=$1 AND device_id=$2 AND status IN ('queued','claimed') RETURNING *`,[handoffId,deviceId,now()]);
      if(!result.rowCount)throw new CheckinError('This prepared form has already ended. Refresh the appointment.',409);
      const row=result.rows[0];
      if(row.form_token_hash)await connection.query(`UPDATE consultation_form_assignments SET access_expires_at=$3
        WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
      await handoverAudit(connection,'clinic_ipad_handover_cancelled',adminId,row);
      await connection.query('COMMIT');return {cancelled:true};
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
  }
  async function readyForm(rawDeviceToken) {
    const device=await deviceFor(rawDeviceToken);
    if (!device) return false;
    const result=await db.query(`SELECT id FROM clinic_checkin_form_handoffs
      WHERE device_id=$1 AND status='queued' AND handed_over_at IS NOT NULL AND expires_at>$2 LIMIT 1`,[device.id,now()]);
    return result.rowCount===1;
  }
  function confirmationToken(deviceToken,row) {
    return crypto.createHmac('sha256',deviceToken).update(`handover:${row.id}:${row.identity_revision}`).digest('base64url');
  }
  async function formDetails(rawDeviceToken) {
    const device=await deviceFor(rawDeviceToken);
    if (!device) throw new CheckinError('Please ask reception to set up this iPad.',401);
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const {row,identity}=await lockedHandoff(connection,device.id);
      if (!row.handed_over_at) throw new CheckinError('Reception must confirm the handover first.',409);
      await connection.query('COMMIT');
      return {mobile:clientForms.displayMobile(identity.normalized_mobile),dateOfBirth:identity.date_of_birth,
        confirmationToken:confirmationToken(rawDeviceToken,row),expiresAt:new Date(row.expires_at).toISOString()};
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
  }
  async function beginForm(rawDeviceToken,{ dateOfBirth,confirmationToken:provided,detailsCorrect,mobile,clientId } = {}) {
    const device=await deviceFor(rawDeviceToken);
    if (!device) throw new CheckinError('Please ask reception to set up this iPad.',401);
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const {row,identity}=await lockedHandoff(connection,device.id);
      const expected=confirmationToken(rawDeviceToken,row);
      if (!row.handed_over_at || detailsCorrect!=='yes' || !validToken(provided)
        || !crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) throw new CheckinError('Please review the details on this iPad first.',409);
      if (mobile!==undefined || clientId!==undefined) throw new CheckinError('Reception must correct client details.',422);
      if (identity.date_of_birth) {
        if (dateOfBirth!==undefined && dateOfBirth!==identity.date_of_birth) throw new CheckinError('Reception must correct your date of birth.',422);
      } else {
        let dob;
        try {dob=normalizeDateOfBirth(dateOfBirth,{required:true});}
        catch(_error) {throw new CheckinError('Please enter a valid date of birth.',422);}
        const crm=createCrmV2ClientService({repository:new PostgresCrmV2ClientRepository(connection)});
        const updated=await crm.updateClient({clientId:row.crm_v2_client_id,dateOfBirth:dob,
          actorReference:`clinic_ipad_handover:${row.id}`});
        if (updated.status!=='updated') throw new CheckinError('Reception must help save your details.',409);
        await handoverAudit(connection,'clinic_ipad_handover_dob_saved',row.handed_over_by_admin_id,row);
      }
      // Canonical issuance participates in this transaction: no token escapes a rolled-back claim.
      const form=await formService.issueAccessToken({assignmentId:row.assignment_id,transaction:connection});
      const visit=randomToken();
      if (!validToken(visit)) throw new Error('Invalid generated form session');
      const expiresAt=new Date(now().getTime()+40*60*1000);
      const bounded=await connection.query(`UPDATE consultation_form_assignments SET access_expires_at=$3
        WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,clientForms.hashAccessToken(form.token),expiresAt]);
      if (bounded.rowCount!==1) throw new CheckinError('This form changed. Ask reception to prepare it again.',409);
      await connection.query(`UPDATE clinic_checkin_form_handoffs SET status='claimed',form_token_hash=$2,
        visit_token_hash=$3,expires_at=$4 WHERE id=$1`,[row.id,clientForms.hashAccessToken(form.token),digest(visit),expiresAt]);
      await handoverAudit(connection,'clinic_ipad_handover_claimed',row.handed_over_by_admin_id,row);
      await connection.query('COMMIT');
      return {formToken:form.token,visitToken:visit};
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
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
    if(!validToken(rawFormToken)||!validToken(rawVisitToken))return false;
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      const reference=await connection.query('SELECT device_id FROM clinic_checkin_form_handoffs WHERE form_token_hash=$1 LIMIT 1',[digest(rawFormToken)]);
      if(!reference.rowCount){await connection.query('ROLLBACK');return false;}
      await connection.query('SELECT id FROM clinic_checkin_devices WHERE id=$1 FOR UPDATE',[reference.rows[0].device_id]);
      const result=await connection.query(`UPDATE clinic_checkin_form_handoffs SET status='finished',finished_at=$3
        WHERE form_token_hash=$1 AND visit_token_hash=$2 AND status='claimed' RETURNING *`,[digest(rawFormToken),digest(rawVisitToken),now()]);
      if(result.rowCount){
        const row=result.rows[0];
        await connection.query(`UPDATE consultation_form_assignments SET access_expires_at=$3
          WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
        await handoverAudit(connection,'clinic_ipad_handover_finished',row.handed_over_by_admin_id||row.queued_by_admin_id,row);
      }
      await connection.query('COMMIT');return result.rowCount===1;
    } catch(error){await connection.query('ROLLBACK');throw error;}
    finally{connection.release();}
  }

  async function cancelDeviceForm(rawDeviceToken,{includeQueued=false}={}) {
    const device=await deviceFor(rawDeviceToken);
    if (!device) return;
    const connection=await db.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT id FROM clinic_checkin_devices WHERE id=$1 FOR UPDATE',[device.id]);
      const result=await connection.query(`UPDATE clinic_checkin_form_handoffs SET status='cancelled',finished_at=$2
        WHERE device_id=$1 AND (status='claimed' OR ($3 AND status='queued')) RETURNING *`,[device.id,now(),includeQueued]);
      for (const row of result.rows) {
        if (row.form_token_hash) await connection.query(`UPDATE consultation_form_assignments SET access_expires_at=$3
          WHERE id=$1 AND access_token_hash=$2`,[row.assignment_id,row.form_token_hash,now()]);
        await handoverAudit(connection,'clinic_ipad_handover_cancelled',row.handed_over_by_admin_id||row.queued_by_admin_id,row);
      }
      await connection.query('COMMIT');
    } catch(error) {await connection.query('ROLLBACK');throw error;}
    finally {connection.release();}
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

  return { canActivate, activate, createSetupCode, redeemSetupCode, startPair, pairFor, pairDetails, approvePair, revoke, listDevices, listFormAssignments, queueForm,
    readyForm, formDetails, confirmHandover, cancelHandover, beginForm, formAccess, finishForm, cancelDeviceForm,
    deviceFor, begin, active, finish, register };
}

module.exports = { createClinicIpadCheckinService, CheckinError, SESSION_MS, validToken };
