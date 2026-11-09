'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceNavigationService } = require('../src/services/workspaceNavigation');
const { renderWorkspaceNavigation } = require('../src/presentation/workspaceShell');
const {
  renderClientListPage,
  renderClientManagementPage,
} = require('../src/presentation/workspaceClientsUx');
const { renderClientInsightsPage } = require('../src/presentation/clientInsightsUx');
const { insightPeriod } = require('../src/domain/clientInsights');

for (const state of ['clinic', 'scoped', 'denied', 'unavailable', 'tools-only']) {
  test(`Client Insights navigation retains client-record authority: ${state}`, async () => {
    const denied = { resolveAccess: async () => null };
    const clientAccessService = {
      resolveAccess: async () => {
        if (state === 'unavailable') throw new Error('Synthetic unavailable');
        return ['clinic', 'scoped'].includes(state) ? { clientScope: { kind: state } } : null;
      },
    };
    const service = createWorkspaceNavigationService({
      env: {},
      clientAccessService,
      staffAccessService: denied,
      servicesAccessService: denied,
      formsAccessService: state === 'tools-only' ? { resolveAccess: async () => ({}) } : denied,
      reportsAccessService: denied,
      clinicHoursAccessService: denied,
      voucherAccessService: denied,
      rewardsAccessService: denied,
    });
    const destinations = await service.resolve({ session: { adminId: 7, viewer: {} } });
    const allowed = ['clinic', 'scoped'].includes(state);
    assert.deepEqual(destinations.clientInsights, {
      allowed,
      href: allowed ? '/calendar/clients/insights' : null,
    });
    if (state === 'tools-only') assert.equal(destinations.clients.allowed, true);
    assert.equal(destinations.calendar.allowed, true);
  });
}

test('Client Insights is immediately below Directory, never an extra Directory content action', () => {
  const html = renderClientListPage({
    clients: [],
    query: 'Synthetic',
    status: 'active',
    offset: 0,
  });
  const navigation = html.slice(
    html.indexOf('<nav class="workspace-links"'),
    html.indexOf('</nav>'),
  );
  assert.match(
    navigation,
    /data-workspace-destination="clients"[^>]*>Client Directory<\/span><a[^>]*data-workspace-destination="clientInsights"/,
  );
  assert.match(
    navigation,
    /href="\/calendar\/clients\/insights\?returnTo=%2Fcalendar%2Fclients%3Fq%3DSynthetic%26status%3Dactive"/,
  );
  assert.doesNotMatch(
    html.slice(html.indexOf('<div class="workspace-main"')),
    /Client Insights|client-insights-link/,
  );
  const denied = renderClientManagementPage({ formsHref: '/calendar/forms' });
  assert.match(denied, /<span hidden data-workspace-destination="clientInsights"/);
  assert.doesNotMatch(denied, /href="\/calendar\/clients\/insights/);
  assert.match(
    renderWorkspaceNavigation(),
    /<span hidden data-workspace-destination="clientInsights"/,
  );
});

test('Insights highlights its own menu destination and retains the filtered Directory return', () => {
  const html = renderClientInsightsPage({
    available: false,
    period: insightPeriod(2, '2026-11-08T08:00:00Z'),
    directoryHref: '/calendar/clients?q=Synthetic&status=active',
  });
  assert.match(
    html,
    /data-workspace-destination="clientInsights" aria-current="page">Client Insights<\/span>/,
  );
  assert.match(
    html,
    /data-workspace-destination="clients" href="\/calendar\/clients\?q=Synthetic&amp;status=active">Client Directory<\/a>/,
  );
  assert.doesNotMatch(html, /aria-current="page">Client Directory/);
});
