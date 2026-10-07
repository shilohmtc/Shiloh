const test = require('node:test');
const assert = require('node:assert/strict');

const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');

function model({ canFinalize = true } = {}) {
  const visit = {
    id: 901,
    kind: 'appointment',
    canonical: true,
    startsAt: '2026-09-11T08:30:00.000Z',
    endsAt: '2026-09-11T09:30:00.000Z',
    status: 'confirmed',
    revision: '2026-09-11T08:00:00.000Z',
    clientName: 'Attention Client',
    serviceName: 'Treatment',
    staffIds: [11],
    canFinalize,
  };
  return {
    requestedDateKey: '2026-09-11',
    operationalDateKey: '2026-09-11',
    displayName: 'Canonical Practitioner',
    mode: 'my_day',
    canFinalizeAllBusiness: false,
    calendar: {
      dateKey: '2026-09-11',
      timeline: {
        staff: [{ id: 11, displayName: 'Canonical Practitioner' }],
        appointments: [visit],
        closures: [],
      },
    },
    closures: [],
    appointments: [visit],
    awaitingFinalization: [visit],
    recentActivity: [],
    carryOver: [],
    bookingRequests: [],
    communications: { attentionUnavailable: false, attention: [] },
  };
}

function attentionPanel(html) {
  const start = html.indexOf('<section class="panel" data-dashboard-attention-panel>');
  const end = html.indexOf('<section class="panel" data-dashboard-activity-panel>', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return html.slice(start, end);
}

test('Needs attention identifies the exact unresolved visit and exposes canonical outcome actions when authorized', () => {
  const panel = attentionPanel(renderDashboardPage(model({ canFinalize: true })));
  assert.match(panel, /data-dashboard-attention-queue/);
  assert.match(panel, /Attention Client/);
  assert.match(panel, /Treatment · Canonical Practitioner/);
  assert.match(panel, /10:30/);
  assert.match(panel, /data-dashboard-attention-appointment="901"/);
  assert.match(panel, /data-dashboard-attention-finalize="completed"/);
  assert.match(panel, /data-dashboard-attention-finalize="no_show"/);
  assert.match(panel, />Review visit</);
  assert.match(panel, /id="dashboard-attention-appointment-901"/);
});

test('Needs attention remains fail-closed when the visit cannot be finalized by the current operator', () => {
  const panel = attentionPanel(renderDashboardPage(model({ canFinalize: false })));
  assert.match(panel, /Attention Client/);
  assert.match(panel, /Canonical Practitioner/);
  assert.doesNotMatch(panel, /data-dashboard-attention-finalize=/);
  assert.match(panel, />Review visit</);
});
