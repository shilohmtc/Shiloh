import clients from '../src/presentation/workspaceClientsUx.js';
import communications from '../src/presentation/workspaceCommunicationEvidenceUx.js';
import visits from '../src/domain/clientRecordedVisits.js';

export default { title: 'Workspace/Recorded client visits', parameters: { layout: 'fullscreen' } };
function markup(html) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const root = window.document.createElement('div');
  for (const style of document.querySelectorAll('style')) root.append(style.cloneNode(true));
  for (const script of document.querySelectorAll('script')) script.remove();
  root.insertAdjacentHTML('beforeend', document.body.innerHTML);
  return root;
}
function summary(overrides = {}) {
  return visits.projectRecordedVisits({ record_count: 5, visit_count: 4, period_start: '2025-11-08', last_visit_at: '2026-10-03T07:00:00Z', missing_treatment_visits: 0, treatment_count: 2, leader_count: 1, leaders: [{ name: 'Back massage', visits: 4 }], visit_dates: ['2026-08-01','2026-08-22','2026-09-12','2026-10-03'], ...overrides }, '2026-11-08T08:00:00Z');
}
function model(visitSummary = summary()) {
  return { client: { id: 1, name: 'Synthetic Client Alpha', status: 'active', profile_status: 'registered' }, visitSummary, appointments: [], authority: { displayName: 'Synthetic operator' }, historyOffset: 0, pageSize: 20, services: 'overview', clientListReturnHref: '/calendar/clients?q=Alpha&status=active' };
}
export const Overview = { render: () => markup(communications.renderClientDetailPageWithCommunications(model())) };
export const Directory = { render: () => markup(clients.renderClientListPage({ clients: [{ ...model().client, visitSummary: summary() }, { id: 2, name: 'Synthetic Guest', status: 'active', visitSummary: summary({ visit_count: 1, visit_dates: ['2026-10-03'], leader_count: 2, leaders: [{ name: 'Facial', visits: 1 }, { name: 'Back massage', visits: 1 }] }) }], status: 'active', query: 'Synthetic', authority: model().authority })) };
export const SparseHistory = { render: () => markup(communications.renderClientDetailPageWithCommunications(model(summary({ visit_count: 1, visit_dates: ['2026-10-03'], missing_treatment_visits: 1, leaders: [{ name: 'Back massage', visits: 1 }] })))) };
export const Unavailable = { render: () => markup(communications.renderClientDetailPageWithCommunications(model({ available: false }))) };
export const VariableHistory = { render: () => markup(communications.renderClientDetailPageWithCommunications(model(summary({ last_visit_at: '2026-07-01T07:00:00Z', visit_dates: ['2026-01-01','2026-01-02','2026-01-03','2026-07-01'] })))) };
