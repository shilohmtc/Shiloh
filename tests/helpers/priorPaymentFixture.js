'use strict';
const fs = require('node:fs');
const { createBookingPaymentService } = require('../../src/services/bookingPayments');
const { money } = require('../../src/services/bookingPayments');
async function install(queryable) {
  for (const file of [
    'tests/fixtures/treatment-credit-schema.sql',
    'migrations/188_client_treatment_credit.sql',
    'tests/fixtures/prior-payment-schema.sql',
    'migrations/191_booking_prior_payments.sql',
  ])
    await queryable.query(fs.readFileSync(file, 'utf8'));
}
function serviceFor(db) {
  return createBookingPaymentService({
    db,
    now: () => new Date('2026-10-12T10:00:00Z'),
    ozow: { configured: () => false, verifyNotification: () => true },
    rewards: { getClientBalance: async () => null, syncEligibleEarnings: async () => {} },
    deposits: {
      ensureRequirement: async () => ({ applicable: false }),
      getPosition: async () => ({ applicable: false }),
    },
  });
}
function priorInput(overrides = {}) {
  return {
    adminId: 2,
    appointmentId: 201,
    amount: money('500'),
    paymentDate: '2026-09-15',
    reference: 'SYNTHETIC-SEP-PAYMENT',
    reason: 'Verified earlier bank receipt',
    reviewed: true,
    operationId: require('node:crypto').randomUUID(),
    ...overrides,
  };
}
module.exports = { install, serviceFor, priorInput };
