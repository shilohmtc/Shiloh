'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { sha256, normalizedFingerprint } = require('./clientBrowserSession');
const { verifyRegistrationResponse } = require('./staffPasskeyAuth');
const { APP_ORIGIN } = require('../config/publicOrigins');

const FEATURE_FLAG = 'SHILOH_CLIENT_PASSKEY_AUTH_ENABLED';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECENT_SESSION_MS = 10 * 60 * 1000;

function enrollmentPolicy(env = process.env) {
  if (String(env[FEATURE_FLAG] || '').toLowerCase() !== 'true') {
    return { enabled: false, operational: false };
  }
  // Client passkeys belong to My Shiloh's canonical host, independent of the
  // Calendar/Workspace origin configuration. Never choose an RP from a request.
  return { enabled: true, operational: true, origin: APP_ORIGIN, rpId: new URL(APP_ORIGIN).hostname };
}

function recentClientSession(session, now) {
  const authenticatedAt = new Date(session?.authenticatedAt).getTime();
  return session?.ok === true &&
    ['sms_code', 'passkey', 'passkey_recovery', 'whatsapp_challenge', 'crm_details'].includes(session.authMethod) &&
    (session.authMethod !== 'crm_details' || new Date(session.reauthenticatedAt).getTime() > new Date(session.issuedAt).getTime()) &&
    Number.isSafeInteger(Number(session.crmV2ClientId)) &&
    Number(session.crmV2ClientId) > 0 &&
    Number.isSafeInteger(Number(session.sessionId)) &&
    Number(session.sessionId) > 0 &&
    Number.isFinite(authenticatedAt) &&
    now.getTime() >= authenticatedAt &&
    now.getTime() - authenticatedAt <= RECENT_SESSION_MS;
}

async function recentStoredClientSession(db, session, now) {
  const result = await db.query(`SELECT id FROM client_browser_sessions
    WHERE id=$1 AND crm_v2_client_id=$2 AND revoked_at IS NULL AND expires_at>$3
      AND auth_method IN ('sms_code','passkey','passkey_recovery','whatsapp_challenge','crm_details')
      AND (auth_method <> 'crm_details' OR reauthenticated_at > issued_at)
      AND COALESCE(reauthenticated_at,issued_at) BETWEEN $3 - INTERVAL '10 minutes' AND $3
    FOR SHARE`, [session.sessionId, session.crmV2ClientId, now]);
  return result.rowCount === 1;
}

// Only first-ever enrollment may use a remembered session. Revocation and
// additional/replacement keys continue to use the existing recent-auth policy.
function enrollmentClientSession(session) {
  return session?.ok === true &&
    ['sms_code', 'passkey', 'passkey_recovery', 'whatsapp_challenge', 'crm_details'].includes(session.authMethod) &&
    Number.isSafeInteger(Number(session.crmV2ClientId)) && Number(session.crmV2ClientId) > 0 &&
    Number.isSafeInteger(Number(session.sessionId)) && Number(session.sessionId) > 0;
}

async function registrationStoredClientSession(db, session, readNow) {
  const live = (current) => db.query(`SELECT id FROM client_browser_sessions
    WHERE id=$1 AND crm_v2_client_id=$2 AND revoked_at IS NULL
      AND issued_at <= $3 AND expires_at > $3
      AND auth_method IN ('sms_code','passkey','passkey_recovery','whatsapp_challenge','crm_details')
    FOR SHARE`, [session.sessionId, session.crmV2ClientId, current]);
  let current = readNow();
  if ((await live(current)).rowCount !== 1) return { ok: false, current };
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('client-first-passkey:' || $1::text, 0))",
    [session.crmV2ClientId],
  );
  // A lock wait must not turn an expired session into enrollment authority.
  current = readNow();
  if ((await live(current)).rowCount !== 1) return { ok: false, current };
  const history = await db.query(
    'SELECT id FROM client_auth_passkey_credentials WHERE crm_v2_client_id=$1 LIMIT 1',
    [session.crmV2ClientId],
  );
  return { current, ok: history.rowCount === 0 ||
    (recentClientSession(session, current) && await recentStoredClientSession(db, session, current)) };
}

function responseChallenge(response, origin, expectedType = 'webauthn.create') {
  const encoded = String(response?.response?.clientDataJSON || '');
  if (!/^[A-Za-z0-9_-]{20,22000}$/.test(encoded)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch (_) { return null; }
  if (data?.type !== expectedType || data.origin !== origin || data.crossOrigin === true ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(data.challenge || ''))) return null;
  return data.challenge;
}

function deviceLabel(userAgent) {
  const agent = String(userAgent || '').slice(0, 512);
  if (/iPad/i.test(agent)) return 'iPad';
  if (/iPhone|iPod/i.test(agent)) return 'iPhone';
  if (/Android/i.test(agent)) return 'Android device';
  if (/Windows/i.test(agent)) return 'Windows device';
  if (/Macintosh|Mac OS X/i.test(agent)) return 'Mac';
  return 'Shiloh device';
}

function createClientPasskeyEnrollmentService({
  db = pool,
  env = process.env,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('client passkey db is required');
  const policy = () => enrollmentPolicy(env);
  const unavailable = (p) => ({ ok: false, code: p.enabled ? 'CLIENT_PASSKEY_UNAVAILABLE' : 'CLIENT_PASSKEY_DISABLED' });

  async function begin({ session, requestFingerprintHash = null } = {}) {
    const p = policy();
    if (!p.operational) return unavailable(p);
    let current = now();
    if (!enrollmentClientSession(session)) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const authority = await registrationStoredClientSession(client, session, now);
      current = authority.current;
      if (!authority.ok) {
        await client.query('ROLLBACK'); return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
      }
      // Serialize challenge issuance for one signed-in session before counting.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('client-passkey-enrollment:' || $1::text, 0))",
        [session.sessionId],
      );
      const owner = await client.query(
        `SELECT id FROM crm_v2_clients WHERE id = $1 AND status = 'active' FOR SHARE`,
        [session.crmV2ClientId],
      );
      if (owner.rowCount !== 1) { await client.query('ROLLBACK'); return { ok: false, code: 'CLIENT_PROFILE_UNAVAILABLE' }; }
      const latestAuthority = await registrationStoredClientSession(client, session, now);
      current = latestAuthority.current;
      if (!latestAuthority.ok) { await client.query('ROLLBACK'); return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' }; }
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM client_auth_passkey_challenges
          WHERE session_id = $1 AND created_at >= $2`,
        [session.sessionId, new Date(current.getTime() - 10 * 60 * 1000)],
      );
      if (Number(recent.rows[0]?.count || 0) >= 5) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_RATE_LIMITED' };
      }
      await client.query(
        `UPDATE client_auth_passkey_challenges SET consumed_at = $2
          WHERE session_id = $1 AND consumed_at IS NULL`,
        [session.sessionId, current],
      );
      const existing = await client.query(
        `SELECT credential_id FROM client_auth_passkey_credentials
          WHERE crm_v2_client_id = $1 AND revoked_at IS NULL`,
        [session.crmV2ClientId],
      );
      if (existing.rows.length >= 5) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_LIMIT_REACHED' };
      }
      const challenge = randomBytes(32).toString('base64url');
      const expiresAt = new Date(current.getTime() + CHALLENGE_TTL_MS);
      await client.query(
        `INSERT INTO client_auth_passkey_challenges
          (challenge_hash, crm_v2_client_id, session_id, request_fingerprint_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5)`,
        [sha256(challenge), session.crmV2ClientId, session.sessionId,
          normalizedFingerprint(requestFingerprintHash), expiresAt],
      );
      await client.query('COMMIT');
      const userId = Buffer.from(`crm-client:${session.crmV2ClientId}`).toString('base64url');
      return {
        ok: true,
        expiresAt,
        options: {
          challenge,
          rp: { id: p.rpId, name: 'Shiloh' },
          user: { id: userId, name: 'My Shiloh', displayName: 'My Shiloh' },
          pubKeyCredParams: [-7, -8, -257].map((alg) => ({ type: 'public-key', alg })),
          timeout: CHALLENGE_TTL_MS,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          excludeCredentials: existing.rows.map(({ credential_id }) => ({ type: 'public-key', id: credential_id })),
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function finish({ session, response, userAgent = '', requestFingerprintHash = null } = {}) {
    const p = policy();
    if (!p.operational) return unavailable(p);
    let current = now();
    if (!enrollmentClientSession(session)) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    const challenge = responseChallenge(response, p.origin);
    if (!challenge) return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const authority = await registrationStoredClientSession(client, session, now);
      current = authority.current;
      if (!authority.ok) {
        await client.query('ROLLBACK'); return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
      }
      const found = await client.query(
        `SELECT id, expires_at FROM client_auth_passkey_challenges
          WHERE challenge_hash = $1 AND crm_v2_client_id = $2 AND session_id = $3
            AND consumed_at IS NULL FOR UPDATE`,
        [sha256(challenge), session.crmV2ClientId, session.sessionId],
      );
      const row = found.rows[0];
      if (!row || new Date(row.expires_at).getTime() <= current.getTime()) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      // Consume even an invalid response so a challenge cannot be repeatedly probed.
      await client.query('UPDATE client_auth_passkey_challenges SET consumed_at = $2 WHERE id = $1', [row.id, current]);
      const owner = await client.query(
        `SELECT id FROM crm_v2_clients WHERE id = $1 AND status = 'active' FOR SHARE`,
        [session.crmV2ClientId],
      );
      if (owner.rowCount !== 1) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PROFILE_UNAVAILABLE' };
      }
      let verified;
      try { verified = verifyRegistrationResponse(response, { expectedChallenge: challenge, origin: p.origin, rpId: p.rpId }); }
      catch (_) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      const finalAuthority = await registrationStoredClientSession(client, session, now);
      current = finalAuthority.current;
      if (!finalAuthority.ok || new Date(row.expires_at).getTime() <= current.getTime()) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      const duplicate = await client.query(
        'SELECT id FROM client_auth_passkey_credentials WHERE credential_id = $1', [verified.credentialId],
      );
      if (duplicate.rowCount) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      const inserted = await client.query(
        `INSERT INTO client_auth_passkey_credentials
          (crm_v2_client_id, credential_id, public_key_spki, algorithm, sign_count, transports, backed_up, device_label)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
        [session.crmV2ClientId, verified.credentialId, verified.publicKeySpki,
          verified.algorithm, verified.signCount, JSON.stringify(verified.transports), verified.backedUp, deviceLabel(userAgent)],
      );
      await client.query(
        `INSERT INTO client_auth_security_events
          (event_type, crm_v2_client_id, session_id, request_fingerprint_hash, metadata)
          VALUES ('passkey_registered', $1, $2, $3, $4::jsonb)`,
        [session.crmV2ClientId, session.sessionId, normalizedFingerprint(requestFingerprintHash),
          JSON.stringify({ credentialReference: `passkey:${inserted.rows[0].id}` })],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      if (error.code === '23505') return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function list({ session } = {}) {
    const p = policy();
    if (!p.operational) return unavailable(p);
    if (session?.ok !== true || !Number.isSafeInteger(Number(session.crmV2ClientId))) {
      return { ok: false, code: 'CLIENT_SESSION_INVALID' };
    }
    const result = await db.query(
      `SELECT id, device_label, created_at, last_used_at, backed_up
         FROM client_auth_passkey_credentials
        WHERE crm_v2_client_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`,
      [session.crmV2ClientId],
    );
    return { ok: true, devices: result.rows.map((row) => ({
      id: Number(row.id), label: row.device_label, createdAt: row.created_at,
      lastUsedAt: row.last_used_at, backedUp: row.backed_up,
    })) };
  }

  async function revoke({ session, credentialId, requestFingerprintHash = null } = {}) {
    const p = policy();
    if (!p.operational) return unavailable(p);
    const current = now();
    if (!recentClientSession(session, current)) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    if (!Number.isSafeInteger(credentialId) || credentialId <= 0) {
      return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
    }
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      if (!(await recentStoredClientSession(client, session, current))) {
        await client.query('ROLLBACK'); return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
      }
      const found = await client.query(
        `SELECT id FROM client_auth_passkey_credentials
          WHERE id = $1 AND crm_v2_client_id = $2 AND revoked_at IS NULL FOR UPDATE`,
        [credentialId, session.crmV2ClientId],
      );
      if (found.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      await client.query('UPDATE client_auth_passkey_credentials SET revoked_at = $2 WHERE id = $1', [credentialId, current]);
      // Legacy passkey sessions have no credential link. Revoke those for this
      // client as well so removing a lost key cannot leave an old session open.
      await client.query(
        `UPDATE client_browser_sessions SET revoked_at = $3
          WHERE crm_v2_client_id = $1 AND revoked_at IS NULL
            AND (passkey_credential_id = $2 OR (passkey_credential_id IS NULL AND auth_method = 'passkey'))`,
        [session.crmV2ClientId, credentialId, current],
      );
      await client.query(
        `INSERT INTO client_auth_security_events
          (event_type, crm_v2_client_id, session_id, request_fingerprint_hash, metadata)
          VALUES ('passkey_revoked', $1, $2, $3, $4::jsonb)`,
        [session.crmV2ClientId, session.sessionId, normalizedFingerprint(requestFingerprintHash),
          JSON.stringify({ credentialReference: `passkey:${credentialId}` })],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  return { policy, begin, finish, list, revoke };
}

module.exports = { FEATURE_FLAG, CHALLENGE_TTL_MS, RECENT_SESSION_MS,
  enrollmentPolicy, recentClientSession, recentStoredClientSession, responseChallenge, deviceLabel, createClientPasskeyEnrollmentService };
