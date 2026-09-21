'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const {
  CrmV2Error,
  normalizeName,
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
  return /^27[678][0-9]{8}$/.test(digits) ? `+27 •• ••• ${digits.slice(-4)}` : 'Verified with WhatsApp';
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
    mobileEditable: false,
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
              mobile_verified_at,status,updated_at
         FROM crm_v2_clients
        WHERE id=$1
          AND status='active'
          AND mobile_verified_at IS NOT NULL
        LIMIT 1`,
      [clientId],
    );
    return publicProfile(result.rows[0]);
  }

  async function updateProfile({ sessionId, crmV2ClientId, expectedRevision, name, dateOfBirth, gender } = {}) {
    const session = positiveId(sessionId);
    const clientId = positiveId(crmV2ClientId);
    if (!session || !clientId) {
      throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID', 'Your secure session has expired. Please sign in again.', 401);
    }
    const expected = requireRevision(expectedRevision);
    const requested = normalizeProfile({ name, dateOfBirth, gender });
    if (typeof db.connect !== 'function') throw new Error('My Shiloh profile updates require a transactional database');

    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
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
            AND c.mobile_verified_at IS NOT NULL
          LIMIT 1
          FOR UPDATE OF c`,
        [session, clientId, now()],
      );
      const current = result.rows[0];
      if (!current) {
        throw new MyShilohProfileError('MY_SHILOH_PROFILE_SESSION_INVALID', 'Your secure session has expired. Please sign in again.', 401);
      }
      if (profileRevision(current) !== expected) {
        throw new MyShilohProfileError('MY_SHILOH_PROFILE_STALE', 'Your profile changed. Reload it before saving again.', 409);
      }
      const currentDob = dateOnly(current.date_of_birth);
      const changedFields = [];
      if (String(current.name || '') !== requested.name) changedFields.push('name');
      if (currentDob !== requested.dateOfBirth) changedFields.push('dateOfBirth');
      if ((current.gender || null) !== requested.gender) changedFields.push('gender');
      if (!changedFields.length) {
        await client.query('COMMIT');
        return { status: 'unchanged', profile: publicProfile(current) };
      }

      const profileStatus = 'registered';
      const provenance = {
        ...(current.provenance || {}),
        lastProfileUpdate: { via: 'my_shiloh', at: now().toISOString() },
      };
      const updated = await client.query(
        `UPDATE crm_v2_clients
            SET name=$2,
                date_of_birth=$3::date,
                gender=$4,
                profile_status=$5,
                provenance=$6::jsonb,
                updated_at=NOW()
          WHERE id=$1
          RETURNING id,name,normalized_mobile,date_of_birth,gender,profile_status,
                    mobile_verified_at,status,updated_at`,
        [clientId, requested.name, requested.dateOfBirth, requested.gender, profileStatus, JSON.stringify(provenance)],
      );
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
      throw error;
    } finally {
      client.release();
    }
  }

  return { loadProfile, updateProfile };
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
