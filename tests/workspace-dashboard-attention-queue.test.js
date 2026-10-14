const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlSection } = require('./helpers/extractHtmlSection');

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
  return extractHtmlSection(html, 'data-dashboard-attention-panel');
}

test('panel extraction retains nested contents and excludes neighbours in either order', () => {
  const panel = '<section data-dashboard-attention-panel><section data-nested>Exact visit</section><button>Completed</button></section>';
  const activity = '<section data-dashboard-activity-panel>Unrelated action</section>';
  const script = `<script>const example = '${panel}';</script>`;
  assert.equal(attentionPanel(script + activity + panel), panel);
  assert.equal(attentionPanel(panel + activity + script), panel);
  assert.throws(() => attentionPanel(activity));
  assert.throws(() => attentionPanel(panel + panel));
  assert.throws(() => attentionPanel('<section data-dashboard-attention-panel>'));
});

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
