import payments from '../src/presentation/calendarPaymentsUx.js';
import fixtures from '../tests/fixtures/bookingPriorPaymentPresentation.js';
function surface(options) {
  const html = payments.renderCalendarPaymentPage({ model: fixtures.priorPaymentFixture(options) });
  const node = document.createElement('div');
  node.innerHTML = `<style>${html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || ''}`;
  queueMicrotask(() => {
    new Function(payments.calendarPaymentsClientScript())();
    const selector = node.querySelector('[data-payment-method]');
    if (
      selector &&
      options?.viewOnly !== true &&
      options?.settled !== true &&
      options?.receiptReview !== true
    ) {
      selector.value = 'prior-payment';
      selector.dispatchEvent(new Event('change'));
      node.querySelector('[data-payment-method-card]').open = true;
    }
  });
  return node;
}
export default { title: 'Workspace/Paid previously', parameters: { layout: 'fullscreen' } };
export const Reception = { render: () => surface({}) };
export const PaidPreviously = { render: () => surface({ settled: true }) };
export const ViewOnly = { render: () => surface({ settled: true, viewOnly: true }) };
export const PartialPriorWithCredit = { render: () => surface({ partial: true }) };
export const PriorReceiptReview = { render: () => surface({ settled: true, receiptReview: true }) };
