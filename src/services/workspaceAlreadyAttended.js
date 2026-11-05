'use strict';

const { pool } = require('../db/pool');
const { loadRequest, requestSnapshotMatches, operatorCanResolve, BookingRequestError } = require('./clientBookingApproval');
const { requireRoutingAuthority } = require('./workspaceBookingRequestRouting');
const { canCertifyAppointment } = require('./attendanceFinalizationAuthority');
const { recordFinalization } = require('./adminAppointmentFinalization');

function revision(value) {
  const time = value && new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function alreadyAttended({ principal, appointmentId, expectedRevision, expectedAppointmentRevision, expectedApprovalRevision, paymentDecision, completionPaymentService = null, dbPool = pool } = {}) {
  require('./workspaceCompletionPayment').validateCompletionPayment(paymentDecision);
  const id = Number(appointmentId);
  if (!Number.isSafeInteger(id) || id <= 0 || !revision(expectedRevision) || !revision(expectedAppointmentRevision) || !revision(expectedApprovalRevision)) {
    throw new BookingRequestError('BOOKING_REQUEST_INVALID', 'Refresh Workspace before recording attendance.');
  }
  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    await require('./paymentCollectionGuard').lockBookingPaymentScope(db, id);
    const row = await loadRequest(db, id, true);
    if (!row) throw new BookingRequestError('BOOKING_REQUEST_NOT_FOUND', 'This booking request is no longer available. Refresh Workspace.', 409);
    await requireRoutingAuthority(db, principal, id);
    if (!operatorCanResolve(principal, row) || !(await canCertifyAppointment(principal, id, db, { workspace: true, allowBusinessBackup: true }))) {
      throw new BookingRequestError('BOOKING_REQUEST_FORBIDDEN', 'Your current authority cannot record attendance for this visit.', 403);
    }
    // Group resolution moves all members together. Never infer their attendance,
    // partially resolve a group or make a later group decision impossible.
    const membership = await db.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1', [id]);
    if (membership.rows.length) throw new BookingRequestError('BOOKING_REQUEST_GROUP_REVIEW', 'Review each person’s outcome in this grouped booking. This shortcut cannot resolve group attendance.', 409);
    if (!['pending', 'awaiting_client_confirmation'].includes(row.status)
      || !['scheduled', 'confirmed', 'completed'].includes(row.appointment_status)
      || revision(expectedRevision) !== revision(row.requested_revision)
      || revision(expectedAppointmentRevision) !== revision(row.current_revision)
      || revision(expectedApprovalRevision) !== revision(row.updated_at)) {
      throw new BookingRequestError('BOOKING_REQUEST_STALE', 'This visit or request changed. Refresh Workspace before trying again.', 409);
    }
    const ended = await db.query('SELECT $1::timestamptz < clock_timestamp() AS ended', [row.current_ends_at]);
    if (ended.rows[0]?.ended !== true) throw new BookingRequestError('BOOKING_REQUEST_NOT_ENDED', 'Attendance can be recorded after the appointment ends.', 409);
    // Completion advances updated_at. For an already completed visit, independently
    // check its displayed revision and every original booking identity/time field.
    const snapshot = row.appointment_status === 'completed' ? { ...row, current_revision: row.requested_revision } : row;
    if (!requestSnapshotMatches(snapshot)) throw new BookingRequestError('BOOKING_REQUEST_CANONICAL_DRIFT', 'The booked details changed. Review this appointment before resolving the request.', 409);
    const financialOutcome = await require('./workspaceCompletionPayment').recordCompletionPayment(db, { adminId: principal.id, appointmentId: id, decision: paymentDecision, paymentService: completionPaymentService });
    if (row.appointment_status !== 'completed') {
      const appointment = (await db.query('SELECT total_price FROM appointments WHERE id=$1', [id])).rows[0];
      await recordFinalization(db, principal, {
        id, status: row.appointment_status, starts_at: row.current_starts_at, total_price: appointment.total_price,
      }, 'completed', { workspace: true, allowBusinessBackup: true, paymentDecision: financialOutcome });
    }
    await db.query(`UPDATE appointment_booking_approvals SET status='approved',decided_at=NOW(),
      decided_by_admin_id=$2,decision_note='workspace_already_attended',updated_at=NOW()
      WHERE appointment_id=$1`, [id, principal.id]);
    await db.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
      VALUES($1,'client.booking_request.already_attended','appointment',$2,$3::jsonb)`,
    [principal.id, String(id), JSON.stringify({ surface: 'workspace_booking_requests', paymentDecision: financialOutcome, fromRequestStatus: row.status,
      previousAppointmentStatus: row.appointment_status, requestedRevision: revision(row.requested_revision),
      appointmentRevision: revision(row.current_revision), proposalVersion: row.proposal_version,
      explicitAdminDecision: true, clientNotificationSent: false, depositRequested: false })]);
    await db.query('COMMIT');
    if (financialOutcome.choice === 'paid') await (completionPaymentService || require('./bookingPayments').createBookingPaymentService({ db: dbPool })).syncCompletionRewards();
    return { ok: true, appointmentId: id, status: 'approved', outcome: 'completed', paymentOutcome: financialOutcome };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

module.exports = { alreadyAttended };
