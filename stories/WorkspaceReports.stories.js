import reportsPresentation from '../src/presentation/workspaceReportsUx.js';

const { renderReportsPage } = reportsPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(match => match[1])
    .join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.workspace-report-story{min-height:100vh}.workspace-report-story script{display:none}</style><div class="workspace-report-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

function reportModel() {
  return {
    authority: { displayName: 'Christel', reportScope: 'all_business' },
    period: {
      preset: '30d',
      startKey: '2026-08-17',
      endInclusiveKey: '2026-09-15',
      dayCount: 30,
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
