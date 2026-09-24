'use strict';

const { pool } = require('../db/pool');

function normalizeAppointmentId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error('A positive appointment ID is required');
    error.code = 'INVALID_APPOINTMENT_ID';
    throw error;
  }
  return id;
}

async function getAppointmentReadDiagnostic(value, query = pool.query.bind(pool)) {
  const appointmentId = normalizeAppointmentId(value);
  const [appointment, approval, payment, confirmation] = await Promise.all([
    query(`SELECT id,status,source,starts_at,ends_at,total_price FROM appointments WHERE id=$1`, [appointmentId]),
    query(`SELECT status,requested_at,decided_at FROM appointment_booking_approvals WHERE appointment_id=$1`, [appointmentId]),
    query(`SELECT bpa.canonical_amount_due, bdr.required_amount AS deposit_required_amount,
                   bdr.state AS deposit_state,
                   COALESCE((SELECT SUM(amount) FROM payment_ledger_entries
                              WHERE payment_account_id=bpa.id AND entry_type='payment'),0) AS paid_amount,
                   COALESCE((SELECT SUM(amount) FROM payment_ledger_entries
                              WHERE payment_account_id=bpa.id AND entry_type='refund'),0) AS refunded_amount,
                   (SELECT COUNT(*)::int FROM payment_requests WHERE payment_account_id=bpa.id) AS payment_request_count,
                   (SELECT COUNT(*)::int FROM payment_ledger_entries WHERE payment_account_id=bpa.id) AS ledger_entry_count
              FROM booking_payment_accounts bpa
              LEFT JOIN booking_deposit_requirements bdr ON bdr.payment_account_id=bpa.id
             WHERE bpa.appointment_id=$1`, [appointmentId]),
    query(`SELECT status,claimed_at,sent_at,updated_at,last_attempt_at,
                   provider_message_id IS NOT NULL AS provider_message_recorded,
                   provider_sent_at IS NOT NULL AS provider_sent,
                   provider_delivered_at IS NOT NULL AS provider_delivered,
                   provider_read_at IS NOT NULL AS provider_read,
                   provider_failed_at IS NOT NULL AS provider_failed,
                   last_error IS NOT NULL AS has_last_error
              FROM customer_message_deliveries
             WHERE appointment_id=$1 AND message_kind='booking_confirmation'`, [appointmentId]),
  ]);

  const row = appointment.rows[0];
  if (!row) return { appointmentId, found: false };

  const paymentRow = payment.rows[0] || null;
  const confirmationRow = confirmation.rows[0] || null;
  return {
    appointmentId,
    found: true,
    appointment: {
      status: row.status || null,
      source: row.source || null,
      startsAt: row.starts_at || null,
      endsAt: row.ends_at || null,
      totalPrice: row.total_price == null ? null : Number(row.total_price),
    },
    approval: approval.rows[0] ? {
      status: approval.rows[0].status || null,
      requestedAt: approval.rows[0].requested_at || null,
      decidedAt: approval.rows[0].decided_at || null,
    } : null,
    payment: paymentRow ? {
      canonicalAmountDue: paymentRow.canonical_amount_due == null ? null : Number(paymentRow.canonical_amount_due),
      depositRequiredAmount: paymentRow.deposit_required_amount == null ? null : Number(paymentRow.deposit_required_amount),
      depositState: paymentRow.deposit_state || null,
      paidAmount: Number(paymentRow.paid_amount || 0),
      refundedAmount: Number(paymentRow.refunded_amount || 0),
      paymentRequestCount: Number(paymentRow.payment_request_count || 0),
      ledgerEntryCount: Number(paymentRow.ledger_entry_count || 0),
    } : null,
    confirmation: confirmationRow ? {
      status: confirmationRow.status || null,
      claimedAt: confirmationRow.claimed_at || null,
      sentAt: confirmationRow.sent_at || null,
      updatedAt: confirmationRow.updated_at || null,
      lastAttemptAt: confirmationRow.last_attempt_at || null,
      providerMessageRecorded: confirmationRow.provider_message_recorded === true,
      providerSent: confirmationRow.provider_sent === true,
      providerDelivered: confirmationRow.provider_delivered === true,
      providerRead: confirmationRow.provider_read === true,
      providerFailed: confirmationRow.provider_failed === true,
      hasLastError: confirmationRow.has_last_error === true,
    } : null,
  };
}

module.exports = { normalizeAppointmentId, getAppointmentReadDiagnostic };
