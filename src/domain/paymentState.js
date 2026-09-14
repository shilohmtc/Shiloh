const STATES = Object.freeze({
  CREATED: 'created',
  LINK_ISSUED: 'link_issued',
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  PARTIALLY_REFUNDED: 'partially_refunded',
  REFUNDED: 'refunded',
});

const EVIDENCE = Object.freeze({
  INTERNAL: 'internal',
  VERIFIED_PROVIDER: 'verified_provider',
  AUTHORIZED_MANUAL: 'authorized_manual',
});

const TRANSITIONS = Object.freeze({
  [STATES.CREATED]: new Set([STATES.LINK_ISSUED, STATES.CANCELLED]),
  [STATES.LINK_ISSUED]: new Set([STATES.PENDING, STATES.PAID, STATES.FAILED, STATES.CANCELLED, STATES.EXPIRED]),
  [STATES.PENDING]: new Set([STATES.PAID, STATES.FAILED, STATES.CANCELLED, STATES.EXPIRED]),
  [STATES.PAID]: new Set([STATES.PARTIALLY_REFUNDED, STATES.REFUNDED]),
  [STATES.PARTIALLY_REFUNDED]: new Set([STATES.PARTIALLY_REFUNDED, STATES.REFUNDED]),
  [STATES.FAILED]: new Set(),
  [STATES.CANCELLED]: new Set(),
  [STATES.EXPIRED]: new Set(),
  [STATES.REFUNDED]: new Set(),
});

const SETTLEMENT_PROOF_REQUIRED = new Set([
  STATES.PAID,
  STATES.PARTIALLY_REFUNDED,
  STATES.REFUNDED,
]);

function assertState(value) {
  if (!Object.values(STATES).includes(value)) throw new Error(`Unknown payment state: ${value}`);
}

function transitionPaymentState(currentState, nextState, { evidence = EVIDENCE.INTERNAL } = {}) {
  assertState(currentState);
  assertState(nextState);

  if (currentState === nextState) {
    if (SETTLEMENT_PROOF_REQUIRED.has(nextState) && ![EVIDENCE.VERIFIED_PROVIDER, EVIDENCE.AUTHORIZED_MANUAL].includes(evidence)) {
      throw new Error(`Verified settlement evidence is required to reaffirm payment state ${nextState}`);
    }
    return nextState;
  }

  if (!TRANSITIONS[currentState].has(nextState)) {
    throw new Error(`Payment transition ${currentState} -> ${nextState} is not allowed`);
  }

  if (SETTLEMENT_PROOF_REQUIRED.has(nextState) && ![EVIDENCE.VERIFIED_PROVIDER, EVIDENCE.AUTHORIZED_MANUAL].includes(evidence)) {
    throw new Error(`Verified settlement evidence is required for payment state ${nextState}`);
  }

  return nextState;
}

function isTerminalPaymentState(state) {
  assertState(state);
  return TRANSITIONS[state].size === 0;
}

function bookingTruthEffect() {
  return Object.freeze({
    mutateAppointmentStatus: false,
    mutateAttendanceStatus: false,
    mutateCalendar: false,
    mutateLoyalty: false,
    note: 'Payment truth is separate from booking, attendance, calendar and loyalty truth.',
  });
}

module.exports = {
  STATES,
  EVIDENCE,
  transitionPaymentState,
  isTerminalPaymentState,
  bookingTruthEffect,
};
