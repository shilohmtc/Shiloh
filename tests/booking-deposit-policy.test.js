'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const {
  createBookingDepositPolicyService,
  bookingDepositPolicyPreview,
  buildClientDepositPolicyNotice,
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
  policyVersion: '2026-09-23-v2',
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

test('pending WhatsApp requests explain the deposit flow before staff acceptance', () => {
  const preview = bookingDepositPolicyPreview({
    policy,
    createdAt: '2026-09-23T10:00:00.000Z',
    startsAt: '2026-09-30T08:00:00.000Z',
    canonicalTotal: null,
    fullyExempt: false,
    now: '2026-09-23T11:00:00.000Z',
  });
  const notice = buildClientDepositPolicyNotice(preview);
  assert.equal(preview.applicable, true);
  assert.equal(preview.priceKnown, false);
  assert.match(notice, /50% booking deposit/);
  assert.match(notice, /not an extra fee/);
  assert.match(notice, /booking price still needs to be confirmed/i);
  assert.match(notice, /48\+ hours/);
  assert.match(notice, /24–48 hours/);
  assert.match(notice, /No-show/);
  assert.match(notice, /confirmed only after Shiloh verifies the required deposit/);
});

test('deposit approval readiness fails before acceptance when the canonical price is unresolved', async () => {
  const db = {
    async query(sql) {
      if (String(sql).includes('FROM clinic_booking_deposit_policy')) {
        return {
          rows: [{
            id: 1,
            enabled: true,
            rate_basis_points: 5000,
            free_notice_hours: 48,
            partial_notice_hours: 24,
            partial_forfeit_basis_points: 5000,
            late_forfeit_basis_points: 10000,
            no_show_forfeit_basis_points: 10000,
            exempt_staff_id: 13,
            exempt_staff_name: 'Marietjie',
            exempt_staff_status: 'active',
            effective_from: '2026-09-23T00:00:00.000Z',
            policy_version: '2026-09-23-v2',
          }],
        };
      }
      if (String(sql).includes('FROM appointments a')) {
        return {
          rows: [{
            id: 758,
            created_at: '2026-09-23T19:13:00.000Z',
            starts_at: '2026-09-30T06:00:00.000Z',
            group_id: null,
            canonical_total: null,
            fully_exempt: false,
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createBookingDepositPolicyService({ db });
  await assert.rejects(
    service.assertApprovalReady({
      appointmentId: 758,
      now: new Date('2026-09-23T19:14:00.000Z'),
    }),
    error => error.code === 'DEPOSIT_PRICE_UNRESOLVED'
      && error.httpStatus === 409
      && /before accepting this request/i.test(error.message),
  );
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
  const policyJourney = read('src/services/bookingPolicy.js');
  assert.match(policyJourney, /getClientPolicyPreview/);
  assert.match(policyJourney, /buildClientDepositPolicyNotice/);
  const depositAuthority = read('src/services/bookingDepositPolicy.js');
  assert.match(
    depositAuthority,
    /CASE WHEN gm\.group_id IS NULL[\s\S]*THEN a\.total_price[\s\S]*ELSE COALESCE\(g\.final_total,g\.total_price\)/,
  );
});

test('booking and deposit flows share one current Booking Policy authority', () => {
  const authority = read('src/config/bookingPolicyAuthority.js');
  const booking = read('src/services/bookingPolicy.js');
  const deposit = read('src/services/bookingDepositPolicy.js');
  const migration = read('migrations/151_unified_booking_policy_and_appointment_758_price.sql');
  assert.match(authority, /BOOKING_POLICY_VERSION = '2026-09-23-v2'/);
  assert.match(authority, /50% booking deposit/);
  assert.match(authority, /48\\+ hours/);
  assert.match(authority, /24–48 hours/);
  assert.match(authority, /Marietjie/);
  assert.match(booking, /BOOKING_POLICY_VERSION: POLICY_VERSION/);
  assert.match(booking, /BOOKING_POLICY_TEXT: POLICY_TEXT/);
  assert.match(deposit, /BOOKING_POLICY_AUTHORITY/);
  assert.match(deposit, /DEPOSIT_POLICY_DRIFT/);
  assert.match(migration, /policy_version='2026-09-23-v2'/);
});

test('appointment 758 correction is exact, guarded and restores the R250 booking total', () => {
  const migration = read('migrations/151_unified_booking_policy_and_appointment_758_price.sql');
  assert.match(migration, /WHERE a\.id=758/);
  assert.match(migration, /total_price=250/);
  assert.match(migration, /price_snapshot=250/);
  assert.match(migration, /source IS DISTINCT FROM 'shiloh_client_whatsapp'/);
  assert.match(migration, /duration is not 30 minutes/);
  assert.match(migration, /toegelonly/);
  assert.match(migration, /christel/);
  assert.match(migration, /total_service_count <> 1 OR matching_service_count <> 1/);
  assert.match(migration, /total_staff_count <> 1 OR matching_staff_count <> 1/);
  assert.match(migration, /payment account already exists/);
  assert.match(migration, /appointment\.price_corrected/);
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
