'use strict';
const crypto = require('node:crypto');
const { canonicalName, details } = require('./clientCrmDetailAuth');
function staffDetailRevision(row) {
  const input = details(
    {
      firstName: row?.sign_in_first_name,
      surname: row?.sign_in_surname,
      dateOfBirth:
        row?.sign_in_date_of_birth instanceof Date
          ? row.sign_in_date_of_birth.toISOString().slice(0, 10)
          : row?.sign_in_date_of_birth,
      mobile: row?.normalized_whatsapp,
    },
    false,
  );
  if (!input) return null;
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        canonicalName(input.firstName),
        canonicalName(input.surname),
        input.dateOfBirth,
        input.mobile,
      ]),
    )
    .digest('hex');
}
function staffDetailsMatch(row, input) {
  if (!row || row.admin_active !== true || (row.staff_id != null && row.staff_status !== 'active'))
    return false;
  return (
    staffDetailRevision(row) ===
    staffDetailRevision({
      sign_in_first_name: input.firstName,
      sign_in_surname: input.surname,
      sign_in_date_of_birth: input.dateOfBirth,
      normalized_whatsapp: input.mobile,
    })
  );
}
function staffDetailsRetired(env = process.env) {
  return env.SHILOH_STAFF_DETAIL_AUTH_RETIRED === 'true';
}
// This compatibility mode must outlive details issuance: disabling the old
// method must never reopen retired SMS/private-link setup routes.
function staffOwnPasskeysEnabled(env = process.env) {
  return staffDetailsRetired(env) || staffDetailAuthEnabled(env);
}
function staffDetailAuthEnabled(env = process.env) {
  return (
    !staffDetailsRetired(env) && env.SHILOH_STAFF_DETAIL_AUTH_ENABLED === 'true' &&
    Buffer.byteLength(String(env.SHILOH_STAFF_DETAIL_AUTH_RATE_KEY || '')) >= 32
  );
}
async function validDetailEnrollment(client, session, current, env) {
  if (
    !staffDetailAuthEnabled(env) ||
    !session?.ok ||
    session.authMethod !== 'staff_details' ||
    session.recoveryRequired
  )
    return false;
  const result = await client.query(
    `SELECT bs.detail_identity_revision, a.sign_in_first_name, a.sign_in_surname,
      a.sign_in_date_of_birth, a.normalized_whatsapp FROM staff_browser_sessions bs JOIN staff_admin_accounts a ON a.id=bs.admin_id
      WHERE bs.id=$1 AND bs.admin_id=$2 AND bs.auth_method='staff_details' AND bs.recovery_required=FALSE
      AND bs.revoked_at IS NULL AND bs.expires_at>$3 FOR UPDATE OF bs`,
    [session.sessionId, session.adminId, current],
  );
  const row = result.rows[0];
  return (
    !!row?.detail_identity_revision && row.detail_identity_revision === staffDetailRevision(row)
  );
}

// Preserve own-account keys for existing, bounded sessions during retirement.
// Saving a key never changes this session's assurance or extends its expiry.
async function validOptionalPasskeySession(client, session, current, env) {
  if (
    !staffOwnPasskeysEnabled(env) ||
    !session?.ok ||
    session.recoveryRequired ||
    !['staff_details', 'passkey'].includes(session.authMethod)
  )
    return false;
  const result = await client.query(
    `SELECT bs.auth_method, bs.detail_identity_revision, a.sign_in_first_name,
      a.sign_in_surname, a.sign_in_date_of_birth, a.normalized_whatsapp
      FROM staff_browser_sessions bs JOIN staff_admin_accounts a ON a.id=bs.admin_id
      WHERE bs.id=$1 AND bs.admin_id=$2 AND bs.recovery_required=FALSE
      AND bs.revoked_at IS NULL AND bs.expires_at>$3 FOR UPDATE OF bs`,
    [session.sessionId, session.adminId, current],
  );
  const row = result.rows[0],
    revision = staffDetailRevision(row);
  return (
    (!!revision || staffDetailsRetired(env) && row?.auth_method === 'passkey') &&
    row.auth_method === session.authMethod &&
    (row.auth_method === 'passkey' || row.detail_identity_revision === revision)
  );
}

module.exports = {
  staffDetailsRetired,
  staffOwnPasskeysEnabled,
  staffDetailRevision,
  staffDetailsMatch,
  staffDetailAuthEnabled,
  validDetailEnrollment,
  validOptionalPasskeySession,
};
