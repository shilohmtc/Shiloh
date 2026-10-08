import presentation from '../src/presentation/clientTreatmentCreditUx.js';
const { renderTreatmentCreditPage } = presentation;
function surface(html) { html=html.replaceAll('/calendar/pwa/icon-192.png','/assets/pwa/shiloh-pwa-192.png'); return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`; }
export const model = { client: { id: 991, name: 'Synthetic Client' }, balance: 350, authority: { canIssue: true, canApply: true },
  appointments: [{ id: 991, title: 'Completed treatment', starts_at: '2026-10-08T08:00:00Z', total_price: '650.00' }],
  entries: [{ id: 3, entry_type: 'apply', signed_amount: '-150.00', reason: 'Applied to completed treatment', appointment_id: 991, actor_name: 'Synthetic Reception', created_at: '2026-10-08T09:00:00Z' },
    { id: 2, entry_type: 'issue', credit_type: 'service_exchange', signed_amount: '400.00', reason: 'Supplier work exchanged for treatment credit', reference: 'SYNTHETIC-INVOICE-101', actor_name: 'Synthetic Reception', created_at: '2026-10-08T08:00:00Z' },
    { id: 1, entry_type: 'issue', credit_type: 'goodwill', signed_amount: '100.00', reason: 'Care adjustment', actor_name: 'Synthetic Owner', created_at: '2026-10-07T08:00:00Z' }] };
export default { title: 'Shiloh/Client treatment credit' };
export const CreditHistory = { render: () => surface(renderTreatmentCreditPage({ model, csrfToken: 'synthetic' })) };
export const Empty = { render: () => surface(renderTreatmentCreditPage({ model: { ...model, balance: 0, entries: [], appointments: [] }, csrfToken: 'synthetic' })) };
export const ViewOnly = { render: () => surface(renderTreatmentCreditPage({ model: { ...model, authority: {} }, csrfToken: 'synthetic' })) };
