'use strict';
const { paymentMethodFixture } = require('./paymentMethodClientCredit');
function priorPaymentFixture({
  settled = false,
  viewOnly = false,
  partial = false,
  receiptReview = false,
} = {}) {
  const model = paymentMethodFixture();
  model.authority.canRecordPrior = !viewOnly;
  if (viewOnly) model.authority.canCollect = false;
  model.payment = {
    ...model.payment,
    accountId: 100,
    amountDue: '500.00',
    netPaid: '0.00',
    receivedToday: '0.00',
    previouslyPaid: settled ? '500.00' : '0.00',
    priorPaid: settled ? '500.00' : '0.00',
    outstanding: settled ? '0.00' : '500.00',
    state: settled ? 'paid' : 'unpaid',
  };
  model.priorPayments = {
    candidates: [
      {
        id: 51,
        amount: '800.00',
        available: '300.00',
        appointment_id: 202,
        reference: 'SYNTHETIC-SEPTEMBER-RECEIPT',
      },
    ],
    entries: settled
      ? [
          {
            id: 71,
            booking_payment_account_id: 100,
            appointment_id: 779,
            entry_type: 'apply',
            amount: '500.00',
            payment_date: '2026-09-15',
            reference: 'SYNTHETIC-SEPTEMBER-RECEIPT',
            reason: 'Verified earlier bank receipt',
            actor_name: 'Synthetic Reception',
            created_at: '2026-10-12T08:00Z',
          },
        ]
      : [],
  };
  if (partial) {
    Object.assign(model.payment, {
      state: 'partially_paid',
      priorPaid: '200.00',
      previouslyPaid: '200.00',
      treatmentCreditApplied: '100.00',
      outstanding: '200.00',
    });
    model.priorPayments.entries = [
      {
        id: 71,
        booking_payment_account_id: 100,
        appointment_id: 779,
        entry_type: 'apply',
        amount: '200.00',
        payment_date: '2026-09-15',
        reference: 'SYNTHETIC-SEPTEMBER-RECEIPT',
        reason: 'Verified earlier receipt',
        actor_name: 'Synthetic Reception',
        created_at: '2026-10-12T08:00Z',
      },
    ];
  }
  if (receiptReview) {
    Object.assign(model.payment, {
      state: 'overpaid',
      priorPaid: '500.00',
      previouslyPaid: '500.00',
      netPaid: '250.00',
      receivedToday: '250.00',
      outstanding: '0.00',
      entries: [
        {
          id: 81,
          entry_type: 'payment',
          method: 'ozow',
          amount: '250.00',
          created_at: '2026-10-12T09:00Z',
        },
      ],
    });
    model.paymentReview = {
      kind: 'prior_settlement_payment_received',
      metadata: { priorPaymentEntryId: 71 },
    };
  }
  return model;
}
module.exports = { priorPaymentFixture };
