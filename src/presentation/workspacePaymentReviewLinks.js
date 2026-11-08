'use strict';
const ROOT = '/calendar/workspace/payments';
function safePaymentReviewReturn(value) {
  if (typeof value !== 'string' || value.length > 100 || value !== value.trim()) return null;
  return /^\/calendar\/workspace\/payments(?:\?after=[1-9][0-9]*)?(?:#upcoming-deposits)?$/.test(value) ? value : null;
}
function paymentHref(id, returnTo, fragment = '') {
  return `/calendar/payments/appointments/${encodeURIComponent(id)}?returnReview=${encodeURIComponent(returnTo)}${fragment}`;
}
module.exports = { ROOT, safePaymentReviewReturn, paymentHref };
