import payments from '../src/presentation/calendarPaymentsUx.js';
import fixtures from '../tests/fixtures/bookingPaymentPresentation.js';
function surface(paid = false) {
  const model = fixtures.paymentFixture({ paid });
  model.payment.requests = [];
  const html = payments.renderCalendarPaymentPage({ model, csrfToken: 'synthetic' });
  const node = document.createElement('div');
  node.innerHTML =
    `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]}`.replaceAll(
      '/calendar/pwa/icon-192.png',
      '/assets/pwa/shiloh-pwa-192.png',
    );
  queueMicrotask(() => new Function(payments.calendarPaymentsClientScript())());
  return node;
}
export default { title: 'Workspace/Completed visit rewards', parameters: { layout: 'fullscreen' } };
export const BalanceRemaining = { render: () => surface() };
export const FullyPaid = { render: () => surface(true) };
