'use strict';

const { createHash } = require('node:crypto');
const { bookingDepositPolicyPreview, moneyText, percentAmount } = require('./bookingDepositPolicy');

function quoteWhatsAppBooking({
  serviceId,
  staffId,
  startsAt,
  total,
  pricingHash = null,
  policy,
  now,
}) {
  const preview = bookingDepositPolicyPreview({
    policy,
    createdAt: now,
    startsAt,
    canonicalTotal: total,
    fullyExempt: policy?.exemptStaffId != null && String(staffId) === String(policy.exemptStaffId),
    now,
  });
  if (!preview.priceKnown || preview.reason === 'past_booking') return null;

  const price = moneyText(total);
  const deposit = moneyText(
    preview.applicable && !preview.exempt ? percentAmount(price, policy.rateBasisPoints) : 0,
  );
  const reviewHash = createHash('sha256')
    .update(
      JSON.stringify([
        String(serviceId),
        String(staffId),
        new Date(startsAt).toISOString(),
        price,
        deposit,
        pricingHash,
        preview.policyVersion,
        preview.applicable,
        preview.exempt,
      ]),
    )
    .digest('base64url');
  return { price, deposit, reviewHash };
}

module.exports = { quoteWhatsAppBooking };
