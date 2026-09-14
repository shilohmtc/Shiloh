const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  COUPLES_DISCOUNT_CAPABILITY,
  priceCouplesBooking,
} = require('../src/services/calendarCouplesPricing');
const { evaluateCalendarAuthority } = require('../src/services/calendarAuthorization');

test('#985 uses a dedicated Couples discount capability instead of broad service pricing', () => {
  assert.equal(COUPLES_DISCOUNT_CAPABILITY, 'appointment:couples:discount');
  assert.notEqual(COUPLES_DISCOUNT_CAPABILITY, 'service:pricing');
});

test('#985 grants Couples discount authority to owner and Reception roles but not business admin', () => {
  const principal = businessRole => evaluateCalendarAuthority({
    id: businessRole === 'owner' ? 1 : businessRole === 'booking_operator' ? 2 : 3,
    admin_active: true,
    staff_id: null,
    staff_status: null,
    business_role: businessRole,
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: {
      'service:pricing': true,
      'appointment:couples:discount': businessRole !== 'business_admin',
    },
  });
  assert.equal(principal('owner').capabilities.includes(COUPLES_DISCOUNT_CAPABILITY), true);
  assert.equal(principal('booking_operator').capabilities.includes(COUPLES_DISCOUNT_CAPABILITY), true);
  assert.equal(principal('business_admin').capabilities.includes(COUPLES_DISCOUNT_CAPABILITY), false);
});

test('#985 migration grants the dedicated capability by canonical role and excludes business admin', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/122_couples_discount_capability.sql'), 'utf8');
  assert.match(migration, /business_role IN \('owner','booking_operator'\)/);
  assert.doesNotMatch(migration, /business_role IN \([^)]*business_admin/);
  assert.match(migration, /appointment:couples:discount/);
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

test('discounting fails closed without authority while its note remains optional', () => {
  assert.throws(
    () => priceCouplesBooking({
      prices: [850, 620],
      discount: { type: 'percent', value: 10, reason: 'Requested' },
      canDiscount: false,
    }),
    error => error.code === 'COUPLES_DISCOUNT_FORBIDDEN' && error.httpStatus === 403
  );
  const withoutNote = priceCouplesBooking({
    prices: [850, 620],
    discount: { type: 'amount', value: 50, reason: '' },
    canDiscount: true,
  });
  assert.equal(withoutNote.discountReason, null);
  assert.equal(withoutNote.total, 1420);
});
