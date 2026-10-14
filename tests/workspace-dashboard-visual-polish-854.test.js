'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dateGroupLabel,
  dashboardClientScript,
  dashboardDateLabel,
  renderDashboardPage,
} = require('../src/presentation/workspaceDashboardUx');

function model() {
  return {
    requestedDateKey: '2026-09-11',
    operationalDateKey: '2026-09-11',
    displayName: 'Jean-Pierre',
    mode: 'owner_overview',
    canFinalizeAllBusiness: true,
    calendar: {
      timeline: {
        staff: [{ id: 11, displayName: 'Abigail' }],
        appointments: [],
        closures: [],
      },
    },
    closures: [],
    appointments: [],
    teamGroups: [],
    awaitingFinalization: [],
    bookingRequests: [],
    recentActivity: [],
    communications: null,
    communicationsUnavailable: false,
    carryOver: [
      {
        id: 601,
        startsAt: '2026-09-09T06:00:00.000Z',
        endsAt: '2026-09-09T07:00:00.000Z',
        status: 'confirmed',
        revision: '2026-09-09T05:00:00.000Z',
        clientName: 'Wednesday Client',
        serviceName: 'Lymphatic Drainage',
        staffIds: [11],
        staff: [{ staffId: 11, nameSnapshot: 'Abigail' }],
        operationalDateKey: '2026-09-09',
        canFinalize: true,
      },
      {
        id: 602,
        startsAt: '2026-09-10T08:00:00.000Z',
        endsAt: '2026-09-10T09:00:00.000Z',
        status: 'confirmed',
        revision: '2026-09-10T07:00:00.000Z',
        clientName: 'Thursday Client',
        serviceName: 'Full Body Swedish',
        staffIds: [11],
        staff: [{ staffId: 11, nameSnapshot: 'Abigail' }],
        operationalDateKey: '2026-09-10',
        canFinalize: true,
      },
    ],
  };
}

test('#854 formats backlog date groups for human scanning', () => {
  assert.equal(dateGroupLabel('2026-09-09'), 'Wed, 09 Sept');
  assert.equal(dateGroupLabel('2026-09-10'), 'Thu, 10 Sept');
  assert.equal(dashboardDateLabel('2026-09-11'), 'Friday, 11 September');
});

test('Dashboard removes empty urgency chrome and leads with the operational day', () => {
  const html = renderDashboardPage({
    ...model(),
    carryOver: [],
    awaitingFinalization: [],
    bookingRequests: [],
  });
  const body = html.slice(html.indexOf('</style>'));
  assert.doesNotMatch(body, /data-dashboard-attention-panel/);
  assert.doesNotMatch(body, /No booking request or past visit currently needs staff action/);
  assert.ok(body.indexOf('data-dashboard-today') < body.indexOf('data-dashboard-carryover-panel'));
  assert.match(body, /<h2>Today across the team<\/h2><p class="truth-note">Friday, 11 September<\/p>/);
});

test('#854 retains bounded backlog, compact responsive team cards and stable Phone order without changing finalization controls', () => {
  const html = renderDashboardPage(model());

  assert.match(html, /class="dashboard-grid" data-dashboard-grid/);
  assert.match(html, /class="panel carryover-panel" data-dashboard-carryover-panel/);
  assert.match(html, /data-dashboard-carryover-scroll/);
  assert.match(html, /<h3>Wed, 09 Sept<\/h3>/);
  assert.match(html, /<h3>Thu, 10 Sept<\/h3>/);
  assert.match(html, /class="appointment carryover-card"/);
  assert.match(html, /data-dashboard-finalize="completed"/);
  assert.match(html, /data-dashboard-finalize="no_show"/);
  assert.match(html, /data-operational-date-key="2026-09-09"/);
  assert.match(html, /date=2026-09-09/);

  assert.match(html, /class="dashboard-column" data-dashboard-day-column/);
  assert.match(html, /class="dashboard-column" data-dashboard-action-column/);
  assert.match(html, /\.dashboard-column\{display:grid;gap:12px;min-width:0;align-content:start\}/);
  assert.doesNotMatch(html, /\.carryover-panel\{position:sticky/);
  assert.match(html, /@media\(min-width:1051px\)\{\.workspace-main \.shell\{display:flex;min-height:100vh;flex-direction:column\}/);
  assert.match(html, /\.dashboard-column>\.panel\{align-self:start\}/);
  assert.match(html, /\.team-groups\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html, /@media\(max-width:850px\)[\s\S]*\.dashboard-column\{display:contents\}[\s\S]*\[data-dashboard-attention-panel\]\{grid-column:1;grid-row:1\}[\s\S]*\[data-dashboard-today\]\{grid-column:1;grid-row:2\}/);
  assert.match(html, /@media\(max-width:850px\)[\s\S]*\.dashboard-grid:not\(:has\(\[data-dashboard-attention-panel\]\)\) \[data-dashboard-today\]\{grid-row:1\}/);
  assert.match(html, /\.carryover-group \.appointment-actions \.action-button,\.carryover-group \.appointment-actions \.button\{min-height:44px\}/);
});

test('visit outcomes use an accessible Shiloh confirmation instead of the browser popup', () => {
  const html = renderDashboardPage(model());
  const script = dashboardClientScript();

  assert.match(html, /<dialog class="outcome-dialog" data-dashboard-outcome-dialog/);
  assert.match(html, /aria-labelledby="dashboard-outcome-title"/);
  assert.match(html, /aria-describedby="dashboard-outcome-copy"/);
  assert.match(html, />Not yet<\/button>/);
  assert.match(script, /Mark this visit as completed\?/);
  assert.match(script, /Mark this visit as a no-show\?/);
  assert.match(script, /Mark completed/);
  assert.match(script, /Mark no-show/);
  assert.doesNotMatch(script, /Record this visit as/);
});
