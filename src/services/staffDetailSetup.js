'use strict';
const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { details } = require('./clientCrmDetailAuth');
const { staffDetailRevision } = require('./staffDetailIdentity');
// Canonical personal accounts are fixed by migration 184. Reception is the
// existing unique, unlinked operational principal, not a generic role grant.
function canManageStaffDetails(operator) {
  if (
    !operator?.active ||
    (operator.staff_id != null && operator.staff_status !== 'active') ||
    operator.permissions?.['staff_access:manage'] !== true ||
    operator.calendar_scope !== 'all_business' ||
    operator.service_scope !== 'all_services'
  )
    return false;
  const name = String(operator.display_name || '')
    .trim()
    .toLowerCase();
  return (
    (Number(operator.id) === 2 &&
      name === 'christel' &&
      operator.role === 'owner' &&
      operator.business_role === 'owner') ||
    (Number(operator.id) === 4 &&
      name === 'jean-pierre' &&
      operator.role === 'admin' &&
      operator.business_role === 'business_admin') ||
    (name === 'shiloh reception' &&
      operator.staff_id == null &&
      operator.role === 'receptionist' &&
      operator.business_role === 'booking_operator' &&
      Number(operator.reception_count) === 1)
  );
}
function revision(row) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([row.id, row.active, staffDetailRevision(row), row.normalized_whatsapp]))
    .digest('hex');
}
function createStaffDetailSetupService({ db = pool, now = () => new Date() } = {}) {
  const denied = { ok: false, code: 'STAFF_DETAIL_SETUP_FORBIDDEN' };
  async function currentSession(queryable, session, lock = false) {
    if (!session?.ok || session.recoveryRequired) return null;
    return (
      (
        await queryable.query(
          `SELECT auth_method, detail_identity_revision FROM staff_browser_sessions
       WHERE id=$1 AND admin_id=$2 AND recovery_required=FALSE
       AND revoked_at IS NULL AND expires_at>$3${lock ? ' FOR UPDATE' : ''}`,
          [session.sessionId, session.adminId, now()],
        )
      ).rows[0] || null
    );
  }
  async function authorize(queryable, session, targetId, lock = false) {
    if (
      !session?.ok ||
      session.recoveryRequired ||
      !Number.isSafeInteger(Number(targetId)) ||
      Number(targetId) <= 0
    )
      return null;
    const persistedSession = await currentSession(queryable, session, lock);
    if (!persistedSession) return null;
    const operator = (
      await queryable.query(
        `SELECT a.*, s.status AS staff_status,
        (SELECT COUNT(*) FROM staff_admin_accounts WHERE LOWER(BTRIM(display_name))='shiloh reception') AS reception_count
        FROM staff_admin_accounts a
      LEFT JOIN staff s ON s.id=a.staff_id WHERE a.id=$1${lock ? ' FOR UPDATE OF a' : ''}`,
        [session.adminId],
      )
    ).rows[0];
    if (!canManageStaffDetails(operator)) return null;
    if (
      persistedSession.auth_method === 'staff_details' &&
      persistedSession.detail_identity_revision !== staffDetailRevision(operator)
    )
      return null;
    return (
      (
        await queryable.query(
          `SELECT a.*, s.status AS staff_status FROM staff_admin_accounts a
      LEFT JOIN staff s ON s.id=a.staff_id WHERE a.id=$1${lock ? ' FOR UPDATE OF a' : ''}`,
          [targetId],
        )
      ).rows[0] || null
    );
  }
  async function read({ session, targetId = session?.adminId } = {}) {
    const row = await authorize(db, session, targetId);
    if (!row) return denied;
    return {
      ok: true,
      targetId: Number(row.id),
      displayName: row.display_name,
      revision: revision(row),
      firstName: row.sign_in_first_name || '',
      surname: row.sign_in_surname || '',
      dateOfBirth:
        row.sign_in_date_of_birth instanceof Date
          ? row.sign_in_date_of_birth.toISOString().slice(0, 10)
          : row.sign_in_date_of_birth || '',
      mobile: row.normalized_whatsapp || '',
    };
  }
  async function save({ session, targetId = session?.adminId, input, expectedRevision } = {}) {
    if (!session?.ok || session.recoveryRequired) return denied;
    const parsed = details(input || {}, false);
    if (!parsed) return { ok: false, code: 'STAFF_DETAIL_SETUP_INVALID' };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Lock and recheck the live session and canonical authority before saving.
      const row = await authorize(client, session, targetId, true);
      if (!row || row.active !== true || (row.staff_id != null && row.staff_status !== 'active')) {
        await client.query('ROLLBACK');
        return denied;
      }
      if (expectedRevision !== revision(row)) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'STAFF_DETAIL_SETUP_STALE' };
      }
      // This screen cannot change the canonical contact identity.
      if (parsed.mobile !== row.normalized_whatsapp) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'STAFF_DETAIL_SETUP_INVALID' };
      }
      await client.query(
        `UPDATE staff_admin_accounts SET sign_in_first_name=$2,sign_in_surname=$3,sign_in_date_of_birth=$4 WHERE id=$1`,
        [row.id, parsed.firstName, parsed.surname, parsed.dateOfBirth],
      );
      await client.query(
        `UPDATE staff_browser_sessions SET revoked_at=$2,revoke_reason='details_changed'
        WHERE admin_id=$1 AND auth_method='staff_details' AND revoked_at IS NULL`,
        [row.id, now()],
      );
      await client.query(
        `UPDATE staff_auth_webauthn_challenges SET consumed_at=$2 WHERE admin_id=$1
        AND purpose='registration' AND consumed_at IS NULL`,
        [row.id, now()],
      );
      await client.query(
        `INSERT INTO staff_auth_security_events(event_type,operator_admin_id,subject_admin_id,auth_method,metadata)
        VALUES('staff_details_updated',$1,$2,'control','{}'::jsonb)`,
        [session.adminId, row.id],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (_) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      return { ok: false, code: 'STAFF_DETAIL_SETUP_UNAVAILABLE' };
    } finally {
      client.release();
    }
  }
  return { read, save };
}
module.exports = { createStaffDetailSetupService, canManageStaffDetails };
