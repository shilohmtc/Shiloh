'use strict';

const crypto = require('crypto');
const { pool } = require('../db/pool');
const { sha256, normalizeWhatsapp, deriveCalendarViewer } = require('./staffBrowserSession');
const { strongRecentSession } = require('./staffPasskeyAuth');
const { createSmsMessengerGateway, safeGatewayFailure } = require('./clientSmsAuth');
const { createStaffWhatsAppPasskeyBootstrapService } = require('./staffWhatsAppPasskeyBootstrap');

const TTL_MS = 10 * 60 * 1000;
const LIMIT = 3;
const invalid = { ok: false, code: 'STAFF_SMS_SETUP_INVALID' };
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function createStaffSmsDeviceSetupService({
  db = pool, env = process.env, now = () => new Date(), randomBytes = crypto.randomBytes,
  gateway = createSmsMessengerGateway({ env }),
  bootstrapService = createStaffWhatsAppPasskeyBootstrapService({ db, env, now }),
  logger = console,
} = {}) {
  const enabled = () => env.MY_SHILOH_SMS_AUTH_ENABLED === 'true' && gateway.enabled() && bootstrapService.policy().operational;

  async function audit(client, event, operator, subject, detail, fingerprint) {
    await client.query(`INSERT INTO staff_auth_security_events
      (event_type, operator_admin_id, subject_admin_id, auth_method, request_fingerprint_hash, metadata)
      VALUES ($1,$2,$3,'control',$4,$5::jsonb)`,
    [event, operator, subject, fingerprint, JSON.stringify(detail)]);
  }

  async function eligibleAdmin(client, id, lock = false) {
    const result = await client.query(`SELECT a.id, a.staff_id, a.normalized_whatsapp, a.active AS admin_active,
      a.role, a.business_role, a.calendar_scope, a.service_scope, a.permissions,
      s.status AS staff_status
      FROM staff_admin_accounts a LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.id = $1 LIMIT 1${lock ? ' FOR UPDATE OF a' : ''}`, [id]);
    const row = result.rows[0];
    return row && row.admin_active === true && (row.staff_id == null || row.staff_status === 'active')
      && deriveCalendarViewer(row) ? row : null;
  }

  async function issue({ session, targetAdminId, mode, identityConfirmed, requestFingerprintHash = null } = {}) {
    if (!enabled()) return { ok: false, code: 'STAFF_SMS_SETUP_UNAVAILABLE' };
    const operatorId = validId(session?.adminId);
    const targetId = validId(targetAdminId);
    if (!operatorId || !targetId || operatorId === targetId || !['add', 'replace'].includes(mode) || identityConfirmed !== true)
      return { ok: false, code: 'STAFF_SMS_SETUP_FORBIDDEN' };
    const current = now();
    if (!strongRecentSession(session, current)) return { ok: false, code: 'STAFF_RECENT_STRONG_AUTH_REQUIRED' };
    const client = await db.connect();
    let request, code, mobile, requestId;
    try {
      await client.query('BEGIN');
      const operator = await eligibleAdmin(client, operatorId, true);
      if (!operator || operator.permissions?.['staff_auth:reset'] !== true) {
        await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_SMS_SETUP_FORBIDDEN' };
      }
      const subject = await eligibleAdmin(client, targetId, true);
      mobile = normalizeWhatsapp(subject?.normalized_whatsapp);
      if (!subject || !mobile) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_SMS_SETUP_FORBIDDEN' }; }
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('staff-sms-setup:' || $1::text, 0))`, [targetId]);
      const recent = await client.query(`SELECT COUNT(*)::int AS count FROM staff_auth_sms_device_setups
        WHERE admin_id = $1 AND issued_at > $2`, [targetId, new Date(current.getTime() - 60 * 60 * 1000)]);
      if (Number(recent.rows[0]?.count) >= LIMIT) { await client.query('ROLLBACK'); return { ok: false, code: 'STAFF_SMS_SETUP_RATE_LIMITED' }; }
      await client.query(`UPDATE staff_auth_sms_device_setups SET revoked_at = $2
        WHERE admin_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [targetId, current]);
      request = randomBytes(32).toString('base64url');
      code = String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, '0');
      const inserted = await client.query(`INSERT INTO staff_auth_sms_device_setups
        (admin_id, operator_admin_id, request_hash, code_hash, mobile_hash, mode, issued_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [targetId, operatorId, sha256(request), sha256(`${request}:${code}`), sha256(mobile), mode, current, new Date(current.getTime() + TTL_MS)]);
      requestId = inserted.rows[0].id;
      await audit(client, 'staff_sms_setup_approved', operatorId, targetId, { mode }, requestFingerprintHash);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }

    try {
      const messageId = await gateway.sendStaffSetup({ mobile: `+${mobile}`, code });
      await db.query(`UPDATE staff_auth_sms_device_setups SET provider_message_id = $2
        WHERE id = $1 AND revoked_at IS NULL`, [requestId, messageId]);
      return { ok: true, url: `${bootstrapService.policy().origin}/calendar/staff-auth/passkeys/sms-setup#request=${request}`,
        expiresAt: new Date(current.getTime() + TTL_MS) };
    } catch (error) {
      logger.warn(JSON.stringify({ event: 'staff_sms_setup_send_failed', ...safeGatewayFailure(error) }));
      await db.query(`UPDATE staff_auth_sms_device_setups SET revoked_at = $2 WHERE id = $1`, [requestId, now()]);
      return { ok: false, code: 'STAFF_SMS_SETUP_UNAVAILABLE' };
    }
  }

  async function verify({ request, code, requestFingerprintHash = null } = {}) {
    if (!enabled()) return { ok: false, code: 'STAFF_SMS_SETUP_UNAVAILABLE' };
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(request || '')) || !/^\d{6}$/.test(String(code || ''))) return invalid;
    const current = now();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const preliminary = await client.query(`SELECT admin_id, operator_admin_id FROM staff_auth_sms_device_setups
        WHERE request_hash = $1`, [sha256(request)]);
      if (!preliminary.rows[0]) { await client.query('ROLLBACK'); return invalid; }
      // Match the issue path's lock order before taking the request row lock.
      const operator = await eligibleAdmin(client, preliminary.rows[0].operator_admin_id, true);
      const subject = await eligibleAdmin(client, preliminary.rows[0].admin_id, true);
      const found = await client.query(`SELECT * FROM staff_auth_sms_device_setups
        WHERE request_hash = $1 FOR UPDATE`, [sha256(request)]);
      const row = found.rows[0];
      if (!row || row.consumed_at || row.revoked_at || !row.provider_message_id || new Date(row.expires_at) <= current) {
        await client.query('ROLLBACK'); return invalid;
      }
      const expected = Buffer.from(row.code_hash, 'hex');
      const supplied = Buffer.from(sha256(`${request}:${code}`), 'hex');
      if (!crypto.timingSafeEqual(expected, supplied)) {
        await client.query(`UPDATE staff_auth_sms_device_setups SET verify_attempts = verify_attempts + 1,
          revoked_at = CASE WHEN verify_attempts + 1 >= 5 THEN $2 ELSE revoked_at END WHERE id = $1`, [row.id, current]);
        await client.query('COMMIT'); return invalid;
      }
      if (!operator || operator.permissions?.['staff_auth:reset'] !== true || !subject ||
          sha256(normalizeWhatsapp(subject.normalized_whatsapp) || '') !== row.mobile_hash) {
        await client.query('ROLLBACK'); return invalid;
      }
      const issued = await bootstrapService.issueApprovedBootstrap(client, row.admin_id, row.mode, { current, requestFingerprintHash });
      if (!issued.ok || issued.rateLimited || !issued.url) { await client.query('ROLLBACK'); return invalid; }
      await client.query(`UPDATE staff_auth_sms_device_setups SET consumed_at = $2 WHERE id = $1`, [row.id, current]);
      await audit(client, 'staff_sms_setup_verified', row.operator_admin_id, row.admin_id, { mode: row.mode }, requestFingerprintHash);
      await client.query('COMMIT');
      return { ok: true, url: issued.url };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }

  return { enabled, issue, verify };
}

module.exports = { createStaffSmsDeviceSetupService, TTL_MS };
