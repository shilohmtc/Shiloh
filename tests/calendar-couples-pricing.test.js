const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COUPLES_DISCOUNT_CAPABILITY,
  priceCouplesBooking,
} = require('../src/services/calendarCouplesPricing');

test('#985 uses Shiloh service:pricing as the existing discretionary discount capability', () => {
  assert.equal(COUPLES_DISCOUNT_CAPABILITY, 'service:pricing');
});

test('#985 applies a percentage discount to the overall canonical subtotal', () => {
  assert.deepEqual(
    priceCouplesBooking({
      prices: [850, 620],
      discount: { type: 'percent', value: 10, reason: 'Returning clients' },
      canDiscount: true,
    }),
    {
      subtotal: 1470,
      discountType: 'percent',
      discountValue: 10,
      discountAmount: 147,
      discountReason: 'Returning clients',
      total: 1323,
      allocations: [765, 558],
    }
  );
});

test('#985 applies a Rand discount and preserves exact cent allocation', () => {
  const pricing = priceCouplesBooking({
    prices: [850, 620],
    discount: { type: 'amount', value: 70, reason: 'Owner discretion' },
    canDiscount: true,
  });
  assert.equal(pricing.subtotal, 1470);
  assert.equal(pricing.discountAmount, 70);
  assert.equal(pricing.total, 1400);
  assert.deepEqual(pricing.allocations, [809.53, 590.47]);
  assert.equal(pricing.allocations.reduce((sum, value) => sum + value, 0), pricing.total);
});

test('#985 discounting fails closed without pricing authority or an audit reason', () => {
  assert.throws(
    () => priceCouplesBooking({
      prices: [850, 620],
      discount: { type: 'percent', value: 10, reason: 'Requested' },
      canDiscount: false,
    }),
    error => error.code === 'COUPLES_DISCOUNT_FORBIDDEN' && error.httpStatus === 403
  );
  assert.throws(
    () => priceCouplesBooking({
      prices: [850, 620],
      discount: { type: 'amount', value: 50, reason: '' },
      canDiscount: true,
    }),
    error => error.code === 'COUPLES_DISCOUNT_REASON_REQUIRED'
  );
});
