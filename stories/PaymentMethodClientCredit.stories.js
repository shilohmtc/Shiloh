import payments from '../src/presentation/calendarPaymentsUx.js';
import clients from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import creditSummary from '../src/presentation/clientCreditSummaryUx.js';
import fixtures from '../tests/fixtures/paymentMethodClientCredit.js';
function surface(html) {
  return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || ''}`.replaceAll('/calendar/pwa/icon-192.png', '/assets/pwa/shiloh-pwa-192.png');
}
function payment(method = 'card_machine', change = () => {}) {
  const model = fixtures.paymentMethodFixture(); change(model);
  const node = document.createElement('div'); node.innerHTML = surface(payments.renderCalendarPaymentPage({ model }));
  queueMicrotask(() => {
    new Function(payments.calendarPaymentsClientScript())();
    const details = node.querySelector('[data-payment-method-card]'); if (details) details.open = true;
    const select = node.querySelector('[data-payment-method]'); if (select) { select.value = method; select.dispatchEvent(new Event('change')); }
    if (method === 'client-credit') { const amount = node.querySelector('[data-booking-noncash="client-credit"] input[name="amount"]'); if (amount) { amount.value = '500'; amount.dispatchEvent(new Event('input')); } }
  });
  return node;
}
function profile(authority = { canIssue: true, canCorrect: true }, unavailable = false) {
  return surface(creditSummary.injectClientCreditSummary(clients.renderClientDetailPageWithCommunications(fixtures.clientProfileFixture), { clientId: 101, credit: unavailable ? null : { balance: 500, authority }, unavailable }));
}
export default { title: 'Workspace/Payment method and client credit', parameters: { layout: 'fullscreen' } };
export const CardMachine = { render: () => payment() };
export const Voucher = { render: () => payment('gift-voucher') };
export const PartialClientCredit = { render: () => payment('client-credit') };
export const ActiveRequest = { render: () => payment('card_machine', model => { model.payment.requests = [{ state: 'pending', amount: '800', purpose: 'payment' }]; }) };
export const ClientCreditSection = { render: () => profile() };
export const ViewOnlyCreditSection = { render: () => profile({}) };
export const CreditUnavailable = { render: () => profile({}, true) };
