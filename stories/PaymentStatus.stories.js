import paymentStatusPresentation from '../src/presentation/paymentStatusUx.js';

const { renderPaymentStatusPage } = paymentStatusPresentation;

function surface(state) {
  const html = renderPaymentStatusPage({
    requestKey: 'example_reference',
    request: { amount: '295.00', state, appointment_id:779, appointment_status:'scheduled' },
    whatsappNumber: '27820001234',
  });
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${style}</style><div data-payment-status-story>${body}</div>`;
}

export default { title: 'Client/Payment status', parameters: { layout: 'fullscreen' } };

export const PaymentNotConfirmed = { render: () => surface('failed') };
export const PaymentReceived = { render: () => surface('paid') };
