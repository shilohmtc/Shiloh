'use strict';

const { pool } = require('../db/pool');

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function xorIdentity({ legacyClientId = null, crmV2ClientId = null } = {}) {
  const legacy = positiveId(legacyClientId);
  const v2 = positiveId(crmV2ClientId);
  return Number(Boolean(legacy)) + Number(Boolean(v2)) === 1
    ? { legacyClientId: legacy, crmV2ClientId: v2 }
    : null;
}

function sameRevision(actual, expected) {
  if (!expected) return true;
  const left = new Date(actual).getTime();
  const right = new Date(expected).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

async function cancelOwnedAppointmentInTransaction(db, {
  appointmentId,
  legacyClientId = null,
  crmV2ClientId = null,
  expectedRevision = null,
  requireFutureStart = false,
  now = new Date(),
  changedBy = 'client',
  reason = 'Client cancellation confirmed',
  auditMetadata = {},
} = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Cancellation database transaction is required');
  const id = positiveId(appointmentId);
  const identity = xorIdentity({ legacyClientId, crmV2ClientId });
  if (!id || !identity) return { status: 'ownership_changed' };

  const locked = await db.query(
    `SELECT id,status,client_id,crm_v2_client_id,starts_at,ends_at,updated_at
       FROM appointments
      WHERE id=$1
        AND client_id IS NOT DISTINCT FROM $2::bigint
        AND crm_v2_client_id IS NOT DISTINCT FROM $3::bigint
      FOR UPDATE`,
    [id, identity.legacyClientId, identity.crmV2ClientId],
  );
  const appointment = locked.rows[0];
  if (!appointment) return { status: 'ownership_changed' };
  if (String(appointment.status || '') === 'cancelled') return { status: 'already_cancelled' };
  if (!sameRevision(appointment.updated_at, expectedRevision)) return { status: 'appointment_changed' };
  if (requireFutureStart && new Date(appointment.starts_at).getTime() <= new Date(now).getTime()) {
    return { status: 'appointment_started' };
  }

  await db.query(
    `UPDATE appointments
        SET status='cancelled',updated_at=NOW()
      WHERE id=$1`,
    [id],
  );
  await db.query(
    `UPDATE appointment_lifecycle
        SET status='cancelled',updated_at=NOW()
      WHERE appointment_id=$1`,
    [id],
  );
  await db.query(
    `INSERT INTO appointment_status_history
       (appointment_id,from_status,to_status,changed_by,reason)
     VALUES($1,$2,'cancelled',$3,$4)`,
    [id, appointment.status, String(changedBy || 'client').slice(0, 160), String(reason || 'Client cancellation confirmed').slice(0, 240)],
  );
  await db.query(
    `INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
     VALUES('client.appointment_cancelled','appointment',$1,$2::jsonb)`,
    [id, JSON.stringify({
      identityModel: identity.crmV2ClientId ? 'crm_v2' : 'legacy',
      clientId: identity.legacyClientId,
      crmV2ClientId: identity.crmV2ClientId,
      schedulingAuthority: 'shiloh_canonical',
      ...((auditMetadata && typeof auditMetadata === 'object' && !Array.isArray(auditMetadata)) ? auditMetadata : {}),
    })],
  );

  return {
    status: 'cancelled',
    appointment: {
      id,
      startsAt: new Date(appointment.starts_at).toISOString(),
      endsAt: new Date(appointment.ends_at).toISOString(),
      previousStatus: String(appointment.status || ''),
    },
  };
}

async function cancelOwnedAppointment({
  db = pool,
  ...options
} = {}) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const release = client !== db && typeof client.release === 'function';
  try {
    await client.query('BEGIN');
    const result = await cancelOwnedAppointmentInTransaction(client, options);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    if (release) client.release();
  }
}

module.exports = {
  positiveId,
  xorIdentity,
  sameRevision,
  cancelOwnedAppointmentInTransaction,
  cancelOwnedAppointment,
};
