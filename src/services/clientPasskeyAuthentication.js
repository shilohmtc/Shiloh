'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { sha256, normalizedFingerprint, isValidOpaqueToken } = require('./clientBrowserSession');
const { enrollmentPolicy, CHALLENGE_TTL_MS, responseChallenge } = require('./clientPasskeyEnrollment');
const { verifyAssertionResponse, b64url, fromB64url } = require('./staffPasskeyAuth');

function credentialIdFromResponse(response) {
  try {
    const raw = fromB64url(response?.rawId || response?.id, 1024);
    if (raw.length < 16 || response.id !== b64url(raw)) return null;
    return response.id;
  } catch (_) { return null; }
}

function createClientPasskeyAuthenticationService({
  db = pool,
  env = process.env,
  sessionService,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('client passkey authentication db is required');
  const unavailable = (p) => ({ ok: false, code: p.enabled ? 'CLIENT_PASSKEY_UNAVAILABLE' : 'CLIENT_PASSKEY_DISABLED' });

  async function begin({ requestFingerprintHash = null } = {}) {
    const p = enrollmentPolicy(env);
    if (!p.operational) return unavailable(p);
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    if (!fingerprint) return { ok: false, code: 'CLIENT_PASSKEY_UNAVAILABLE' };
    const current = now();
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('client-passkey-signin:' || $1::text, 0))",
        [fingerprint],
      );
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM client_auth_passkey_login_challenges
          WHERE request_fingerprint_hash = $1 AND created_at >= $2`,
        [fingerprint, new Date(current.getTime() - 10 * 60 * 1000)],
      );
      if (Number(recent.rows[0]?.count || 0) >= 5) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_RATE_LIMITED' };
      }
      const challenge = randomBytes(32).toString('base64url');
      const browserToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(current.getTime() + CHALLENGE_TTL_MS);
      await client.query(
        `INSERT INTO client_auth_passkey_login_challenges
          (challenge_hash, browser_token_hash, request_fingerprint_hash, expires_at)
          VALUES ($1, $2, $3, $4)`,
        [sha256(challenge), sha256(browserToken), fingerprint, expiresAt],
      );
      await client.query('COMMIT');
      return {
        ok: true, browserToken, expiresAt,
        options: {
          challenge, rpId: p.rpId, timeout: CHALLENGE_TTL_MS,
          userVerification: 'required', allowCredentials: [],
        },
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  async function finish({ browserToken, response, requestFingerprintHash = null } = {}) {
    const p = enrollmentPolicy(env);
    if (!p.operational) return unavailable(p);
    if (typeof sessionService?.issueVerifiedPasskeySession !== 'function') return unavailable(p);
    const challenge = responseChallenge(response, p.origin, 'webauthn.get');
    const credentialId = credentialIdFromResponse(response);
    if (!isValidOpaqueToken(browserToken) || !challenge || !credentialId) {
      return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
    }
    const current = now();
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, expires_at FROM client_auth_passkey_login_challenges
          WHERE challenge_hash = $1 AND browser_token_hash = $2 AND consumed_at IS NULL FOR UPDATE`,
        [sha256(challenge), sha256(browserToken)],
      );
      const row = found.rows[0];
      if (!row || new Date(row.expires_at).getTime() <= current.getTime()) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      await client.query(
        'UPDATE client_auth_passkey_login_challenges SET consumed_at = $2 WHERE id = $1',
        [row.id, current],
      );
      const credentialResult = await client.query(
        `SELECT k.id, k.crm_v2_client_id, k.credential_id, k.public_key_spki, k.algorithm,
                k.sign_count, c.status
           FROM client_auth_passkey_credentials k
           JOIN crm_v2_clients c ON c.id = k.crm_v2_client_id
          WHERE k.credential_id = $1 AND k.revoked_at IS NULL FOR UPDATE OF k`,
        [credentialId],
      );
      const credential = credentialResult.rows[0];
      if (!credential || credential.status !== 'active') {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      let verified;
      try {
        verified = verifyAssertionResponse(response, credential, {
          expectedChallenge: challenge, origin: p.origin, rpId: p.rpId,
        });
      } catch (_) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      await client.query(
        `UPDATE client_auth_passkey_credentials
          SET sign_count = $2, backed_up = $3, last_used_at = $4 WHERE id = $1`,
        [credential.id, verified.signCount, verified.backedUp, current],
      );
      const session = await sessionService.issueVerifiedPasskeySession({
        transaction: client, crmV2ClientId: credential.crm_v2_client_id,
        requestFingerprintHash: fingerprint,
      });
      if (!session.ok) {
        await client.query('COMMIT');
        return { ok: false, code: 'CLIENT_PASSKEY_INVALID' };
      }
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  }

  return { begin, finish };
}

module.exports = { createClientPasskeyAuthenticationService, credentialIdFromResponse };
