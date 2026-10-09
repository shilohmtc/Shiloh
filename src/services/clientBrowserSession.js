'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
// New client sessions expire 30 days after sign-in; activity never renews this deadline.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomOpaqueToken(randomBytes = crypto.randomBytes) {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function isValidOpaqueToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function firstName(value = '') {
  return String(value || '').trim().split(/\s+/)[0] || 'there';
}

function normalizedFingerprint(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

function publicClient(row = {}) {
  return {
    id: String(row.id),
    name: String(row.name || 'Client'),
    firstName: firstName(row.name),
  };
}

function createClientBrowserSessionService({
  db = pool,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('client browser session db is required');

  async function audit(client, eventType, {
    clientId = null,
    challengeId = null,
    sessionId = null,
    requestFingerprintHash = null,
    metadata = {},
  } = {}) {
    await client.query(
      `INSERT INTO client_auth_security_events
         (event_type, crm_v2_client_id, challenge_id, session_id, request_fingerprint_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        String(eventType || '').slice(0, 80),
        clientId == null ? null : Number(clientId),
        challengeId == null ? null : Number(challengeId),
        sessionId == null ? null : Number(sessionId),
        normalizedFingerprint(requestFingerprintHash),
        JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
      ],
    );
  }

  // Called only inside the caller's transaction after its method-specific proof.
  // CRM details deliberately provide lower assurance, not verified phone ownership.
  async function insertVerifiedSession(client, owner, current, authMethod, fingerprint, passkeyCredentialId = null) {
    if (!['passkey', 'passkey_recovery', 'sms_code', 'crm_details'].includes(authMethod)) throw new Error('invalid client session method');
    const sessionToken = randomOpaqueToken(randomBytes);
    const csrfToken = randomOpaqueToken(randomBytes);
    const expiresAt = new Date(current.getTime() + SESSION_TTL_MS);
    const inserted = await client.query(
      `INSERT INTO client_browser_sessions
         (crm_v2_client_id, token_hash, csrf_hash, issued_at, expires_at, reauthenticated_at,
          auth_method, client_fingerprint_hash, passkey_credential_id)
       VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8)
       RETURNING id`,
      [owner.id, sha256(sessionToken), sha256(csrfToken), current, expiresAt, authMethod, fingerprint, passkeyCredentialId],
    );
    return {
      ok: true, status: 'authenticated', sessionToken, csrfToken,
      sessionId: inserted.rows[0].id, expiresAt, client: publicClient(owner),
    };
  }

  async function issueVerifiedPasskeySession({ transaction, crmV2ClientId, passkeyCredentialId, requestFingerprintHash = null } = {}) {
    if (!transaction || typeof transaction.query !== 'function' ||
        !Number.isSafeInteger(Number(crmV2ClientId)) || Number(crmV2ClientId) <= 0 ||
        !Number.isSafeInteger(Number(passkeyCredentialId)) || Number(passkeyCredentialId) <= 0) {
      return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    }
    const owner = await transaction.query(
      `SELECT id, name FROM crm_v2_clients WHERE id = $1 AND status = 'active' FOR SHARE`,
      [crmV2ClientId],
    );
    if (owner.rowCount !== 1) return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const result = await insertVerifiedSession(transaction, owner.rows[0], now(), 'passkey', fingerprint, passkeyCredentialId);
    await audit(transaction, 'session_issued', {
      clientId: owner.rows[0].id, sessionId: result.sessionId,
      requestFingerprintHash: fingerprint, metadata: { authMethod: 'passkey' },
    });
    return result;
  }

  // Called only after a recovery code is consumed in the caller's transaction.
  async function issueVerifiedRecoverySession({ transaction, crmV2ClientId, requestFingerprintHash = null } = {}) {
    if (!transaction || typeof transaction.query !== 'function' ||
        !Number.isSafeInteger(Number(crmV2ClientId)) || Number(crmV2ClientId) <= 0) {
      return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    }
    const owner = await transaction.query(
      `SELECT id, name FROM crm_v2_clients WHERE id = $1 AND status = 'active' FOR SHARE`,
      [crmV2ClientId],
    );
    if (owner.rowCount !== 1) return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const result = await insertVerifiedSession(transaction, owner.rows[0], now(), 'passkey_recovery', fingerprint, null);
    await audit(transaction, 'session_issued', {
      clientId: owner.rows[0].id, sessionId: result.sessionId,
      requestFingerprintHash: fingerprint, metadata: { authMethod: 'passkey_recovery' },
    });
    return result;
  }

  // The caller must have consumed a valid SMS challenge for the exact mobile
  // matching this CRM owner inside its transaction before calling this method.
  async function issueVerifiedSmsSession({ transaction, crmV2ClientId, normalizedMobile, requestFingerprintHash = null } = {}) {
    if (!transaction || typeof transaction.query !== 'function' || !Number.isSafeInteger(Number(crmV2ClientId)) ||
        Number(crmV2ClientId) <= 0 || !/^27[678]\d{8}$/.test(String(normalizedMobile || ''))) {
      return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    }
    const owner = await transaction.query(
      `SELECT id, name FROM crm_v2_clients WHERE id = $1 AND normalized_mobile = $2 AND status = 'active' FOR SHARE`,
      [crmV2ClientId, normalizedMobile],
    );
    if (owner.rowCount !== 1) return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const result = await insertVerifiedSession(transaction, owner.rows[0], now(), 'sms_code', fingerprint, null);
    await audit(transaction, 'session_issued', {
      clientId: owner.rows[0].id, sessionId: result.sessionId,
      requestFingerprintHash: fingerprint, metadata: { authMethod: 'sms_code' },
    });
    return result;
  }

  // CRM service must lock and match the complete canonical record in this transaction.
  async function issueCrmDetailSession({ transaction, owner, requestFingerprintHash = null } = {}) {
    if (!transaction || typeof transaction.query !== 'function' || !owner ||
        !Number.isSafeInteger(Number(owner.id)) || Number(owner.id) <= 0 || owner.status !== 'active') return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const result = await insertVerifiedSession(transaction, owner, now(), 'crm_details', fingerprint);
    await audit(transaction, 'session_issued', { clientId: owner.id, sessionId: result.sessionId,
      requestFingerprintHash: fingerprint, metadata: { authMethod: 'crm_details', assurance: 'biographical_match', phoneOwnershipVerified: false } });
    return result;
  }

  async function validateSessionToken(token) {
    if (!isValidOpaqueToken(token)) return { ok: false, code: 'CLIENT_SESSION_INVALID' };
    const current = now();
    const result = await db.query(
      `SELECT s.id AS session_id, s.crm_v2_client_id, s.csrf_hash, s.issued_at, s.expires_at,
              s.revoked_at, s.auth_method, s.reauthenticated_at,
              c.id, c.name, c.status
         FROM client_browser_sessions s
         JOIN crm_v2_clients c ON c.id = s.crm_v2_client_id
        WHERE s.token_hash = $1
        LIMIT 1`,
      [sha256(token)],
    );
    const row = result.rows[0];
    if (!row || row.revoked_at || row.status !== 'active' || !Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at).getTime() <= current.getTime()) {
      return { ok: false, code: 'CLIENT_SESSION_INVALID' };
    }
    await db.query(
      `UPDATE client_browser_sessions
          SET last_used_at = $2
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > $2
          AND (last_used_at IS NULL OR last_used_at < $2 - INTERVAL '15 minutes')`,
      [row.session_id, current],
    );
    return {
      ok: true,
      sessionId: row.session_id,
      crmV2ClientId: Number(row.crm_v2_client_id),
      csrfHash: row.csrf_hash,
      authenticatedAt: row.reauthenticated_at || row.issued_at,
      reauthenticatedAt: row.reauthenticated_at,
      issuedAt: row.issued_at,
      authMethod: row.auth_method || 'whatsapp_challenge',
      assurance: row.auth_method === 'crm_details' ? 'biographical_match' : 'verified',
      client: publicClient(row),
    };
  }

  async function rotateCsrfToken(sessionId) {
    const current = now();
    const csrfToken = randomOpaqueToken(randomBytes);
    const result = await db.query(
      `UPDATE client_browser_sessions
          SET csrf_hash = $2,
              last_used_at = $3
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > $3
        RETURNING id`,
      [sessionId, sha256(csrfToken), current],
    );
    if (!result.rowCount) return { ok: false, code: 'CLIENT_SESSION_INVALID' };
    return { ok: true, csrfToken };
  }

  async function revokeSession(sessionId, reason = 'logout') {
    const current = now();
    const result = await db.query(
      `UPDATE client_browser_sessions
          SET revoked_at = COALESCE(revoked_at, $2),
              revoke_reason = CASE WHEN revoked_at IS NULL THEN $3 ELSE revoke_reason END
        WHERE id = $1
        RETURNING crm_v2_client_id`,
      [sessionId, current, String(reason || 'logout').slice(0, 40)],
    );
    if (!result.rowCount) return { ok: false };
    const row = result.rows[0];
    try {
      await audit(db, 'session_revoked', {
        clientId: row.crm_v2_client_id,
        sessionId,
        metadata: { reason: String(reason || 'logout').slice(0, 40) },
      });
    } catch (_) {
      // Session revocation remains authoritative even if audit persistence is unavailable.
    }
    return { ok: true };
  }

  async function revokeOtherSessions(session) {
    const current = now();
    const { recentClientSession } = require('./clientPasskeyEnrollment');
    if (!recentClientSession(session, current)) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    // Recheck the authorizing session in the same statement as revocation.
    // Include every authentication method; removing a passkey alone misses SMS sessions.
    const result = await db.query(
      `WITH authorizing AS (
         SELECT id FROM client_browser_sessions
          WHERE id = $1 AND crm_v2_client_id = $2 AND revoked_at IS NULL
            AND auth_method IN ('sms_code','passkey','passkey_recovery','whatsapp_challenge','crm_details')
            AND (auth_method <> 'crm_details' OR reauthenticated_at > issued_at)
            AND expires_at > $3 AND COALESCE(reauthenticated_at, issued_at) <= $3
            AND COALESCE(reauthenticated_at, issued_at) >= $3 - INTERVAL '10 minutes'
          FOR UPDATE
       ), revoked AS (
         UPDATE client_browser_sessions SET revoked_at = $3, revoke_reason = 'other_sessions_logout'
          WHERE crm_v2_client_id = $2 AND id <> $1 AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM authorizing)
          RETURNING id
       ) SELECT EXISTS (SELECT 1 FROM authorizing) AS authorized,
                (SELECT COUNT(*)::int FROM revoked) AS count`,
      [session.sessionId, session.crmV2ClientId, current],
    );
    if (!result.rows[0]?.authorized) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    try {
      await audit(db, 'other_sessions_revoked', { clientId: session.crmV2ClientId,
        sessionId: session.sessionId, metadata: { count: result.rows[0].count } });
    } catch (_) {
      // Revocation remains authoritative if audit persistence is unavailable.
    }
    return { ok: true };
  }

  function validateCsrfToken(session, suppliedToken) {
    if (!session?.ok || !isValidOpaqueToken(suppliedToken)) return false;
    return safeHashEqual(sha256(suppliedToken), session.csrfHash);
  }

  return {
    issueVerifiedPasskeySession,
    issueVerifiedRecoverySession,
    issueVerifiedSmsSession,
    issueCrmDetailSession,
    validateSessionToken,
    rotateCsrfToken,
    revokeSession,
    revokeOtherSessions,
    validateCsrfToken,
  };
}

module.exports = {
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  sha256,
  safeHashEqual,
  randomOpaqueToken,
  isValidOpaqueToken,
  firstName,
  normalizedFingerprint,
  createClientBrowserSessionService,
};
