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

test('Needs attention preserves an exceptional visit outside Today with canonical outcome actions when authorized', () => {
  const panel = attentionPanel(renderDashboardPage({ ...model({ canFinalize: true }), appointments: [] }));
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

test('Needs attention remains fail-closed for an exceptional visit outside Today', () => {
  const panel = attentionPanel(renderDashboardPage({ ...model({ canFinalize: false }), appointments: [] }));
  assert.match(panel, /Attention Client/);
  assert.match(panel, /Canonical Practitioner/);
  assert.doesNotMatch(panel, /data-dashboard-attention-finalize=/);
  assert.match(panel, />Review visit</);
});

for (const canFinalize of [true, false]) test(`Today owns its exact visit and outcome controls once; authorized=${canFinalize}`, () => {
  const html = renderDashboardPage(model({ canFinalize }));
  const today = extractHtmlSection(html, 'data-dashboard-today');
  assert.match(today, /Attention Client/);
  assert.match(today, /Treatment · Canonical Practitioner/);
  assert.match(today, /10:30/);
  assert.match(today, /data-dashboard-appointment="901"/);
  assert.match(today, /id="dashboard-appointment-901"/);
  assert.match(today, />Open \/ manage</);
  assert.equal((html.match(/data-dashboard-appointment="901"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-dashboard-attention-appointment="901"/);
  assert.doesNotMatch(html, /<section[^>]*data-dashboard-attention-panel/);
  for (const outcome of ['completed','no_show']) {
    if (canFinalize) assert.match(today, new RegExp(`data-dashboard-finalize="${outcome}"`));
    else assert.doesNotMatch(html, new RegExp(`data-dashboard-finalize="${outcome}"`));
  }
});
