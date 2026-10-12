'use strict';
const crypto = require('node:crypto');
const { pool } = require('../db/pool');
const { details } = require('./clientCrmDetailAuth');
const { strongRecentSession } = require('./staffPasskeyAuth');
const { staffDetailRevision } = require('./staffDetailIdentity');
function revision(row) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([row.id, row.active, staffDetailRevision(row), row.normalized_whatsapp]))
    .digest('hex');
}
function createStaffDetailSetupService({ db = pool, now = () => new Date() } = {}) {
  const denied = { ok: false, code: 'STAFF_DETAIL_SETUP_FORBIDDEN' };
  async function authorize(queryable, session, targetId, lock = false) {
    if (
      !session?.ok ||
      session.recoveryRequired ||
      !Number.isSafeInteger(Number(targetId)) ||
      Number(targetId) <= 0
    )
      return null;
    const operator = (
      await queryable.query(
        `SELECT a.*, s.status AS staff_status FROM staff_admin_accounts a
      LEFT JOIN staff s ON s.id=a.staff_id WHERE a.id=$1${lock ? ' FOR UPDATE OF a' : ''}`,
        [session.adminId],
      )
    ).rows[0];
    if (!operator?.active || (operator.staff_id != null && operator.staff_status !== 'active'))
      return null;
    if (
      Number(session.adminId) !== Number(targetId) &&
      (operator.permissions?.['staff_access:manage'] !== true ||
        operator.calendar_scope !== 'all_business')
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
    if (!strongRecentSession(session, now()))
      return { ok: false, code: 'STAFF_RECENT_STRONG_AUTH_REQUIRED' };
    const parsed = details(input || {}, false);
    if (!parsed) return { ok: false, code: 'STAFF_DETAIL_SETUP_INVALID' };
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Lock and recheck the authorizing session before target identity changes.
      const valid = await client.query(
        `SELECT id FROM staff_browser_sessions WHERE id=$1 AND admin_id=$2
        AND auth_method='passkey' AND recovery_required=FALSE AND revoked_at IS NULL AND expires_at>$3
        AND reauthenticated_at >= $4 FOR UPDATE`,
        [session.sessionId, session.adminId, now(), new Date(now().getTime() - 10 * 60 * 1000)],
      );
      const row = valid.rows.length ? await authorize(client, session, targetId, true) : null;
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
module.exports = { createStaffDetailSetupService };
