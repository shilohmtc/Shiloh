'use strict';
const RECEIPT_STATES_SQL = "'paid','refunded','partially_refunded'";
const EXCEPTION_ACTIONS_SQL = "'payment.received_after_booking_cancelled','payment.received_after_prior_settlement','payment.received_after_no_charge','payment.received_after_deposit_waived','payment.received_after_collection_changed'";
async function paymentEvidenceRequiresReview(db, accountId) {
  const row = (await db.query(`SELECT
    EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.payment_account_id=$1 AND pr.state IN (${RECEIPT_STATES_SQL})
      AND NOT EXISTS(SELECT 1 FROM payment_ledger_entries e WHERE e.payment_request_id=pr.id AND e.entry_type='payment'))
    OR EXISTS(SELECT 1 FROM crm_audit_events e WHERE e.entity_type='booking_payment_account' AND e.entity_id=$1
      AND e.action IN (${EXCEPTION_ACTIONS_SQL})) AS needs_review`, [accountId])).rows[0];
  if (typeof row?.needs_review !== 'boolean') throw Object.assign(new Error('Payment evidence could not be verified. Review payments before using rewards.'), { code: 'PAYMENT_EVIDENCE_UNAVAILABLE', httpStatus: 503 });
  return row.needs_review;
}
module.exports = { RECEIPT_STATES_SQL, EXCEPTION_ACTIONS_SQL, paymentEvidenceRequiresReview };
