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
    payment: { state:'unpaid',amountDue:'590.00',netPaid:'0.00',rewardsApplied:'0.00',outstanding:'590.00',requests:[{amount:'295.00',state:'cancelled',request_key:'old_request_779'}],entries:[] },
    authority: { canCollect:true,canRefund:false,ozowConfigured:true },
  } })),
};
