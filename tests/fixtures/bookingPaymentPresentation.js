'use strict';
function paymentFixture({ paid = true, awaitingDeposit = false, final = false } = {}) {
  return {
    subject: { appointmentId: 779, crmV2ClientId: 101, status: 'completed', clientName: 'Synthetic Client', clientMobile: '0810000101', final },
    authority: { canCollect: true, canRefund: true, ozowConfigured: true },
    consultationRecovery: [{ status: 'completed', linkAvailable: false }],
    payment: { state: paid ? 'paid' : awaitingDeposit ? 'unpaid' : 'partially_paid', amountDue: '1450.00', netPaid: paid ? '1450.00' : awaitingDeposit ? '0.00' : '725.00', rewardsApplied: '0.00', outstanding: paid ? '0.00' : awaitingDeposit ? '1450.00' : '725.00', requests: [{ amount: '725.00', purpose: 'deposit', state: 'link_issued', request_key: 'synthetic_deposit_779', provider_payment_url: 'https://pay.ozow.com/synthetic' }], entries: paid || !awaitingDeposit ? [{ entry_type: 'payment', method: 'card_machine', amount: paid ? '1450.00' : '725.00', created_at: '2026-10-08T09:00:00Z' }] : [] },
    deposit: { applicable: true, policy: { rateBasisPoints: 5000 }, requirement: { state: awaitingDeposit ? 'awaiting' : 'satisfied', required_amount: '725.00', net_paid: awaitingDeposit ? '0.00' : '725.00', rate_basis_points: 5000 }, events: [] },
    rewards: { balance: '150.00', unlocked: true },
    noncash: { eligible: !awaitingDeposit, credit: { canApply: true, balance: '350.00' }, gift: { canApply: true, vouchers: [{ voucher_code: 'SV-SYNTHETIC01', balance: '500.00', valid_until: '2027-10-08' }, { voucher_code: 'SV-SYNTHETIC02', balance: '100.00', valid_until: null }] } },
  };
}
module.exports = { paymentFixture };
