'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const crmV2ClientService = require('./crmV2ClientService');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_ISSUE_WINDOW_MS = 10 * 60 * 1000;
const CHALLENGE_ISSUE_LIMIT = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_COMPLETION_ATTEMPTS = 5;
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

function randomCompletionCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(4);
  const value = bytes.readUInt32BE(0) % 1000000;
  return String(value).padStart(6, '0');
}

function isValidOpaqueToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

function isValidCompletionCode(value) {
  return /^\d{6}$/.test(String(value || '').replace(/\s+/g, ''));
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
  crmService = crmV2ClientService,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
  challengeTtlMs = CHALLENGE_TTL_MS,
  sessionTtlMs = SESSION_TTL_MS,
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

  async function beginChallenge({ requestFingerprintHash = null } = {}) {
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const current = now();
    const browserToken = randomOpaqueToken(randomBytes);
    const whatsappToken = randomOpaqueToken(randomBytes);
    const expiresAt = new Date(current.getTime() + challengeTtlMs);
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      if (fingerprint) {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended('my-shiloh-client-auth:' || $1::text, 0))`,
          [fingerprint],
        );
        const since = new Date(current.getTime() - CHALLENGE_ISSUE_WINDOW_MS);
        const count = await client.query(
          `SELECT COUNT(*)::int AS count
             FROM client_browser_auth_challenges
            WHERE request_fingerprint_hash = $1
              AND issued_at >= $2`,
          [fingerprint, since],
        );
        if (Number(count.rows[0]?.count || 0) >= CHALLENGE_ISSUE_LIMIT) {
          await audit(client, 'challenge_rate_limited', { requestFingerprintHash: fingerprint });
          await client.query('COMMIT');
          return { ok: false, code: 'CLIENT_AUTH_RATE_LIMITED' };
        }
        await client.query(
          `UPDATE client_browser_auth_challenges
              SET revoked_at = $2
            WHERE request_fingerprint_hash = $1
              AND consumed_at IS NULL
              AND revoked_at IS NULL`,
          [fingerprint, current],
        );
      }
      const inserted = await client.query(
        `INSERT INTO client_browser_auth_challenges
           (browser_token_hash, whatsapp_token_hash, request_fingerprint_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [sha256(browserToken), sha256(whatsappToken), fingerprint, current, expiresAt],
      );
      const challengeId = inserted.rows[0].id;
      await audit(client, 'challenge_issued', {
        challengeId,
        requestFingerprintHash: fingerprint,
      });
      await client.query('COMMIT');
      return { ok: true, challengeId, browserToken, whatsappToken, expiresAt };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function verifyWhatsAppChallenge({
    whatsappToken,
    senderMobile,
    requestFingerprintHash = null,
  } = {}) {
    if (!isValidOpaqueToken(whatsappToken)) return { ok: false, code: 'CLIENT_AUTH_INVALID_CHALLENGE' };
    // Challenge age is authoritative only from Shiloh's server clock. Provider
    // message timestamps are transport evidence, never authentication time authority.
    const current = now();

    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const challengeResult = await client.query(
        `SELECT id, expires_at, verified_at, consumed_at, revoked_at, verify_attempts
           FROM client_browser_auth_challenges
          WHERE whatsapp_token_hash = $1
          LIMIT 1
          FOR UPDATE`,
        [sha256(whatsappToken)],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.consumed_at || challenge.revoked_at || challenge.verified_at) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_AUTH_INVALID_CHALLENGE' };
      }
      if (new Date(challenge.expires_at).getTime() <= current.getTime()) {
        await client.query(
          `UPDATE client_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`,
          [challenge.id, current],
        );
        await audit(client, 'challenge_expired', {
          challengeId: challenge.id,
          requestFingerprintHash,
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_EXPIRED' };
      }
      const attempts = Number(challenge.verify_attempts || 0) + 1;
      if (attempts > MAX_VERIFY_ATTEMPTS) {
        await client.query(
          `UPDATE client_browser_auth_challenges SET revoked_at = $2, verify_attempts = $3 WHERE id = $1`,
          [challenge.id, current, MAX_VERIFY_ATTEMPTS],
        );
        await audit(client, 'challenge_attempt_limit', {
          challengeId: challenge.id,
          requestFingerprintHash,
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_INVALID_CHALLENGE' };
      }
      await client.query(
        `UPDATE client_browser_auth_challenges SET verify_attempts = $2 WHERE id = $1`,
        [challenge.id, attempts],
      );

      const ownership = await crmService.recordVerifiedWhatsAppInteraction({
        mobile: senderMobile,
        occurredAt: current,
      });
      if (ownership.status !== 'verified' || !ownership.client?.id) {
        await client.query(
          `UPDATE client_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`,
          [challenge.id, current],
        );
        await audit(client, 'challenge_client_unavailable', {
          challengeId: challenge.id,
          requestFingerprintHash,
          metadata: { resolution: ownership.status || 'unknown' },
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
      }

      const crmV2ClientId = Number(ownership.client.id);
      const completionCode = randomCompletionCode(randomBytes);
      await client.query(
        `UPDATE client_browser_auth_challenges
            SET crm_v2_client_id = $2,
                verified_at = $3,
                completion_code_hash = $4,
                completion_attempts = 0
          WHERE id = $1`,
        [challenge.id, crmV2ClientId, current, sha256(completionCode)],
      );
      await audit(client, 'challenge_verified_whatsapp', {
        clientId: crmV2ClientId,
        challengeId: challenge.id,
        requestFingerprintHash,
      });
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'verified',
        completionCode,
        client: {
          id: String(ownership.client.id),
          name: ownership.client.name,
          firstName: firstName(ownership.client.name),
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function completeChallenge({
    browserToken,
    completionCode,
    requestFingerprintHash = null,
  } = {}) {
    if (!isValidOpaqueToken(browserToken) || !isValidCompletionCode(completionCode)) {
      return { ok: false, code: 'CLIENT_AUTH_INVALID_COMPLETION' };
    }
    const cleanCode = String(completionCode).replace(/\s+/g, '');
    const current = now();
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const challengeResult = await client.query(
        `SELECT id, crm_v2_client_id, request_fingerprint_hash, expires_at, verified_at,
                completion_code_hash, completion_attempts, consumed_at, revoked_at
           FROM client_browser_auth_challenges
          WHERE browser_token_hash = $1
          LIMIT 1
          FOR UPDATE`,
        [sha256(browserToken)],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.consumed_at || challenge.revoked_at) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_AUTH_INVALID_CHALLENGE' };
      }
      if (new Date(challenge.expires_at).getTime() <= current.getTime()) {
        await client.query(
          `UPDATE client_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`,
          [challenge.id, current],
        );
        await audit(client, 'challenge_expired', {
          challengeId: challenge.id,
          requestFingerprintHash: fingerprint,
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_EXPIRED' };
      }
      if (!challenge.verified_at || !challenge.crm_v2_client_id || !challenge.completion_code_hash) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_NOT_VERIFIED' };
      }

      const nextAttempts = Number(challenge.completion_attempts || 0) + 1;
      if (!safeHashEqual(sha256(cleanCode), challenge.completion_code_hash)) {
        const revoke = nextAttempts >= MAX_COMPLETION_ATTEMPTS;
        await client.query(
          `UPDATE client_browser_auth_challenges
              SET completion_attempts = $2,
                  revoked_at = CASE WHEN $3::boolean THEN $4 ELSE revoked_at END
            WHERE id = $1`,
          [challenge.id, Math.min(nextAttempts, MAX_COMPLETION_ATTEMPTS), revoke, current],
        );
        await audit(client, revoke ? 'completion_attempt_limit' : 'completion_code_rejected', {
          challengeId: challenge.id,
          clientId: challenge.crm_v2_client_id,
          requestFingerprintHash: fingerprint,
          metadata: { attempt: Math.min(nextAttempts, MAX_COMPLETION_ATTEMPTS) },
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_INVALID_COMPLETION' };
      }

      const owner = await client.query(
        `SELECT id, name
           FROM crm_v2_clients
          WHERE id = $1
            AND status = 'active'
          LIMIT 1
          FOR SHARE`,
        [challenge.crm_v2_client_id],
      );
      if (owner.rowCount !== 1) {
        await client.query(
          `UPDATE client_browser_auth_challenges SET revoked_at = $2 WHERE id = $1`,
          [challenge.id, current],
        );
        await audit(client, 'challenge_client_unavailable', {
          challengeId: challenge.id,
          clientId: challenge.crm_v2_client_id,
          requestFingerprintHash: fingerprint,
        });
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_AUTH_PROFILE_UNAVAILABLE' };
      }

      const sessionToken = randomOpaqueToken(randomBytes);
      const csrfToken = randomOpaqueToken(randomBytes);
      const expiresAt = new Date(current.getTime() + sessionTtlMs);
      const inserted = await client.query(
        `INSERT INTO client_browser_sessions
           (crm_v2_client_id, token_hash, csrf_hash, issued_at, expires_at, reauthenticated_at,
            auth_method, client_fingerprint_hash)
         VALUES ($1, $2, $3, $4, $5, $4, 'whatsapp_challenge', $6)
         RETURNING id`,
        [
          owner.rows[0].id,
          sha256(sessionToken),
          sha256(csrfToken),
          current,
          expiresAt,
          fingerprint,
        ],
      );
      const sessionId = inserted.rows[0].id;
      await client.query(
        `UPDATE client_browser_auth_challenges
            SET consumed_at = $2,
                completion_attempts = $3
          WHERE id = $1`,
        [challenge.id, current, Math.min(nextAttempts, MAX_COMPLETION_ATTEMPTS)],
      );
      await audit(client, 'session_issued', {
        clientId: owner.rows[0].id,
        challengeId: challenge.id,
        sessionId,
        requestFingerprintHash: fingerprint,
        metadata: { authMethod: 'whatsapp_challenge' },
      });
      await client.query('COMMIT');
      return {
        ok: true,
        status: 'authenticated',
        sessionToken,
        csrfToken,
        sessionId,
        expiresAt,
        client: publicClient(owner.rows[0]),
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
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
    if (!row || row.revoked_at || row.status !== 'active' || new Date(row.expires_at).getTime() <= current.getTime()) {
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
      authMethod: row.auth_method || 'whatsapp_challenge',
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

  function validateCsrfToken(session, suppliedToken) {
    if (!session?.ok || !isValidOpaqueToken(suppliedToken)) return false;
    return safeHashEqual(sha256(suppliedToken), session.csrfHash);
  }

  return {
    beginChallenge,
    verifyWhatsAppChallenge,
    completeChallenge,
    validateSessionToken,
    rotateCsrfToken,
    revokeSession,
    validateCsrfToken,
  };
}

module.exports = {
  CHALLENGE_TTL_MS,
  SESSION_TTL_MS,
  CHALLENGE_ISSUE_WINDOW_MS,
  CHALLENGE_ISSUE_LIMIT,
  MAX_VERIFY_ATTEMPTS,
  MAX_COMPLETION_ATTEMPTS,
  sha256,
  safeHashEqual,
  randomOpaqueToken,
  randomCompletionCode,
  isValidOpaqueToken,
  isValidCompletionCode,
  firstName,
  normalizedFingerprint,
  createClientBrowserSessionService,
};
