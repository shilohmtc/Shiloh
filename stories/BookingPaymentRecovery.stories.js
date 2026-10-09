import presentationFixtures from '../tests/fixtures/bookingPaymentPresentation.js';
const { paymentFixture } = presentationFixtures;
import paymentPresentation from '../src/presentation/calendarPaymentsUx.js';

const { renderCalendarPaymentPage } = paymentPresentation;

function surface(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${style}</style><div data-booking-payment-recovery-story>${body}</div>`;
}

export default { title: 'Workspace/Booking payment recovery', parameters: { layout: 'fullscreen' } };

export const ReplacementRequest = {
  render: () => surface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId: 779, clientName: 'Test Client', clientMobile: '0712345678' },
    consultationRecovery: [{ status:'sent', linkAvailable:false }],
    payment: {
      state: 'unpaid', amountDue: '640.00', netPaid: '0.00', rewardsApplied: '0.00', outstanding: '640.00',
      requests: [
        { amount: '640.00', state: 'failed', request_key: 'old_request_779', provider_payment_url: 'https://pay.ozow.com/old' },
        { amount: '640.00', state: 'link_issued', request_key: 'new_request_779', provider_payment_url: 'https://pay.ozow.com/new' },
      ], entries: [],
    },
    authority: { canCollect: true, canRefund: false, ozowConfigured: true },
} })),
};

export const CancelledLink = {
  render: () => surface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId:779,clientName:'Test Client',clientMobile:'0712345678' },
    consultationRecovery: [{ status:'sent',linkAvailable:false }],
    payment: { state:'partially_paid',amountDue:'590.00',netPaid:'0.00',rewardsApplied:'0.00',welcomeVoucherApplied:'100.00',outstanding:'490.00',requests:[{amount:'295.00',state:'cancelled',purpose:'deposit',request_key:'old_request_779'}],entries:[] },
    deposit: { applicable:true, policy:{ rateBasisPoints:5000 }, requirement:{ state:'awaiting',required_amount:'295.00',net_paid:'0.00',rate_basis_points:5000 }, events:[] },
    authority: { canCollect:true,canRefund:false,ozowConfigured:true },
  } })),
};

export const MissingDepositLink = {
  render: () => surface(renderCalendarPaymentPage({ model: {
    subject: { appointmentId:779, clientName:'Test Client', clientMobile:'0712345678' },
    consultationRecovery: [{ status:'completed', linkAvailable:false }],
    payment: { state:'unpaid', amountDue:'590.00', netPaid:'0.00', rewardsApplied:'0.00', outstanding:'590.00', requests:[{ amount:'295.00', state:'created', purpose:'deposit', request_key:'pending_deposit_779' }], entries:[] },
    deposit: { applicable:true, policy:{ rateBasisPoints:5000, freeNoticeHours:48, partialNoticeHours:24, partialForfeitBasisPoints:5000, lateForfeitBasisPoints:10000 }, requirement:{ state:'awaiting', required_amount:'295.00', net_paid:'0.00', rate_basis_points:5000 }, events:[] },
    authority: { canCollect:true, canRefund:false, ozowConfigured:true },
  } })),
};

export const PaidWithEarlierDeposit = {
  render: () => surface(renderCalendarPaymentPage({ model: paymentFixture() })),
};
export const BalanceWithSatisfiedDeposit = {
  render: () => surface(renderCalendarPaymentPage({ model: paymentFixture({ paid: false }) })),
};
export const AwaitingDeposit = {
  render: () => surface(renderCalendarPaymentPage({ model: paymentFixture({ paid: false, awaitingDeposit: true }) })),
};
