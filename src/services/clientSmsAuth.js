'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const crm = require('./crmV2ClientService');
const { sha256, randomOpaqueToken, normalizedFingerprint } = require('./clientBrowserSession');

const TTL_MS = 10 * 60 * 1000;
const ISSUE_WINDOW_MS = 60 * 60 * 1000;
const SEND_URL = 'https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json';

function createSmsMessengerGateway({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const enabled = () => Boolean(String(env.SMSMESSENGER_ACCOUNT_EMAIL || '').trim() &&
    String(env.SMSMESSENGER_API_TOKEN || '').trim());
  return {
    enabled,
    async send({ mobile, code }) {
      if (!enabled()) throw new Error('SMS gateway is not configured');
      const response = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          email: env.SMSMESSENGER_ACCOUNT_EMAIL,
          token: env.SMSMESSENGER_API_TOKEN,
        },
        body: JSON.stringify({
          recipientNumber: mobile,
          message: `My Shiloh sign-in code: ${code}. Expires in 10 minutes. Do not share it.`,
          campaign: 'My Shiloh sign-in',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('SMS gateway rejected the send');
      const body = await response.json();
      if (body.error || !body.messageId) throw new Error('SMS gateway did not accept the send');
      return String(body.messageId);
    },
  };
}

function createClientSmsAuthService({
  db = pool, crmService = crm, sessionService, env = process.env, gateway = createSmsMessengerGateway({ env }),
  now = () => new Date(), randomBytes = crypto.randomBytes,
} = {}) {
  const enabled = () => env.MY_SHILOH_SMS_AUTH_ENABLED === 'true' && gateway.enabled() &&
    typeof sessionService?.issueVerifiedSmsSession === 'function';

  async function start({ mobile, name, requestFingerprintHash = null } = {}) {
    if (!enabled()) return { ok: false, code: 'SMS_DISABLED' };
    const normalizedMobile = crm.normalizeMobile(mobile);
    const clientName = crm.normalizeName(name);
    if (!normalizedMobile || !clientName) return { ok: false, code: 'SMS_INVALID_INPUT' };
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    const current = now();
    const browserToken = randomOpaqueToken(randomBytes);
    // Bind the short code to this browser's high-entropy token, never store it as plaintext.
    const code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    const expiresAt = new Date(current.getTime() + TTL_MS);
    const client = await db.connect();
    let id;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('my-shiloh-sms:' || $1::text, 0))`,
        [normalizedMobile],
      );
      if (fingerprint) await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('my-shiloh-sms-fingerprint:' || $1::text, 0))`,
        [fingerprint],
      );
      const recent = await client.query(
        `SELECT COUNT(*) FILTER (WHERE normalized_mobile = $1)::int AS mobile_count,
                COUNT(*) FILTER (WHERE request_fingerprint_hash = $2)::int AS fingerprint_count,
                MAX(issued_at) FILTER (WHERE normalized_mobile = $1) AS last_issued
           FROM client_sms_auth_challenges
          WHERE issued_at >= $3 AND (normalized_mobile = $1 OR request_fingerprint_hash = $2)`,
        [normalizedMobile, fingerprint, new Date(current.getTime() - ISSUE_WINDOW_MS)],
      );
      const counts = recent.rows[0];
      if (Number(counts.mobile_count) >= 5 || (fingerprint && Number(counts.fingerprint_count) >= 12) ||
          (counts.last_issued && current.getTime() - new Date(counts.last_issued).getTime() < 60_000)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_RATE_LIMITED' };
      }
      await client.query(
        `UPDATE client_sms_auth_challenges SET revoked_at = $2
          WHERE normalized_mobile = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [normalizedMobile, current],
      );
      const inserted = await client.query(
        `INSERT INTO client_sms_auth_challenges
           (browser_token_hash, normalized_mobile, client_name, code_hash,
            request_fingerprint_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [sha256(browserToken), normalizedMobile, clientName, sha256(`${browserToken}:${code}`), fingerprint, current, expiresAt],
      );
      id = inserted.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }

    try {
      const messageId = await gateway.send({ mobile: normalizedMobile, code });
      await db.query('UPDATE client_sms_auth_challenges SET provider_message_id = $2 WHERE id = $1', [id, messageId]);
      return { ok: true, browserToken, expiresAt };
    } catch (_) {
      await db.query('UPDATE client_sms_auth_challenges SET revoked_at = $2 WHERE id = $1', [id, now()]);
      return { ok: false, code: 'SMS_UNAVAILABLE' };
    }
  }

  async function finish({ browserToken, code, requestFingerprintHash = null } = {}) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(browserToken || '')) || !/^\d{6}$/.test(String(code || ''))) {
      return { ok: false, code: 'SMS_INVALID_CODE' };
    }
    const client = await db.connect();
    const current = now();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT * FROM client_sms_auth_challenges WHERE browser_token_hash = $1 FOR UPDATE`,
        [sha256(browserToken)],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.revoked_at || challenge.consumed_at ||
          !challenge.provider_message_id || new Date(challenge.expires_at) <= current) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_INVALID_CODE' };
      }
      const expected = Buffer.from(challenge.code_hash, 'hex');
      const supplied = Buffer.from(sha256(`${browserToken}:${code}`), 'hex');
      if (!crypto.timingSafeEqual(expected, supplied)) {
        const attempts = Number(challenge.verify_attempts) + 1;
        await client.query(
          `UPDATE client_sms_auth_challenges
              SET verify_attempts = $2, revoked_at = CASE WHEN $2 >= 5 THEN $3 ELSE revoked_at END
            WHERE id = $1`, [challenge.id, attempts, current],
        );
        await client.query('COMMIT');
        return { ok: false, code: 'SMS_INVALID_CODE' };
      }
      let ownership = await crmService.resolveExactMobile(challenge.normalized_mobile);
      if (ownership.status === 'not_found') {
        ownership = await crmService.createClient({ name: challenge.client_name, mobile: challenge.normalized_mobile,
          actorReference: 'my_shiloh_sms' });
      }
      if (!['found', 'existing', 'created'].includes(ownership.status) || !ownership.client?.id) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_PROFILE_UNAVAILABLE' };
      }
      const verified = await crmService.recordVerifiedSmsInteraction({ mobile: challenge.normalized_mobile, occurredAt: current });
      if (verified.status !== 'verified' || verified.client?.id !== ownership.client.id) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_PROFILE_UNAVAILABLE' };
      }
      const session = await sessionService.issueVerifiedSmsSession({
        transaction: client, crmV2ClientId: verified.client.id,
        normalizedMobile: challenge.normalized_mobile, requestFingerprintHash,
      });
      if (!session.ok) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_PROFILE_UNAVAILABLE' };
      }
      await client.query('UPDATE client_sms_auth_challenges SET consumed_at = $2 WHERE id = $1', [challenge.id, current]);
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  return { enabled, start, finish };
}

module.exports = { createClientSmsAuthService, createSmsMessengerGateway, TTL_MS };
