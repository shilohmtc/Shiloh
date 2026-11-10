import presentation from '../src/presentation/clientInsightsUx.js';
import domain from '../src/domain/clientInsights.js';
import openDays from '../src/domain/clientInsightOpenDays.js';
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
function comparison(asOf = '2026-11-08T08:00:00Z') {
  const period = domain.insightComparisonPeriod(asOf);
  return {
    available: true,
    period,
    monthly: period.monthKeys.map((month, index) => ({ month, clients: [1, 2, 2][index] })),
  };
}
function sampleAverages(period, monthly) {
  const windows = domain.insightAverageWindows(period);
  const days = windows
    .filter((w) => w.kind === 'day')
    .map((w) => ({
      date: w.startDate,
      state: new Date(w.startDate + 'T00:00:00Z').getUTCDay() ? 'open' : 'closed',
      source: 'current_schedule',
    }));
  const counts = days.map((day) => ({
    date: day.date,
    clients:
      day.state === 'open' &&
      days.find((d) => d.state === 'open' && d.date.slice(0, 7) === day.date.slice(0, 7))?.date ===
        day.date
        ? monthly.find((m) => m.month === day.date.slice(0, 7))?.clients || 0
        : 0,
  }));
  const values = ['day', 'week', 'month'].map((kind) => ({
    kind,
    periods: windows.filter((w) => w.kind === kind).length,
    // Fictional client identities 1..N recur across months; dedupe in each window.
    clientPeriods: windows
      .filter((w) => w.kind === kind)
      .reduce(
        (sum, w) =>
          sum +
          Math.max(
            0,
            ...counts
              .filter((c) => c.date >= w.startDate && c.date < w.endDate)
              .map((c) => c.clients),
          ),
        0,
      ),
  }));
  const result = domain.projectInsightAverages(values, period, 100);
  result.items[0] = openDays.projectOpenDayAverage(
    counts,
    { available: true, days, asOf: period.asOf },
    period,
    100,
  );
  return result;
}
function model(months = 2) {
  const period = domain.insightPeriod(months, '2026-11-08T08:00:00Z');
  const monthly = period.monthKeys.map((month) => ({
    month,
    visits: month === '2026-10' ? 8 : month === '2026-11' ? 2 : 4,
    clients: month === '2026-10' ? 3 : ['2026-07', '2026-08'].includes(month) ? 1 : 2,
  }));
  return {
    available: true,
    averages: sampleAverages(period, monthly),
    comparison: comparison(),
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
        comparison: {
          ...value.comparison,
          monthly: value.comparison.monthly.map((item) => ({ ...item, clients: 0 })),
        },
        averages: sampleAverages(
          value.period,
          value.monthly.map((item) => ({ ...item, clients: 0 })),
        ),
        totalVisits: 0,
        uniqueClients: 0,
        ranking: [],
        monthly: value.monthly.map((item) => ({ ...item, visits: 0, clients: 0 })),
      }),
    );
  },
};
export const MonthEndClamping = {
  render: () => {
    const value = model();
    return markup(
      presentation.renderClientInsightsPage({
        ...value,
        period: domain.insightPeriod(2, '2026-03-31T08:00:00Z'),
        averages: sampleAverages(domain.insightPeriod(2, '2026-03-31T08:00:00Z'), [
          { month: '2026-02', clients: 3 },
          { month: '2026-03', clients: 2 },
        ]),
        monthly: [
          { month: '2026-02', visits: 8, clients: 3 },
          { month: '2026-03', visits: 2, clients: 2 },
        ],
        ranking: value.ranking.map((client) => ({
          ...client,
          lastVisitAt: '2026-03-25T07:00:00Z',
        })),
        comparison: comparison('2026-03-31T08:00:00Z'),
      }),
    );
  },
};
export const ComparisonUnavailable = {
  render: () =>
    markup(presentation.renderClientInsightsPage({ ...model(), comparison: { available: false } })),
};
export const OpeningDataUnavailable = {
  render: () => {
    const value = model();
    value.averages.items[0] = {
      kind: 'day',
      available: false,
      reason: 'Opening-day data unavailable',
    };
    return markup(presentation.renderClientInsightsPage(value));
  },
};
export const OutsideAssumedSchedule = {
  render: () => {
    const value = model();
    value.averages.items[0] = { ...value.averages.items[0], outsideDates: 1, outsideClientDays: 2 };
    return markup(presentation.renderClientInsightsPage(value));
  },
};
export const SparseIntervals = {
  render: () => {
    const value = model();
    return markup(
      presentation.renderClientInsightsPage({
        ...value,
        ranking: value.ranking.map((client) => ({ ...client, interval: { state: 'sparse' } })),
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

// The shared menu starts hidden until the existing navigation authority resolves.
export const WorkspaceMenu = {
  render: () =>
    markup(
      clients.renderClientManagementPage(
        { formsHref: '/calendar/forms' },
        { displayName: 'Synthetic operator' },
      ),
    ),
};
