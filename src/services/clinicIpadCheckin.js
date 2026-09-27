'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');
const {
  createCrmV2ClientService, CrmV2Error, normalizeName, normalizeMobile, normalizeDateOfBirth,
} = require('./crmV2ClientService');
const { createWorkspaceClientMutationService } = require('./workspaceClientMutations');

const SESSION_MS = 12 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
function token() { return crypto.randomBytes(32).toString('base64url'); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validToken(value) { return TOKEN_PATTERN.test(String(value || '')); }

class CheckinError extends Error {
  constructor(message, status = 400) { super(message); this.httpStatus = status; }
}

function createClinicIpadCheckinService({ db = pool, now = () => new Date(), randomToken = token,
  clientMutations = createWorkspaceClientMutationService({ db }) } = {}) {
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
    return result.rowCount === 1;
  }

  async function begin(rawDeviceToken) {
    const device = await deviceFor(rawDeviceToken);
    if (!device) throw new CheckinError('Please ask reception to set up this iPad.', 401);
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

  return { canActivate, activate, revoke, deviceFor, begin, active, finish, register };
}

module.exports = { createClinicIpadCheckinService, CheckinError, SESSION_MS, validToken };
