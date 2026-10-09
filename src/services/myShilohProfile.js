'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const {
  CrmV2Error,
  normalizeName,
  normalizeMobile,
  normalizeDateOfBirth,
  normalizeGender,
} = require('./crmV2ClientService');

const PROFILE_UPDATE_EVENT = 'client_profile_updated';
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

class MyShilohProfileError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'MyShilohProfileError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const exact = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  return exact ? exact[1] : null;
}

function profileRevision(row) {
  if (!row) return null;
  const canonical = {
    id: String(row.id || ''),
    name: String(row.name || ''),
    normalizedMobile: String(row.normalized_mobile || ''),
    dateOfBirth: dateOnly(row.date_of_birth),
    gender: row.gender || null,
    profileStatus: String(row.profile_status || ''),
    mobileVerifiedAt: iso(row.mobile_verified_at),
    status: String(row.status || ''),
    updatedAt: iso(row.updated_at),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function maskMobile(value = '') {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return /^27[678][0-9]{8}$/.test(digits) ? `0•• ••• ${digits.slice(-4)}` : 'Mobile number unavailable';
}

function publicProfile(row) {
  if (!row) return null;
  const dateOfBirth = dateOnly(row.date_of_birth);
  const registrationComplete = Boolean(
    String(row.name || '').trim()
    && dateOfBirth
    && row.gender
    && row.profile_status === 'registered',
  );
  return {
    name: String(row.name || ''),
    dateOfBirth,
    gender: row.gender || null,
    registrationComplete,
    mobile: maskMobile(row.normalized_mobile),
    mobileEditable: true,
    requiresDobBeforeBooking: !dateOfBirth && row.provenance?.actorReference === 'my_shiloh_sms' && row.has_appointment === false,
    dobRequestNeeded: !dateOfBirth && row.dob_request_acknowledged === false,
    revision: profileRevision(row),
  };
}

function requireRevision(value) {
  const revision = String(value || '').trim().toLowerCase();
  if (!REVISION_PATTERN.test(revision)) {
    throw new MyShilohProfileError('MY_SHILOH_PROFILE_REVISION_INVALID', 'Reload your profile and try again.', 409);
  }
  return revision;
}

function normalizeProfile({ name, dateOfBirth, gender } = {}) {
  const cleanName = normalizeName(name);
  if (!cleanName) {
    throw new MyShilohProfileError('MY_SHILOH_PROFILE_NAME_INVALID', 'Enter your full name.', 422);
  }
  try {
    return {
      name: cleanName,
      dateOfBirth: normalizeDateOfBirth(dateOfBirth, { required: true }),
      gender: normalizeGender(gender, { required: true }),
    };
  } catch (error) {
    if (error instanceof CrmV2Error) {
      throw new MyShilohProfileError(error.code, error.message, error.httpStatus || 422);
    }
    throw error;
  }
}

function createMyShilohProfileService({ db = pool, now = () => new Date() } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('My Shiloh profile database is required');

  async function loadProfile({ crmV2ClientId } = {}) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return null;
    const result = await db.query(
      `/* myShilohProfile:load */
       SELECT id,name,normalized_mobile,date_of_birth,gender,profile_status,
              mobile_verified_at,status,updated_at,provenance,
              EXISTS (SELECT 1 FROM appointments ap WHERE ap.crm_v2_client_id=c.id) AS has_appointment,
              EXISTS (SELECT 1 FROM client_auth_security_events e WHERE e.crm_v2_client_id=c.id
                AND e.event_type='client_dob_request_acknowledged') AS dob_request_acknowledged
         FROM crm_v2_clients c
        WHERE id=$1
          AND status='active'
        LIMIT 1`,
      [clientId],
    );
    return publicProfile(result.rows[0]);
  }

  async function updateProfile({ sessionId, crmV2ClientId, expectedRevision, name, dateOfBirth, gender, mobile } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) {
      throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID', 'Your secure session has expired. Please sign in again.', 401);
    }
    const expected = requireRevision(expectedRevision);
    const requested = normalizeProfile({ name, dateOfBirth, gender });
    const nextMobile = mobile === undefined ? null :
      (typeof mobile === 'string' && /^[+\d ()-]{10,30}$/.test(mobile) ? normalizeMobile(mobile) : null);
    if (mobile !== undefined && !nextMobile) throw new MyShilohProfileError(
      'MY_SHILOH_PROFILE_MOBILE_INVALID', 'Enter a valid South African mobile number.', 422);
    if (typeof db.connect !== 'function') throw new Error('My Shiloh profile updates require a transactional database');

    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(
        `/* myShilohProfile:update-lock */
         SELECT c.id,c.name,c.normalized_mobile,c.date_of_birth,c.gender,c.profile_status,
                c.mobile_verified_at,c.status,c.provenance,c.updated_at
           FROM client_browser_sessions s
           JOIN crm_v2_clients c ON c.id=s.crm_v2_client_id
          WHERE s.id=$1
            AND s.crm_v2_client_id=$2
            AND s.revoked_at IS NULL
            AND s.expires_at>$3
            AND c.status='active'
            AND s.auth_method IN ('sms_code','passkey','passkey_recovery','whatsapp_challenge','crm_details')
            AND s.issued_at <= $3
          LIMIT 1
          FOR UPDATE OF s,c`,
        [session, clientId, now()],
      );
      const current = result.rows[0];
      if (!current) {
        throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID', 'Your secure session has expired. Please sign in again.', 401);
      }
      if (profileRevision(current) !== expected) {
        throw new MyShilohProfileError('MY_SHILOH_PROFILE_STALE', 'Your profile changed. Reload it before saving again.', 409);
      }
      const mobileChanged = nextMobile !== null && nextMobile !== current.normalized_mobile;
      if (mobileChanged) {
        // Share canonical CRM identity lock namespace with staff/registration paths.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm-v2-mobile:${nextMobile}`]);
        const owners = await client.query("SELECT id FROM crm_v2_clients WHERE normalized_mobile=$1 AND id<>$2", [nextMobile, clientId]);
        if (owners.rowCount) throw new MyShilohProfileError('MY_SHILOH_PROFILE_MOBILE_CONFLICT',
          'This number cannot be used for your profile. Please contact Reception.', 409);
      }
      if (mobileChanged) await client.query('SELECT id FROM client_browser_sessions WHERE crm_v2_client_id=$1 AND id<>$2 AND revoked_at IS NULL FOR UPDATE', [clientId, session]);
      // A transaction/identity lock wait cannot extend the authorizing session.
      const authority = await client.query(`SELECT id FROM client_browser_sessions WHERE id=$1
        AND crm_v2_client_id=$2 AND issued_at<=$3 AND expires_at>$3 AND revoked_at IS NULL`, [session, clientId, now()]);
      if (!authority.rowCount) throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID', 'Please sign in again.', 401);
      const currentDob = dateOnly(current.date_of_birth);
      const changedFields = [];
      if (String(current.name || '') !== requested.name) changedFields.push('name');
      if (currentDob !== requested.dateOfBirth) changedFields.push('dateOfBirth');
      if ((current.gender || null) !== requested.gender) changedFields.push('gender');
      if (mobileChanged) changedFields.push('mobile');
      if (!changedFields.length) {
        await client.query('COMMIT');
        return { status: 'unchanged', profile: publicProfile(current) };
      }

      const profileStatus = 'registered';
      const provenance = {
        ...(current.provenance || {}),
        lastProfileUpdate: { via: 'my_shiloh', at: now().toISOString() },
        ...(mobileChanged ? { phoneOwnershipVerified: false } : {}),
      };
      const updated = await client.query(
        `UPDATE crm_v2_clients
            SET name=$2,
                first_name=CASE WHEN name<>$2 THEN NULL ELSE first_name END,
                surname=CASE WHEN name<>$2 THEN NULL ELSE surname END,
                date_of_birth=$3::date,
                gender=$4,
                profile_status=$5,
                provenance=$6::jsonb,
                normalized_mobile=$7,
                mobile_verified_at=CASE WHEN $8 THEN NULL ELSE mobile_verified_at END,
                updated_at=NOW()
          WHERE id=$1
          RETURNING id,name,normalized_mobile,date_of_birth,gender,profile_status,
                    mobile_verified_at,status,updated_at`,
        [clientId, requested.name, requested.dateOfBirth, requested.gender, profileStatus, JSON.stringify(provenance), nextMobile || current.normalized_mobile, mobileChanged],
      );
      if (mobileChanged) {
        await client.query(`UPDATE client_browser_sessions SET revoked_at=$3,revoke_reason='mobile_changed'
          WHERE crm_v2_client_id=$1 AND id<>$2 AND revoked_at IS NULL`, [clientId, session, now()]);
        await client.query(`UPDATE client_auth_passkey_challenges SET consumed_at=$2
          WHERE crm_v2_client_id=$1 AND consumed_at IS NULL`, [clientId, now()]);
      }
      await client.query(
        `INSERT INTO client_auth_security_events
           (event_type,crm_v2_client_id,session_id,metadata)
         VALUES($1,$2,$3,$4::jsonb)`,
        [PROFILE_UPDATE_EVENT, clientId, session, JSON.stringify({ changedFields })],
      );
      await client.query('COMMIT');
      return { status: 'updated', profile: publicProfile(updated.rows[0]) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (['23505','40001','40P01'].includes(error.code)) throw new MyShilohProfileError(
        'MY_SHILOH_PROFILE_CONFLICT', 'Your profile changed or this number is unavailable. Reload and try again.', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  async function acknowledgeDobRequest({sessionId,crmV2ClientId}={}) {
    const session=positiveId(sessionId),clientId=positiveId(crmV2ClientId);
    if (!session || !clientId) throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID','Please sign in again.',401);
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      const result=await client.query(`SELECT c.id FROM client_browser_sessions s JOIN crm_v2_clients c ON c.id=s.crm_v2_client_id
        WHERE s.id=$1 AND c.id=$2 AND s.revoked_at IS NULL AND s.expires_at>$3
          AND c.status='active' AND c.mobile_verified_at IS NOT NULL FOR UPDATE OF c`,[session,clientId,now()]);
      if (!result.rows[0]) throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID','Please sign in again.',401);
      await client.query(`INSERT INTO client_auth_security_events(event_type,crm_v2_client_id,session_id,metadata)
        SELECT 'client_dob_request_acknowledged',$1,$2,'{}'::jsonb WHERE NOT EXISTS
        (SELECT 1 FROM client_auth_security_events WHERE crm_v2_client_id=$1 AND event_type='client_dob_request_acknowledged')`,[clientId,session]);
      await client.query('COMMIT');
      return {acknowledged:true};
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }
  return { loadProfile, updateProfile, acknowledgeDobRequest };
}

module.exports = {
  PROFILE_UPDATE_EVENT,
  REVISION_PATTERN,
  MyShilohProfileError,
  positiveId,
  dateOnly,
  profileRevision,
  maskMobile,
  publicProfile,
  requireRevision,
  normalizeProfile,
  createMyShilohProfileService,
};
