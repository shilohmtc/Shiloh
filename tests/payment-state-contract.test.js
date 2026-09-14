const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATES,
  EVIDENCE,
  transitionPaymentState,
  isTerminalPaymentState,
  bookingTruthEffect,
} = require('../src/domain/paymentState');

test('payment lifecycle is monotonic and failed cancelled expired states are terminal', () => {
  assert.equal(transitionPaymentState(STATES.CREATED, STATES.LINK_ISSUED), STATES.LINK_ISSUED);
  assert.equal(transitionPaymentState(STATES.LINK_ISSUED, STATES.PENDING), STATES.PENDING);
  assert.throws(() => transitionPaymentState(STATES.FAILED, STATES.PENDING));
  assert.equal(isTerminalPaymentState(STATES.FAILED), true);
  assert.equal(isTerminalPaymentState(STATES.CANCELLED), true);
  assert.equal(isTerminalPaymentState(STATES.EXPIRED), true);
});

test('paid and refund truth require verified provider evidence', () => {
  assert.throws(() => transitionPaymentState(STATES.PENDING, STATES.PAID));
  assert.equal(
    transitionPaymentState(STATES.PENDING, STATES.PAID, { evidence: EVIDENCE.VERIFIED_PROVIDER }),
    STATES.PAID,
  );
  assert.throws(() => transitionPaymentState(STATES.PAID, STATES.REFUNDED));
  assert.equal(
    transitionPaymentState(STATES.PAID, STATES.REFUNDED, { evidence: EVIDENCE.VERIFIED_PROVIDER }),
    STATES.REFUNDED,
  );
});

test('authorized reception evidence can settle an explicitly recorded in-person payment', () => {
  assert.equal(
    transitionPaymentState(STATES.PENDING, STATES.PAID, { evidence: EVIDENCE.AUTHORIZED_MANUAL }),
    STATES.PAID,
  );
});

test('browser redirect or internal code cannot silently assert payment truth', () => {
  assert.throws(() => transitionPaymentState(STATES.LINK_ISSUED, STATES.PAID, { evidence: EVIDENCE.INTERNAL }));
  assert.throws(() => transitionPaymentState(STATES.PAID, STATES.PAID, { evidence: EVIDENCE.INTERNAL }));
});

test('payment truth contract explicitly cannot mutate booking attendance calendar or loyalty truth', () => {
  assert.deepEqual(bookingTruthEffect(), {
    mutateAppointmentStatus: false,
    mutateAttendanceStatus: false,
    mutateCalendar: false,
    mutateLoyalty: false,
    note: 'Payment truth is separate from booking, attendance, calendar and loyalty truth.',
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/domain/paymentState.js'), 'utf8');
  assert.doesNotMatch(source, /pool\.query|UPDATE appointments|INSERT INTO appointments|sendWhatsApp|fetch\(/i);
});
