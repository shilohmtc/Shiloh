'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const crm = require('./crmV2ClientService');
const { sha256, randomOpaqueToken, normalizedFingerprint } = require('./clientBrowserSession');

const TTL_MS = 10 * 60 * 1000;
const ISSUE_WINDOW_MS = 60 * 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MOBILE_DAILY_LIMIT = 6;
const CLINIC_DAILY_LIMIT = 50;
const SEND_URL = 'https://sms1.smsmessenger.co.za/app/api/rest/v1/sms/send.json';
const BALANCE_URL = 'https://sms1.smsmessenger.co.za/app/api/rest/v1/account/balance.json';

function providerFailureCategory(body) {
  // Inspect provider text only in memory. Never put its body, credentials, mobile or code in logs.
  const message = (typeof body === 'string' ? body : JSON.stringify(body || {})).slice(0, 8192).toLowerCase();
  if (/auth|token|api.key|permission|credential|email/.test(message)) return 'authentication';
  if (/credit|balance|fund/.test(message)) return 'credits';
  if (/rate|limit|throttl/.test(message)) return 'rate_limit';
  if (/number|recipient|destination|phone/.test(message)) return 'recipient';
  if (/json|format|parameter|request.body|content.type|campaign|invalid.message|missing.message/.test(message)) return 'request_format';
  return null;
}

function safeGatewayFailure(error) {
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? error.status : null;
  let category = status === 401 || status === 403 ? 'authentication'
    : status === 402 ? 'credits' : status === 429 ? 'rate_limit'
      : providerFailureCategory(error?.providerError) || (status ? 'provider_http' : 'provider_response');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') category = 'timeout';
  if (error?.name === 'TypeError') category = 'network';
  return { category, providerStatus: status,
    ...(error?.balanceCheck ? { balanceCheck: error.balanceCheck } : {}) };
}

class SmsGatewayError extends Error {
  constructor(status, providerError) {
    super('SMS gateway rejected the request');
    this.status = status;
    this.providerError = providerError;
  }
}

function createSmsMessengerGateway({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const enabled = () => Boolean(String(env.SMSMESSENGER_ACCOUNT_EMAIL || '').trim() &&
    String(env.SMSMESSENGER_API_TOKEN || '').trim());
  const headers = () => ({ email: String(env.SMSMESSENGER_ACCOUNT_EMAIL).trim(),
    token: String(env.SMSMESSENGER_API_TOKEN).trim() });
  return {
    enabled,
    async send({ mobile, code }) {
      if (!enabled()) throw new Error('SMS gateway is not configured');
      const response = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...headers(),
        },
        body: JSON.stringify({
          recipientNumber: mobile,
          message: `My Shiloh sign-in code: ${code}. Expires in 10 minutes. Do not share it.`,
          campaign: 'My Shiloh sign-in',
        }),
        signal: AbortSignal.timeout(8000),
      });
      const responseText = typeof response.text === 'function'
        ? await response.text() : JSON.stringify(await response.json());
      let body;
      try { body = JSON.parse(responseText); } catch (_) { body = {}; }
      if (!response.ok || body.error || !body.messageId) {
        const error = new SmsGatewayError(response.status, response.ok ? body.error : responseText);
        if (response.status === 400) {
          try {
            const balanceResponse = await fetchImpl(BALANCE_URL, {
              method: 'GET', headers: { Accept: 'application/json', ...headers() },
              signal: AbortSignal.timeout(4000),
            });
            if (balanceResponse.status === 401 || balanceResponse.status === 403) error.balanceCheck = 'authentication';
            else if (balanceResponse.ok) {
              const balance = await balanceResponse.json();
              const credits = Number(balance?.creditBalance);
              error.balanceCheck = Number.isFinite(credits)
                ? (credits <= 0 ? 'no_credits' : 'account_ok') : 'account_reachable';
            } else error.balanceCheck = 'unavailable';
          } catch (_) { error.balanceCheck = 'unavailable'; }
        }
        throw error;
      }
      return String(body.messageId);
    },
    async sendStaffSetup({ mobile, code }) {
      if (!enabled()) throw new Error('SMS gateway is not configured');
      const response = await fetchImpl(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers() },
        body: JSON.stringify({
          recipientNumber: mobile,
          message: `Shiloh Workspace device setup code: ${code}. Expires in 10 minutes. Do not share it.`,
          campaign: 'Shiloh Workspace device setup',
        }),
        signal: AbortSignal.timeout(8000),
      });
      const responseText = typeof response.text === 'function'
        ? await response.text() : JSON.stringify(await response.json());
      let body;
      try { body = JSON.parse(responseText); } catch (_) { body = {}; }
      if (!response.ok || body.error || !body.messageId) throw new SmsGatewayError(response.status, response.ok ? body.error : responseText);
      return String(body.messageId);
    },
  };
}

function createClientSmsAuthService({
  db = pool, crmService = crm, sessionService, env = process.env, gateway = createSmsMessengerGateway({ env }),
  now = () => new Date(), randomBytes = crypto.randomBytes, logger = console,
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
      // Serialize the clinic-wide budget before the per-mobile locks so parallel
      // requests cannot all see the last available send at once.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('my-shiloh-sms-daily-budget', 0))`,
      );
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
      const daily = await client.query(
        `SELECT COUNT(*) FILTER (WHERE normalized_mobile = $1)::int AS mobile_day_count,
                COUNT(*)::int AS clinic_day_count
           FROM client_sms_auth_challenges WHERE issued_at >= $2`,
        [normalizedMobile, new Date(current.getTime() - DAILY_WINDOW_MS)],
      );
      const dayCounts = daily.rows[0];
      if (Number(counts.mobile_count) >= 5 || (fingerprint && Number(counts.fingerprint_count) >= 12) ||
          (counts.last_issued && current.getTime() - new Date(counts.last_issued).getTime() < 60_000) ||
          Number(dayCounts.mobile_day_count) >= MOBILE_DAILY_LIMIT ||
          Number(dayCounts.clinic_day_count) >= CLINIC_DAILY_LIMIT) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'SMS_RATE_LIMITED' };
      }
      if (Number(dayCounts.clinic_day_count) === Math.floor(CLINIC_DAILY_LIMIT * 0.8) - 1) {
        logger.warn(JSON.stringify({ event: 'my_shiloh_sms_daily_budget_near_limit',
          sends: Math.floor(CLINIC_DAILY_LIMIT * 0.8), limit: CLINIC_DAILY_LIMIT }));
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

    let acceptedByGateway = false;
    try {
      const messageId = await gateway.send({ mobile: normalizedMobile, code });
      acceptedByGateway = true;
      await db.query('UPDATE client_sms_auth_challenges SET provider_message_id = $2 WHERE id = $1', [id, messageId]);
      return { ok: true, browserToken, expiresAt };
    } catch (error) {
      // Record only a bounded failure category and HTTP status, never the code,
      // mobile, request headers, provider body, or credentials.
      logger.warn(JSON.stringify({ event: 'my_shiloh_sms_send_failed',
        ...(acceptedByGateway ? { category: 'message_id_persistence', providerStatus: null }
          : safeGatewayFailure(error)) }));
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

module.exports = { createClientSmsAuthService, createSmsMessengerGateway, safeGatewayFailure, TTL_MS };
