const { pool } = require('../db/pool');
const { createWorkspacePushService } = require('./workspacePush');

const GLOBAL_COORDINATION_ROLES = ['owner', 'business_admin', 'booking_operator'];

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function requestAlertContext(db, appointmentId) {
  const id = positiveId(appointmentId);
  if (!id) return null;
  const result = await db.query(`
    SELECT aba.appointment_id,aba.status,aba.requested_staff_id,aba.requested_starts_at,
           COALESCE(st.display_name,'Shiloh practitioner') AS staff_name,
           t.id AS team_id,t.display_name AS team_name
      FROM appointment_booking_approvals aba
      LEFT JOIN staff st ON st.id=aba.requested_staff_id
      LEFT JOIN staff_operational_team_members tm ON tm.staff_id=aba.requested_staff_id AND tm.active=TRUE
      LEFT JOIN staff_operational_teams t ON t.id=tm.team_id AND t.active=TRUE
     WHERE aba.appointment_id=$1
     LIMIT 1`, [id]);
  return result.rows?.[0] || null;
}

async function alertRecipients(db, context) {
  if (!context) return [];
  const result = await db.query(`
    SELECT DISTINCT a.id AS admin_id,a.display_name,
           CASE
             WHEN a.business_role='owner' THEN 'global'
             WHEN brcs.admin_id IS NOT NULL THEN brcs.scope_kind
             WHEN a.business_role=ANY($2::text[]) AND a.calendar_scope='all_business' THEN 'global'
             ELSE 'self'
           END AS effective_scope,
           brcs.team_id,
           CASE
             WHEN a.business_role<>'owner' AND brcs.admin_id IS NOT NULL AND brcs.scope_kind='team' THEN (
               SELECT COUNT(DISTINCT pending.appointment_id)::int
                 FROM appointment_booking_approvals pending
                 JOIN staff_operational_team_members pending_tm
                   ON pending_tm.staff_id=pending.requested_staff_id
                  AND pending_tm.active=TRUE
                WHERE pending.status IN ('pending','awaiting_client_confirmation')
                  AND pending_tm.team_id=brcs.team_id
             )
             ELSE (
               SELECT COUNT(*)::int
                 FROM appointment_booking_approvals pending
                WHERE pending.status IN ('pending','awaiting_client_confirmation')
             )
           END AS pending_count
      FROM staff_admin_accounts a
      LEFT JOIN booking_request_coordination_scopes brcs ON brcs.admin_id=a.id AND brcs.active=TRUE
     WHERE a.active=TRUE
       AND a.business_role=ANY($2::text[])
       AND a.calendar_scope='all_business'
       AND (
         (a.business_role='owner' AND (brcs.admin_id IS NULL OR brcs.receive_alerts=TRUE))
         OR
         (brcs.admin_id IS NOT NULL AND brcs.receive_alerts=TRUE AND (
            brcs.scope_kind='global' OR (brcs.scope_kind='team' AND brcs.team_id=$1)
          ))
         OR
         (brcs.admin_id IS NULL AND a.business_role=ANY($2::text[]) AND a.calendar_scope='all_business')
       )
     ORDER BY a.id`, [positiveId(context.team_id), GLOBAL_COORDINATION_ROLES]);
  return result.rows || [];
}

async function dispatchBookingRequestAlerts({
  db = pool,
  appointmentId,
  queueAlert = createWorkspacePushService({ db }).queue,
} = {}) {
  const context = await requestAlertContext(db, appointmentId);
  if (!context || !['pending', 'awaiting_client_confirmation'].includes(context.status)) {
    return { appointmentId: positiveId(appointmentId), recipients: 0, queued: 0, accepted: 0, failed: 0, skipped: true };
  }
  const recipients = await alertRecipients(db, context);
  // Reuse the Workspace event ledger; the Reception queue remains authoritative
  // whether or not a staff member has enabled phone notifications.
  const delivery = await queueAlert(`booking_request:${context.appointment_id}`, {
    adminIds: recipients.map((recipient) => Number(recipient.admin_id)),
  });
  return { appointmentId: Number(context.appointment_id), recipients: recipients.length,
    ...delivery, skipped: false };
}

module.exports = { GLOBAL_COORDINATION_ROLES, requestAlertContext, alertRecipients, dispatchBookingRequestAlerts };
