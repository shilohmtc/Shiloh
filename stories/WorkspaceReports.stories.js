import reportsPresentation from '../src/presentation/workspaceReportsUx.js';
import financialRecords from '../src/domain/workspaceFinancialRecords.js';
import financialReports from '../src/domain/workspaceFinancialReports.js';

const { renderReportsPage } = reportsPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(match => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.workspace-report-story{min-height:100vh}.workspace-report-story script{display:none}</style><div class="workspace-report-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

function reportModel() {
  const period = { preset: 'week', startKey: '2026-10-05', endInclusiveKey: '2026-10-09', dayCount: 5, previousStartKey: '2026-09-28', previousEndKey: '2026-10-03', from: '2026-10-04T22:00:00Z', to: '2026-10-09T22:00:00Z', previousFrom: '2026-09-27T22:00:00Z', previousTo: '2026-10-02T22:00:00Z' };
  return {
    authority: { displayName: 'Christel', reportScope: 'all_business' },
    period,
    financial: {
      ...financialReports.summarizeFinancials({ period,
        treatments: [{id:732,starts_at:'2026-10-05T08:00:00Z',value:'590',treatment:'Swedish Massage'},
          {id:735,starts_at:'2026-10-06T08:00:00Z',value:'680',treatment:'Hot Stone Massage'},
          {id:736,starts_at:'2026-10-07T08:00:00Z',value:'450',treatment:'Back & Neck Massage'},
          {id:737,starts_at:'2026-10-08T08:00:00Z',value:'590',treatment:'Swedish Massage'},
          {id:738,starts_at:'2026-10-09T08:00:00Z',value:'680',treatment:'Hot Stone Massage'},
          {id:730,starts_at:'2026-09-28T08:00:00Z',value:'1500',treatment:'Massage combination'}],
        receipts: [{id:1,created_at:'2026-10-05T08:00:00Z',amount:'295',method:'cash',entry_type:'payment',appointment_id:732},
          {id:2,created_at:'2026-10-06T08:00:00Z',amount:'680',method:'card_machine',entry_type:'payment',appointment_id:735},
          {id:3,created_at:'2026-10-07T08:00:00Z',amount:'100',method:'cash',entry_type:'refund',appointment_id:732},
          {id:4,created_at:'2026-10-08T08:00:00Z',amount:'450',method:'ozow',entry_type:'payment',appointment_id:739},
          {id:5,created_at:'2026-10-09T08:00:00Z',amount:'1000',method:'cash',entry_type:'payment',source:'voucher',voucher_order_id:10}],
        balances: [{appointment_id:732,starts_at:'2026-10-05T08:00:00Z',amount_due:'590',net_paid:'195',credits:'100'},
          {appointment_id:738,group_id:14,starts_at:'2026-10-09T08:00:00Z',amount_due:'1360',net_paid:'680',credits:'0',mixed_status:true}],
      }), period, vouchers: {issued_count:1,redeemed_value:500,available_balance:2500,expired_balance:100},
      records: { ...financialRecords.summarizeExpenses([
        {id:1,paid_on:'2026-10-05',category:'supplies',description:'Massage oils',reference:'Receipt 104',amount:'125.50',method:'cash',created_by:'Christel'},
        {id:2,paid_on:'2026-10-06',category:'laundry',description:'Laundry service',reference:'Invoice 17',amount:'250',method:'manual_eft',created_by:'Jean-Pierre'},
        {id:3,paid_on:'2026-10-06',category:'supplies',description:'Incorrect amount',reference:'',amount:'200',method:'cash',created_by:'Christel',voided_at:'2026-10-06T08:00Z',voided_by:'Jean-Pierre',void_reason:'Duplicate receipt'},
      ]), today:'2026-10-09', closes:[{id:1,business_date:'2026-10-05',revision:1,opening_float:'200',cash_added:'0',cash_removed:'0',expected_cash:'369.50',counted_cash:'365',difference:'-4.50',created_by:'Christel',created_at:'2026-10-05T16:00Z',note:'Drawer short by R4.50; receipts checked.',snapshot:{cashExpenses:125.50}}] },
    },
    selectedStaffId: null,
    permittedStaff: [
      { id: 11, displayName: 'Abigail' },
      { id: 12, displayName: 'Christel' },
      { id: 13, displayName: 'Marietjie' },
    ],
    appointments: {
      operational: 54,
      allRecorded: 58,
      statusCounts: { scheduled: 18, completed: 36, cancelled: 4 },
    },
    totals: { bookedMinutes: 3420, remainingMinutes: 4980, utilisationPct: 41 },
    capacity: [
      { staffId: 11, name: 'Abigail', scheduledMinutes: 3120, bookedMinutes: 1380, blockedMinutes: 180, leaveMinutes: 240, remainingMinutes: 1320, utilisationPct: 51 },
      { staffId: 12, name: 'Christel', scheduledMinutes: 3300, bookedMinutes: 1260, blockedMinutes: 120, leaveMinutes: 0, remainingMinutes: 1920, utilisationPct: 40 },
      { staffId: 13, name: 'Marietjie', scheduledMinutes: 2940, bookedMinutes: 780, blockedMinutes: 120, leaveMinutes: 360, remainingMinutes: 1680, utilisationPct: 32 },
    ],
    services: [
      { name: 'Full Body Swedish', category: 'Massage', appointments: 17 },
      { name: 'Sports Massage Full Body', category: 'Massage', appointments: 14 },
      { name: 'Quick Relief: Back & Neck', category: 'Massage', appointments: 11 },
      { name: 'Medi-Heel Pedicure & Foot Massage', category: 'Feet', appointments: 8 },
    ],
    clients: { uniqueClients: 43, newClients: 12, returningClients: 31 },
    closures: 1,
    trend: { delta: 6, currentOperationalAppointments: 54, previousOperationalAppointments: 48 },
    staffEarnings: {
      earliestNewRuleDate: '2026-09-16',
      staff: [
        { staffId: 11, name: 'Abigail', completedCount: 2, completedValue: 1040, commission: 208, reviewCount: 1, appointments: [
          { id: 732, startsAt: '2026-09-14T08:00:00Z', serviceNames: ['Swedish Massage'], price: 590, ratePercent: 20, commission: 118 },
          { id: 734, startsAt: '2026-09-15T08:00:00Z', serviceNames: ['Couples Massage'], price: 1080, reason: 'Shared appointment — review allocation' },
        ] },
        { staffId: 12, name: 'Christel', completedCount: 1, completedValue: 680, commission: 680, reviewCount: 0, appointments: [
          { id: 735, startsAt: '2026-09-15T10:00:00Z', serviceNames: ['Hot Stone Massage'], price: 680, ratePercent: 100, commission: 680 },
        ] },
      ],
      services: [{ id: 1, name: 'Swedish Massage' }, { id: 2, name: 'Hot Stone Massage' }],
      rules: [{ staff_id: 11, service_id: null, effective_from: '1970-01-01', rate_percent: 20 },
        { staff_id: 12, service_id: null, effective_from: '1970-01-01', rate_percent: 100 }],
    },
  };
}

export default {
  title: 'Workspace/Reports',
  parameters: { layout: 'fullscreen' },
};

export const ClinicOverview = {
  render: () => productionSurface(renderReportsPage(reportModel())),
};

export const BusinessAdminOverview = {
  render: () => productionSurface(renderReportsPage({ ...reportModel(), authority: { displayName: 'Jean-Pierre', reportScope: 'all_business' } })),
};

export const FocusedWorkspaceReports = {
  render: () => productionSurface(renderReportsPage({ ...reportModel(),
    permittedStaff: [{ id: 11, displayName: 'Synthetic practitioner' }],
    capacity: [], staffEarnings: null,
    welcomeVoucherCampaign: { vouchersUnlocked: 10, vouchersRedeemed: 4, discountsGiven: 400 },
  })),
};
