'use strict';
const { createBookingPaymentService, BookingPaymentError } = require('./bookingPayments');

function validateCompletionPayment(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)
    || !['paid', 'outstanding', 'settled'].includes(decision.choice)) {
    throw new BookingPaymentError('COMPLETION_PAYMENT_REQUIRED', 'Choose Paid or Payment outstanding before completing this visit.');
  }
  const allowed = decision.choice === 'paid' ? ['choice','amount','method','operationId','expectedRevision','confirmed'] : ['choice'];
  if (Object.keys(decision).some(key => !allowed.includes(key))) throw new BookingPaymentError('COMPLETION_PAYMENT_INVALID', 'Review the payment choice before completing this visit.');
  if (decision.choice === 'paid' && (decision.confirmed !== true || !decision.operationId || !decision.expectedRevision)) {
    throw new BookingPaymentError('COMPLETION_PAYMENT_CONFIRMATION_REQUIRED', 'Confirm the amount and method of the money received.');
  }
  return decision;
}

async function recordCompletionPayment(db, { adminId, appointmentId, decision, paymentService }) {
  validateCompletionPayment(decision);
  // This explicit choice records no money and grants no payment-reading access.
  if (decision.choice === 'outstanding') return { choice: 'outstanding' };
  const service = paymentService || createBookingPaymentService({ db });
  if (decision.choice === 'settled') {
    // Use the same already-locked transaction rather than opening another snapshot.
    const state = await service.getCompletionStateInTransaction(db, { adminId, appointmentId });
    if (state.priceReview || state.payment?.outstanding == null || Number(state.payment.outstanding) !== 0) throw new BookingPaymentError('COMPLETION_BALANCE_CHANGED', 'The payment balance changed. Review it before completing this visit.', 409);
    return { choice: 'settled' };
  }
  const group = await db.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1', [appointmentId]);
  if (group.rows.length) throw new BookingPaymentError('COMPLETION_GROUP_PAYMENT_REVIEW', 'Record the group payment with its payer in Payments, then return to complete this person’s visit.', 409);
  // Replays must belong to this appointment, amount and method, even if a stale
  // browser accidentally reuses an operation key from a different receipt.
  const prior = await db.query(`SELECT p.amount,p.method,a.appointment_id FROM payment_ledger_entries p
    JOIN booking_payment_accounts a ON a.id=p.payment_account_id WHERE p.operation_key=$1`, [`manual:${adminId}:${decision.operationId}`]);
  if (prior.rows.length && (String(prior.rows[0].appointment_id) !== String(appointmentId) || Number(prior.rows[0].amount) !== Number(decision.amount) || prior.rows[0].method !== decision.method)) {
    throw new BookingPaymentError('COMPLETION_RECEIPT_CONFLICT', 'This receipt reference was already used. Review Payments before recording anything else.', 409);
  }
  const receipt = await service.recordManualInTransaction(db, { adminId, appointmentId, amount: decision.amount, method: decision.method,
    operationId: decision.operationId, expectedRevision: decision.expectedRevision });
  return { choice: 'paid', amount: receipt.amount, method: receipt.method, operationId: decision.operationId, outstanding: receipt.result.outstanding };
}
module.exports = { validateCompletionPayment, recordCompletionPayment };
