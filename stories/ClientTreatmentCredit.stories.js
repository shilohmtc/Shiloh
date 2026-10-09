import presentation from '../src/presentation/clientTreatmentCreditUx.js';
const { renderTreatmentCreditPage } = presentation;
function surface(html) { html=html.replaceAll('/calendar/pwa/icon-192.png','/assets/pwa/shiloh-pwa-192.png'); return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`; }
export const model = { client: { id: 991, name: 'Synthetic Client' }, balance: 350, authority: { canIssue: true, canApply: true, canCorrect: true },
  appointments: [{ id: 991, title: 'Completed treatment', starts_at: '2026-10-08T08:00:00Z', total_price: '650.00' }],
  entries: [{ id: 3, correctable_amount: '150', entry_type: 'apply', signed_amount: '-150.00', reason: 'Applied to completed treatment', appointment_id: 991, actor_name: 'Synthetic Reception', created_at: '2026-10-08T09:00:00Z' },
    { id: 2, correctable_amount: '350', entry_type: 'issue', credit_type: 'service_exchange', signed_amount: '400.00', reason: 'Supplier work exchanged for treatment credit', reference: 'SYNTHETIC-INVOICE-101', actor_name: 'Synthetic Reception', created_at: '2026-10-08T08:00:00Z' },
    { id: 1, entry_type: 'issue', credit_type: 'goodwill', signed_amount: '100.00', reason: 'Care adjustment', actor_name: 'Synthetic Owner', created_at: '2026-10-07T08:00:00Z' }] };
export default { title: 'Shiloh/Client treatment credit' };
export const CreditHistory = { render: () => surface(renderTreatmentCreditPage({ model, csrfToken: 'synthetic' })) };
export const Empty = { render: () => surface(renderTreatmentCreditPage({ model: { ...model, balance: 0, entries: [], appointments: [] }, csrfToken: 'synthetic' })) };
export const ViewOnly = { render: () => surface(renderTreatmentCreditPage({ model: { ...model, authority: {} }, csrfToken: 'synthetic' })) };

export const CorrectedHistory = { render: () => surface(renderTreatmentCreditPage({ model: { ...model, balance: 300, entries: [
  { id: 5, entry_type: 'undo', signed_amount: '50', reason: 'Reviewed cancelled treatment and payment history', source_entry_id: 3, source_reason: 'Applied to completed treatment', appointment_id: 991, actor_name: 'Synthetic Reception', created_at: '2026-10-08T11:00:00Z' },
  { id: 4, entry_type: 'reduce', signed_amount: '-100', reason: 'Corrected duplicate exchange amount', reference: 'SYNTHETIC-INVOICE-101', source_entry_id: 2, source_reason: 'Supplier work exchanged for treatment credit', actor_name: 'Synthetic Owner', created_at: '2026-10-08T10:00:00Z' },
  ...model.entries.map(e => ({ ...e, correctable_amount: e.id === 3 ? '100' : e.id === 2 ? '300' : '0' }))] }, csrfToken: 'synthetic' })) };

// Synthetic booking settlement uses the production payment renderer, without real wallet operations.
import payments from '../src/presentation/calendarPaymentsUx.js';
export const bookingModel = {subject:{appointmentId:991,crmV2ClientId:991,status:'completed',clientName:'Synthetic Client',clientMobile:'0820000009',final:false},authority:{canCollect:true,canRefund:true,ozowConfigured:false},payment:{amountDue:'650',paid:'100',refunded:'0',netPaid:'100',rewardsApplied:'0',welcomeVoucherApplied:'0',treatmentCreditApplied:'50',giftVoucherApplied:'100',outstanding:'400',state:'partially_paid',requests:[],entries:[{id:1,entry_type:'payment',amount:'100',method:'cash',created_at:'2026-10-08T08:00Z'}],noncashEntries:[{kind:'gift_voucher',id:1,action:'apply',amount:100,reason:'Gift voucher ending AAAA',actor:'Synthetic Reception',created_at:'2026-10-08T09:00Z'},{kind:'treatment_credit',id:1,action:'apply',amount:50,reason:'Applied to completed treatment',actor:'Synthetic Reception',created_at:'2026-10-08T09:05Z'}]},noncash:{eligible:true,credit:{balance:350,canApply:true},gift:{canApply:true,vouchers:[{voucher_code:'SV-SYNTHETIC001',balance:'400',valid_until:null},{voucher_code:'SV-SYNTHETIC002',balance:'200',valid_until:'2030-10-08'}]}}};
export const BookingPayment = {render:()=>surface(payments.renderCalendarPaymentPage({model:bookingModel,csrfToken:'synthetic'}))};
export const BookingDeposit = {render:()=>surface(payments.renderCalendarPaymentPage({model:{...bookingModel,subject:{...bookingModel.subject,status:'confirmed'},deposit:{applicable:true,requirement:{state:'awaiting',required_amount:'162.50',net_paid:'0',rate_basis_points:2500},events:[]},noncash:{eligible:false}},csrfToken:'synthetic'}))};
export const BookingCancelled = {render:()=>surface(payments.renderCalendarPaymentPage({model:{...bookingModel,subject:{...bookingModel.subject,status:'cancelled',final:true},noncash:{eligible:false}},csrfToken:'synthetic'}))};
