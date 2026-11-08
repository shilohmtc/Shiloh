import presentation from '../src/presentation/clientInsightsUx.js';
import domain from '../src/domain/clientInsights.js';
import clients from '../src/presentation/workspaceClientsUx.js';

export default { title: 'Workspace/Client Insights', parameters: { layout: 'fullscreen' } };
function markup(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html'),
    root = document.createElement('div');
  for (const style of parsed.querySelectorAll('style')) root.append(style.cloneNode(true));
  for (const script of parsed.querySelectorAll('script')) script.remove();
  root.insertAdjacentHTML('beforeend', parsed.body.innerHTML);
  return root;
}
const authority = { displayName: 'Synthetic operator' };
function model(months = 2) {
  const period = domain.insightPeriod(months, '2026-11-08T08:00:00Z');
  const monthly = period.monthKeys.map((month) => ({
    month,
    visits: month === '2026-10' ? 8 : month === '2026-11' ? 2 : 4,
    clients: month === '2026-10' ? 3 : ['2026-07', '2026-08'].includes(month) ? 1 : 2,
  }));
  return {
    available: true,
    period,
    offset: 0,
    pageSize: 20,
    hasMore: false,
    authority,
    directoryHref: '/calendar/clients?q=Synthetic&status=active',
    totalVisits: monthly.reduce((n, m) => n + m.visits, 0),
    uniqueClients: 3,
    monthly,
    ranking: [
      {
        clientId: '1',
        name: 'Synthetic Client Alpha',
        rank: 1,
        visits: months === 5 ? 18 : 6,
        lastVisitAt: '2026-11-05T07:00:00Z',
        interval: { state: 'regular', days: 7 },
        treatment: {
          state: 'recorded',
          leaderCount: 1,
          leaders: [{ name: 'Back massage', visits: months === 5 ? 12 : 4 }],
        },
      },
      {
        clientId: '2',
        name: 'Synthetic Client Beta',
        rank: 2,
        visits: 2,
        lastVisitAt: '2026-10-22T07:00:00Z',
        interval: { state: 'sparse' },
        treatment: {
          state: 'recorded',
          leaderCount: 2,
          leaders: [
            { name: 'Facial', visits: 1 },
            { name: 'Foot massage', visits: 1 },
          ],
        },
      },
      {
        clientId: '3',
        name: 'Synthetic Guest',
        status: 'archived',
        rank: 2,
        visits: 2,
        lastVisitAt: '2026-11-01T07:00:00Z',
        interval: { state: 'sparse' },
        treatment: { state: 'incomplete', missingVisits: 1 },
      },
    ],
  };
}
export const TwoMonths = { render: () => markup(presentation.renderClientInsightsPage(model())) };
export const FiveMonths = { render: () => markup(presentation.renderClientInsightsPage(model(5))) };
export const Empty = {
  render: () => {
    const value = model();
    return markup(
      presentation.renderClientInsightsPage({
        ...value,
        totalVisits: 0,
        uniqueClients: 0,
        ranking: [],
        monthly: value.monthly.map((item) => ({ ...item, visits: 0, clients: 0 })),
      }),
    );
  },
};
export const Unavailable = {
  render: () => markup(presentation.renderClientInsightsPage({ ...model(), available: false })),
};
export const CompactDirectory = {
  render: () =>
    markup(
      clients.renderClientListPage({
        authority,
        status: 'active',
        clients: [
          {
            id: 1,
            name: 'Synthetic Client Alpha',
            status: 'active',
            last_visit_at: '2026-10-22T07:00:00Z',
            next_appointment_at: '2026-11-12T07:00:00Z',
          },
          { id: 2, name: 'Synthetic Guest', status: 'active' },
        ],
      }),
    ),
};
