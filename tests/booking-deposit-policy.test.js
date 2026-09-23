'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  basisPointsAmount,
  calculateDepositRequirement,
  retentionRule,
} = require('../src/domain/bookingDepositPolicy');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const policy = {
  deposit_basis_points: 5000,
  exempt_staff_display_name: 'Marietjie',
  exempt_staff_business_role: 'tenant_practitioner',
};

test('50% deposit is calculated in cents without changing the booking total', () => {
  assert.equal(basisPointsAmount('650.00', 5000), '325.00');
  assert.equal(basisPointsAmount('1190.00', 5000), '595.00');
  assert.equal(basisPointsAmount('451.00', 5000), '225.50');
});

test('Marietjie-only appointment is exempt from the deposit', () => {
  const result = calculateDepositRequirement([{
    appointmentId: 10,
    amount: '650.00',
    staff: [{ displayName: 'Marietjie', businessRole: 'tenant_practitioner' }],
  }], policy);
  assert.equal(result.requiredAmount, '0.00');
  assert.equal(result.eligibleAmountBase, '0.00');
  assert.equal(result.exemptReason, 'marietjie');
  assert.equal(result.items[0].exemptReason, 'marietjie');
});

test('linked booking excludes only Marietjie portion', () => {
  const result = calculateDepositRequirement([
    {
      appointmentId: 11,
      amount: '650.00',
      staff: [{ displayName: 'Marietjie', businessRole: 'tenant_practitioner' }],
    },
    {
      appointmentId: 12,
      amount: '720.00',
      staff: [{ displayName: 'Christel', businessRole: 'owner' }],
    },
  ], policy);
  assert.equal(result.eligibleAmountBase, '720.00');
  assert.equal(result.requiredAmount, '360.00');
  assert.equal(result.exemptReason, null);
  assert.equal(result.items[0].requiredAmount, '0.00');
  assert.equal(result.items[1].requiredAmount, '360.00');
});

test('deposit retention bands match approved 48/24 clinic policy', () => {
  const start = '2026-09-30T10:00:00+02:00';
  assert.equal(retentionRule({ outcome:'cancelled', appointmentStartsAt:start, eventAt:'2026-09-28T09:59:00+02:00' }).retentionBasisPoints, 0);
  assert.equal(retentionRule({ outcome:'rescheduled', appointmentStartsAt:start, eventAt:'2026-09-29T04:00:00+02:00' }).retentionBasisPoints, 5000);
  assert.equal(retentionRule({ outcome:'cancelled', appointmentStartsAt:start, eventAt:'2026-09-29T12:00:00+02:00' }).retentionBasisPoints, 10000);
  assert.equal(retentionRule({ outcome:'no_show', appointmentStartsAt:start, eventAt:'2026-09-30T10:05:00+02:00' }).retentionBasisPoints, 10000);
});

test('migration creates one prospective policy authority and never auto-refunds', () => {
  const sql = read('migrations/150_booking_deposit_policy.sql');
  assert.match(sql, /shiloh_booking_deposit_v1/);
  assert.match(sql, /5000,48,24,5000,10000,10000,'Marietjie','tenant_practitioner'/);
  assert.match(sql, /activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(sql, /booking_payment_requirements/);
  assert.match(sql, /booking_payment_requirement_items/);
  assert.match(sql, /booking_deposit_dispositions/);
  assert.match(sql, /awaiting_payment/);
  assert.match(sql, /AFTER UPDATE OF starts_at,status ON appointments/);
  assert.doesNotMatch(sql, /INSERT INTO payment_ledger_entries[\s\S]*entry_type[\s\S]*refund/i);
});

test('payment authority uses the approved deposit WhatsApp templates and holds confirmation', () => {
  const payments = read('src/services/bookingPayments.js');
  const confirmations = read('src/services/customerBookingConfirmation.js');
  assert.match(payments, /PAYMENT_TEMPLATE_KEYS\.DEPOSIT_REQUEST/);
  assert.match(payments, /PAYMENT_TEMPLATE_KEYS\.DEPOSIT_RECEIVED/);
  assert.match(payments, /purpose='deposit'/);
  assert.match(payments, /releaseBookingConfirmations/);
  assert.match(confirmations, /deliveryStatus:'awaiting_deposit'/);
  assert.match(confirmations, /status='awaiting_payment'/);
});

test('booking policy tells clients the same deposit and cancellation terms', () => {
  const terms = read('src/services/bookingPolicy.js');
  assert.match(terms, /POLICY_VERSION = "2026-09-23-v2"/);
  assert.match(terms, /50% booking deposit is required to secure every appointment/);
  assert.match(terms, /except appointments with Marietjie/);
  assert.match(terms, /Between 24 and 48 hours/);
  assert.match(terms, /full booking deposit is retained/);
});

test('rewards and welcome voucher cannot substitute for an unpaid deposit', () => {
  assert.match(read('src/services/shilohRewards.js'), /REWARDS_DEPOSIT_REQUIRED/);
  assert.match(read('src/services/myShilohWelcomeVoucher.js'), /WELCOME_VOUCHER_DEPOSIT_REQUIRED/);
});

test('staff and My Shiloh surfaces expose deposit state', () => {
  assert.match(read('src/presentation/calendarPaymentsUx.js'), /50% booking deposit required/);
  assert.match(read('src/presentation/calendarPaymentsUx.js'), /Appointments with Marietjie are excluded/);
  assert.match(read('src/services/myShilohExperienceOrchestrator.js'), /deposit due/);
  assert.match(read('stories/WorkspaceSurfaces.stories.js'), /MarietjieDepositExemptPayment/);
  assert.match(read('stories/MyShilohPwa.stories.js'), /AuthenticatedDepositDue/);
});
