const COUPLES_DISCOUNT_CAPABILITY = 'appointment:couples:discount';

function pricingError(code, message, httpStatus = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function cents(value, code = 'COUPLES_INVALID_PRICE') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw pricingError(code, 'The canonical treatment price is not usable for a Couples booking.', 409);
  }
  return Math.round((number + Number.EPSILON) * 100);
}

function money(valueInCents) {
  return Number((Number(valueInCents) / 100).toFixed(2));
}

function normalizeDiscount(discount = {}, subtotalCents, canDiscount) {
  const type = String(discount?.type || 'none').trim().toLowerCase();
  if (!type || type === 'none') {
    return {
      discountType: null,
      discountValue: null,
      discountAmountCents: 0,
      discountReason: null,
    };
  }
  if (!canDiscount) {
    throw pricingError(
      'COUPLES_DISCOUNT_FORBIDDEN',
      'Current Shiloh authority does not permit discretionary discounts.',
      403
    );
  }
  if (!['amount', 'percent'].includes(type)) {
    throw pricingError('COUPLES_INVALID_DISCOUNT', 'Choose a Rand amount or percentage discount.');
  }
  const value = Number(discount?.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw pricingError('COUPLES_INVALID_DISCOUNT', 'Enter a discount greater than zero.');
  }
  const reason = String(discount?.reason || '').trim().replace(/\s+/g, ' ');
  if (!reason) {
    throw pricingError('COUPLES_DISCOUNT_REASON_REQUIRED', 'Enter a reason for the discretionary discount.');
  }
  if (reason.length > 160) {
    throw pricingError('COUPLES_DISCOUNT_REASON_TOO_LONG', 'Keep the discount reason to 160 characters or fewer.');
  }

  let discountAmountCents;
  if (type === 'amount') {
    discountAmountCents = cents(value, 'COUPLES_INVALID_DISCOUNT');
  } else {
    if (value > 100) throw pricingError('COUPLES_INVALID_DISCOUNT', 'Percentage discount cannot exceed 100%.');
    discountAmountCents = Math.round((subtotalCents * value) / 100);
  }
  if (discountAmountCents > subtotalCents) {
    throw pricingError('COUPLES_INVALID_DISCOUNT', 'The discount cannot exceed the canonical subtotal.');
  }
  return {
    discountType: type,
    discountValue: Number(value.toFixed(2)),
    discountAmountCents,
    discountReason: reason,
  };
}

function allocateFinalCents(priceCents, discountAmountCents) {
  const subtotalCents = priceCents.reduce((sum, value) => sum + value, 0);
  if (priceCents.length !== 2 || subtotalCents <= 0) {
    throw pricingError('COUPLES_INVALID_PRICE', 'Choose two canonically priced treatments.', 409);
  }
  const firstDiscount = Math.floor((discountAmountCents * priceCents[0]) / subtotalCents);
  const secondDiscount = discountAmountCents - firstDiscount;
  return [
    priceCents[0] - firstDiscount,
    priceCents[1] - secondDiscount,
  ];
}

function priceCouplesBooking({ prices = [], discount = null, canDiscount = false } = {}) {
  if (!Array.isArray(prices) || prices.length !== 2) {
    throw pricingError('COUPLES_TWO_TREATMENTS_REQUIRED', 'Choose one treatment for each guest.');
  }
  const priceCents = prices.map(value => cents(value));
  if (priceCents.some(value => value <= 0)) {
    throw pricingError('COUPLES_INVALID_PRICE', 'Both selected treatments need a positive fixed canonical price.', 409);
  }
  const subtotalCents = priceCents.reduce((sum, value) => sum + value, 0);
  const normalized = normalizeDiscount(discount || {}, subtotalCents, canDiscount);
  const totalCents = subtotalCents - normalized.discountAmountCents;
  const allocations = allocateFinalCents(priceCents, normalized.discountAmountCents);
  return {
    subtotal: money(subtotalCents),
    discountType: normalized.discountType,
    discountValue: normalized.discountValue,
    discountAmount: money(normalized.discountAmountCents),
    discountReason: normalized.discountReason,
    total: money(totalCents),
    allocations: allocations.map(money),
  };
}

module.exports = {
  COUPLES_DISCOUNT_CAPABILITY,
  priceCouplesBooking,
  pricingError,
};
