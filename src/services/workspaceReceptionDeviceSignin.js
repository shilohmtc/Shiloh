'use strict';

const { pool } = require('../db/pool');
const { sha256, isRecentAuthentication } = require('./staffBrowserSession');
const { createStaffWhatsAppPasskeyBootstrapService } = require('./staffWhatsAppPasskeyBootstrap');
const { isExactReceptionPrincipal } = require('./workspaceReceptionAccess');

const CONTROL_REFERENCE = '#842-reception-device-signin';

function positiveId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resultError(code) {
  const messages = {
    STAFF_RECENT_AUTH_REQUIRED: 'Sign in again before creating a Reception device sign-in link.',
    STAFF_RESET_FORBIDDEN: 'Your authenticated Shiloh access does not permit credential re-enrollment.',
    RECEPTION_DEVICE_SIGNIN_NOT_FOUND: 'Shiloh Reception is not available for device sign-in setup.',
    RECEPTION_DEVICE_SIGNIN_BOOTSTRAP_UNAVAILABLE: 'Reception device sign-in setup is temporarily unavailable.',
    RECEPTION_DEVICE_SIGNIN_RATE_LIMITED: 'A Reception setup link was issued recently. Wait a few minutes and try again.',
  };
  return { ok: false, code, error: messages[code] || 'Reception device sign-in setup failed closed.' };
}

function createWorkspaceReceptionDeviceSigninService({
  db = pool,
  env = process.env,
  now = () => new Date(),
  bootstrapService = createStaffWhatsAppPasskeyBootstrapService({ db, env, now }),
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Reception device sign-in database is required');

  async function loadReception(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `SELECT a.id, a.staff_id, a.display_name, a.normalized_whatsapp, a.role, a.business_role,
              a.calendar_scope, a.service_scope, a.permissions, a.active,
              s.status AS staff_status
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id = a.staff_id
        WHERE a.id = $1
        LIMIT 1`,
      [id]
    );
    const row = result.rows[0] || null;
    if (!row || row.active !== true || row.staff_id != null || !isExactReceptionPrincipal(row)) return null;
    return row;
  }

  async function hasResetAuthority(adminId) {
    const id = positiveId(adminId);
    if (!id) return false;
    const result = await db.query(
      `SELECT a.id
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id = a.staff_id
        WHERE a.id = $1
          AND a.active = TRUE
          AND (a.staff_id IS NULL OR s.status = 'active')
          AND COALESCE(a.permissions, '{}'::jsonb) @> '{"staff_auth:reset":true}'::jsonb
        LIMIT 2`,
      [id]
    );
    return result.rows.length === 1;
  }

  async function auditIssued({ operatorAdminId, subjectAdminId, requestFingerprintHash = null }) {
    await db.query(
      `INSERT INTO staff_auth_security_events
         (event_type, operator_admin_id, subject_admin_id, auth_method, reason, request_fingerprint_hash, metadata)
       VALUES ('passkey_admin_bootstrap_issued', $1, $2, 'control', $3, $4, $5::jsonb)`,
      [
        positiveId(operatorAdminId),
        positiveId(subjectAdminId),
        CONTROL_REFERENCE,
        requestFingerprintHash,
        JSON.stringify({ controlReference: CONTROL_REFERENCE, target: 'shiloh_reception', additiveCredentialEnrollment: true }),
      ]
    );
  }

  async function revokeIssuedToken({ targetAdminId, token }) {
    if (!token || !positiveId(targetAdminId)) return;
    await db.query(
      `UPDATE staff_auth_passkey_bootstraps
          SET revoked_at = COALESCE(revoked_at, $3)
        WHERE admin_id = $1
          AND token_hash = $2
          AND consumed_at IS NULL
          AND revoked_at IS NULL`,
      [positiveId(targetAdminId), sha256(token), now()]
    );
  }

  async function issue({ session, targetAdminId, requestFingerprintHash = null } = {}) {
    const operatorId = positiveId(session?.adminId);
    const targetId = positiveId(targetAdminId);
    if (!operatorId || !targetId || operatorId === targetId) return resultError('STAFF_RESET_FORBIDDEN');
    if (!isRecentAuthentication(session, now()) || session?.recoveryRequired === true) {
      return resultError('STAFF_RECENT_AUTH_REQUIRED');
    }

    if (!(await hasResetAuthority(operatorId))) {
      return resultError('STAFF_RESET_FORBIDDEN');
    }

    const reception = await loadReception(targetId);
    if (!reception?.normalized_whatsapp) return resultError('RECEPTION_DEVICE_SIGNIN_NOT_FOUND');

    const issued = await bootstrapService.issueBootstrap({ whatsapp: reception.normalized_whatsapp });
    if (!issued?.ok || issued.handled !== true || issued.eligible !== true) {
      return resultError('RECEPTION_DEVICE_SIGNIN_BOOTSTRAP_UNAVAILABLE');
    }
    if (issued.rateLimited === true || !issued.url || !issued.token) {
      return resultError('RECEPTION_DEVICE_SIGNIN_RATE_LIMITED');
    }

    try {
      await auditIssued({ operatorAdminId: operatorId, subjectAdminId: targetId, requestFingerprintHash });
    } catch (error) {
      // Do not hand out an unaudited admin-issued setup token. Revoke only the token created by this request.
      try { await revokeIssuedToken({ targetAdminId: targetId, token: issued.token }); } catch (_) {}
      throw error;
    }

    return {
      ok: true,
      setupUrl: issued.url,
      expiresAt: issued.expiresAt,
      subjectAdminId: targetId,
      displayName: reception.display_name || 'Shiloh Reception',
    };
  }

  return { issue, loadReception, hasResetAuthority, revokeIssuedToken };
}

module.exports = {
  CONTROL_REFERENCE,
  positiveId,
  resultError,
  createWorkspaceReceptionDeviceSigninService,
};
