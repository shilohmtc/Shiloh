'use strict';

async function guestBookingChangeAudit(db, { auditEventId, appointmentId, purpose } = {}) {
  if (!['string', 'number'].includes(typeof auditEventId)
    || !/^[1-9][0-9]*$/.test(String(auditEventId)) || !Number.isSafeInteger(Number(auditEventId))) return null;
  const row = (await db.query(`SELECT id,action,entity_type,entity_id FROM crm_audit_events WHERE id=$1`, [auditEventId])).rows[0];
  if (!row || row.entity_type !== 'appointment' || String(row.entity_id) !== String(appointmentId)) return null;
  // Reuse the existing mutation authority; do not create a second action registry.
  const { ACTION_BY_KIND, ACTION_ALIASES_BY_KIND } = require('./customerChangeNotification');
  const kinds = Object.keys(ACTION_BY_KIND).filter(kind =>
    [ACTION_BY_KIND[kind], ...(ACTION_ALIASES_BY_KIND[kind] || [])].includes(row.action));
  if (kinds.length !== 1) return null;
  const kind = kinds[0];
  if ((kind === 'cancellation' ? 'booking_cancelled' : 'booking_changed') !== purpose) return null;
  return { auditEventId: Number(row.id), kind };
}

module.exports = { guestBookingChangeAudit };
