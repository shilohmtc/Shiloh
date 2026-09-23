'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const {
  createBookingDepositPolicyService,
} = require('../src/services/bookingDepositPolicy');
const {
  paymentPosition,
  buildClientExperience,
} = require('../src/services/myShilohExperienceOrchestrator');

const policy = {
  id: 1,
  enabled: true,
  rateBasisPoints: 5000,
  freeNoticeHours: 48,
  partialNoticeHours: 24,
  partialForfeitBasisPoints: 5000,
  lateForfeitBasisPoints: 10000,
  noShowForfeitBasisPoints: 10000,
  exemptStaffId: 13,
  effectiveFrom: new Date('2026-09-23T00:00:00.000Z'),
  policyVersion: '2026-09-23-v1',
};

function member({ appointmentId, amount, staffIds }) {
  return {
    appointmentId,
    allocatedAmount: amount,
    staffIds,
    staffNames: [],
    clientName: 'Client',
    clientMobile: '27821234567',
    serviceName: 'Treatment',
    startsAt: new Date('2026-09-30T08:00:00.000Z'),
    endsAt: new Date('2026-09-30T09:00:00.000Z'),
  };
}

test('deposit policy is one forward authority with the approved 50%, 48/24 and Marietjie rules', () => {
  const migration = read('migrations/150_booking_deposit_policy.sql');
  assert.match(migration, /rate_basis_points[^\n]*5000|VALUES\(1, TRUE, 5000, 48, 24, 5000, 10000, 10000/);
  assert.match(migration, /free_notice_hours[^\n]*48|5000, 48, 24/);
  assert.match(migration, /partial_notice_hours[^\n]*24|48, 24/);
  assert.match(migration, /LOWER\(TRIM\(display_name\)\)='marietjie'/);
  assert.match(migration, /exactly one active Marietjie staff record/);
  assert.match(migration, /NEW\.to_status NOT IN \('cancelled','no_show'\)/);
  assert.match(migration, /policy_forfeit_amount/);
  assert.match(migration, /Money|money/i);
});

test('ordinary non-Marietjie bookings require 50 percent', () => {
  const service = createBookingDepositPolicyService({ db: {} });
  const calculated = service.calculate({
    members: [member({ appointmentId: 1, amount: 650, staffIds: [11] })],
  }, policy);
  assert.equal(calculated.eligibleAmount, 650);
  assert.equal(calculated.requiredAmount, 325);
  assert.equal(calculated.state, 'awaiting');
  assert.equal(calculated.members[0].exemptionReason, null);
});

test('Marietjie bookings are deposit exempt', () => {
  const service = createBookingDepositPolicyService({ db: {} });
  const calculated = service.calculate({
    members: [member({ appointmentId: 2, amount: 490, staffIds: [13] })],
  }, policy);
  assert.equal(calculated.eligibleAmount, 0);
  assert.equal(calculated.requiredAmount, 0);
  assert.equal(calculated.state, 'exempt');
  assert.equal(calculated.members[0].exemptionReason, 'marietjie');
});

test('linked bookings only charge the non-Marietjie portion', () => {
  const service = createBookingDepositPolicyService({ db: {} });
  const calculated = service.calculate({
    members: [
      member({ appointmentId: 3, amount: 600, staffIds: [11] }),
      member({ appointmentId: 4, amount: 400, staffIds: [13] }),
    ],
  }, policy);
  assert.equal(calculated.eligibleAmount, 600);
  assert.equal(calculated.requiredAmount, 300);
  assert.equal(calculated.members[0].requiredAmount, 300);
  assert.equal(calculated.members[1].requiredAmount, 0);
});

test('booking confirmation and payment wiring cannot bypass the deposit gate', () => {
  const confirmation = read('src/services/customerBookingConfirmation.js');
  const payments = read('src/services/bookingPayments.js');
  assert.match(confirmation, /ensureDepositRequest/);
  assert.match(confirmation, /reason:'deposit_required'/);
  assert.match(confirmation, /deliveryStatus:'awaiting_deposit'/);
  assert.match(payments, /PAYMENT_TEMPLATE_KEYS\.DEPOSIT_REQUEST/);
  assert.match(payments, /PAYMENT_TEMPLATE_KEYS\.DEPOSIT_RECEIVED/);
  assert.match(payments, /purpose='deposit'/);
  assert.match(payments, /deposit_notification_sent_at/);
  assert.match(payments, /releaseConfirmedBookingAfterDeposit/);
});

test('deposit policy remains separate from the immutable legacy Booking Policy authority', () => {
  const source = read('src/services/bookingPolicy.js');
  assert.match(source, /const POLICY_VERSION = "2026-08-11-v1"/);
  assert.match(source, /Policy updated: 11 August 2026/);
  assert.doesNotMatch(source, /50% booking deposit|24–48 hours|Marietjie are excluded/);
});

test('My Shiloh gives deposit priority without treating rewards as deposit payment', () => {
  const awaiting = paymentPosition({
    state: 'unpaid',
    outstanding: '650.00',
    depositState: 'awaiting',
    depositRequired: '325.00',
    depositOutstanding: '325.00',
    activePaymentPath: '/pay/dep_example123',
  });
  assert.equal(awaiting.state, 'deposit_required');
  assert.match(awaiting.label, /R325/);
  assert.equal(awaiting.actionPath, '/pay/dep_example123');

  const paid = paymentPosition({
    state: 'partially_paid',
    outstanding: '325.00',
    depositState: 'satisfied',
    depositRequired: '325.00',
    depositOutstanding: '0.00',
    activePaymentPath: null,
  });
  assert.equal(paid.state, 'deposit_paid');
  assert.match(paid.label, /Deposit paid/);

  const exempt = paymentPosition({
    state: 'unpaid',
    outstanding: '490.00',
    depositState: 'exempt',
    activePaymentPath: null,
  });
  assert.deepEqual(exempt, { state:'deposit_exempt', label:'No deposit required', actionPath:null });
});

test('My Shiloh Home asks for the deposit before claiming the booking is ready', () => {
  const experience = buildClientExperience({
    generatedAt: '2026-09-23T18:00:00.000Z',
    client: { id: 1, name: 'Christel' },
    nextAppointment: {
      id: 91,
      startsAt: '2026-09-30T08:00:00.000Z',
      endsAt: '2026-09-30T09:00:00.000Z',
      status: 'scheduled',
      services: ['Hot Stone Massage'],
      practitioners: ['Christel'],
    },
    forms: [],
    payment: {
      state: 'unpaid',
      outstanding: '680.00',
      depositState: 'awaiting',
      depositRequired: '340.00',
      depositOutstanding: '340.00',
      depositRatePercent: 50,
      depositFreeNoticeHours: 48,
      depositPartialNoticeHours: 24,
      depositPartialForfeitPercent: 50,
      depositLateForfeitPercent: 100,
      activePaymentPath: '/pay/dep_example123',
    },
  });
  assert.equal(experience.home.status, 'Deposit');
  assert.equal(experience.home.primaryAction.label, 'Pay deposit');
  assert.match(experience.home.headline, /awaiting its deposit/);
  assert.match(experience.home.summary, /50% booking deposit/);
  assert.match(experience.home.summary, /48\+ hours notice/);
  assert.match(experience.home.summary, /24–48 hours/);
});
