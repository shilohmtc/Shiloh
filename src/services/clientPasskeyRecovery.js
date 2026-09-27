'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { sha256, normalizedFingerprint } = require('./clientBrowserSession');
const { enrollmentPolicy, recentClientSession } = require('./clientPasskeyEnrollment');

// 160 random bits, shown once as eight short groups for copying by hand.
const CODE_FORMAT = /^[A-F0-9]{5}(?:-[A-F0-9]{5}){7}$/;
const ATTEMPT_LIMIT = 5;

function formatCode(bytes) {
  return bytes.toString('hex').toUpperCase().match(/.{5}/g).join('-');
}

function createClientPasskeyRecoveryService({ db = pool, env = process.env,
  sessionService, now = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('client passkey recovery db is required');
  const unavailable = () => ({ ok: false, code: 'CLIENT_RECOVERY_UNAVAILABLE' });
  const withClient = async (fn) => {
    const client = typeof db.connect === 'function' ? await db.connect() : db;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      if (client !== db && typeof client.release === 'function') client.release();
    }
  };

  async function create({ session, requestFingerprintHash = null } = {}) {
    if (!enrollmentPolicy(env).operational) return unavailable();
    const current = now();
    if (!recentClientSession(session, current)) return { ok: false, code: 'CLIENT_RECENT_AUTH_REQUIRED' };
    return withClient(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('client-recovery-create:' || $1::text, 0))", [session.crmV2ClientId]);
      const active = await client.query(
        `SELECT id FROM client_auth_passkey_credentials
          WHERE crm_v2_client_id = $1 AND revoked_at IS NULL LIMIT 1`, [session.crmV2ClientId],
      );
      if (!active.rowCount) return { ok: false, code: 'CLIENT_PASSKEY_REQUIRED' };
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM client_auth_security_events
          WHERE crm_v2_client_id = $1 AND event_type = 'recovery_code_created' AND created_at >= $2`,
        [session.crmV2ClientId, new Date(current.getTime() - 60 * 60 * 1000)],
      );
      if (Number(recent.rows[0]?.count || 0) >= 3) return { ok: false, code: 'CLIENT_RECOVERY_RATE_LIMITED' };
      const code = formatCode(randomBytes(20));
      await client.query(
        `UPDATE client_auth_passkey_recovery_codes SET revoked_at = $2
          WHERE crm_v2_client_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [session.crmV2ClientId, current],
      );
      await client.query(
        `INSERT INTO client_auth_passkey_recovery_codes (crm_v2_client_id, code_hash) VALUES ($1, $2)`,
        [session.crmV2ClientId, sha256(code.replace(/-/g, ''))],
      );
      await client.query(
        `INSERT INTO client_auth_security_events
          (event_type, crm_v2_client_id, session_id, request_fingerprint_hash)
          VALUES ('recovery_code_created', $1, $2, $3)`,
        [session.crmV2ClientId, session.sessionId, normalizedFingerprint(requestFingerprintHash)],
      );
      return { ok: true, code };
    });
  }

  async function redeem({ code, requestFingerprintHash = null } = {}) {
    if (!enrollmentPolicy(env).operational || typeof sessionService?.issueVerifiedRecoverySession !== 'function') return unavailable();
    const fingerprint = normalizedFingerprint(requestFingerprintHash);
    if (!fingerprint) return unavailable();
    const current = now();
    return withClient(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('client-recovery-attempt:' || $1::text, 0))", [fingerprint]);
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM client_auth_passkey_recovery_attempts
          WHERE request_fingerprint_hash = $1 AND created_at >= $2`,
        [fingerprint, new Date(current.getTime() - 10 * 60 * 1000)],
      );
      if (Number(recent.rows[0]?.count || 0) >= ATTEMPT_LIMIT) return { ok: false, code: 'CLIENT_RECOVERY_RATE_LIMITED' };
      // Record all attempts, including malformed codes, before looking up an account.
      await client.query(
        `INSERT INTO client_auth_passkey_recovery_attempts (request_fingerprint_hash) VALUES ($1)`, [fingerprint],
      );
      const normalized = String(code || '').trim().toUpperCase();
      if (!CODE_FORMAT.test(normalized)) return { ok: false, code: 'CLIENT_RECOVERY_INVALID' };
      const found = await client.query(
        `SELECT id, crm_v2_client_id FROM client_auth_passkey_recovery_codes
          WHERE code_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
        [sha256(normalized.replace(/-/g, ''))],
      );
      if (!found.rowCount) return { ok: false, code: 'CLIENT_RECOVERY_INVALID' };
      const row = found.rows[0];
      const issued = await sessionService.issueVerifiedRecoverySession({
        transaction: client, crmV2ClientId: row.crm_v2_client_id, requestFingerprintHash: fingerprint,
      });
      if (!issued.ok) return { ok: false, code: 'CLIENT_RECOVERY_INVALID' };
      await client.query('UPDATE client_auth_passkey_recovery_codes SET consumed_at = $2 WHERE id = $1', [row.id, current]);
      await client.query(
        `INSERT INTO client_auth_security_events
          (event_type, crm_v2_client_id, session_id, request_fingerprint_hash)
          VALUES ('recovery_code_used', $1, $2, $3)`,
        [row.crm_v2_client_id, issued.sessionId, fingerprint],
      );
      return issued;
    });
  }

  return { create, redeem };
}

module.exports = { CODE_FORMAT, ATTEMPT_LIMIT, formatCode, createClientPasskeyRecoveryService };
