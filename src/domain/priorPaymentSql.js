'use strict';
// Incoming historic value settles the target; linked receipt value leaves its source.
function priorPaymentSql(accountId) {
  return `COALESCE((SELECT incoming-outgoing FROM booking_prior_payment_totals WHERE account_id=${accountId}),0)`;
}
function priorPaymentIncomingSql(accountId) {
  return `COALESCE((SELECT incoming FROM booking_prior_payment_totals WHERE account_id=${accountId}),0)`;
}
function priorPaymentOutgoingSql(accountId) {
  return `COALESCE((SELECT outgoing FROM booking_prior_payment_totals WHERE account_id=${accountId}),0)`;
}
module.exports = { priorPaymentSql, priorPaymentIncomingSql, priorPaymentOutgoingSql };
