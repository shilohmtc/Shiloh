const { pool } = require('../db/pool');

async function pendingBookingProposalConflicts({
  db = pool,
  staffId,
  startsAt,
  endsAt,
  excludeAppointmentId = null,
}) {
  const result = await db.query(`
    SELECT 'booking_request_proposal_hold'::text AS conflict_type,
           aba.appointment_id AS id,
           aba.proposed_starts_at AS starts_at,
           aba.proposed_ends_at AS ends_at,
           'Awaiting client confirmation'::text AS label
      FROM appointment_booking_approvals aba
      JOIN appointments a
        ON a.id=aba.appointment_id
       AND a.status NOT IN ('cancelled','no_show')
     WHERE aba.status='awaiting_client_confirmation'
       AND aba.proposal_expires_at>NOW()
       AND aba.proposed_staff_ids @> ARRAY[$1::bigint]
       AND aba.proposed_starts_at<$3
       AND aba.proposed_ends_at>$2
       AND ($4::bigint IS NULL OR aba.appointment_id<>$4)
     ORDER BY aba.proposed_starts_at,aba.appointment_id
  `, [staffId, startsAt, endsAt, excludeAppointmentId]);
  return result.rows || [];
}

module.exports = { pendingBookingProposalConflicts };
