'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
const { desktopDashboardModel } = require('../stories/fixtures/workspaceDesktopLayout');
const { extractHtmlSection } = require('./helpers/extractHtmlSection');
const { planningRequestContact, planningRequestCompletion } = require('../src/presentation/planningRequestCompletionUx');

test('deposits follow Today in the central lane before Recent activity, never inside attention or a scroll box', () => {
  const model = desktopDashboardModel('busy');
  model.depositQueue = { items: [{ accountId: 88, appointmentId: 301, state: 'partial', outstanding: '150', hasLink: true,
    members: [{appointmentId:301,clientName:'Synthetic guest',serviceName:'Synthetic treatment',startsAt:'2026-10-17T08:00:00Z',staffNames:['Synthetic team']}]}] };
  const html = renderDashboardPage(model);
  const deposits = extractHtmlSection(html,'data-dashboard-deposits');
  const attention = extractHtmlSection(html,'data-dashboard-attention-panel');
  assert.match(deposits,/R150,00 deposit outstanding/);
  assert.match(deposits,/Part of the deposit is recorded/);
  assert.match(deposits,/nearest appointment first/);
  assert.match(deposits,/shared payments shown once/);
  assert.match(deposits,/\/calendar\/payments\/appointments\/301/);
  assert.doesNotMatch(attention,/data-dashboard-deposits|data-dashboard-attention-appointment/);
  const dayStart = html.indexOf('class="dashboard-column" data-dashboard-day-column');
  const todayStart = html.indexOf('<section class="panel hero-panel" data-dashboard-today');
  const depositStart = html.indexOf('<section class="panel" data-dashboard-deposits');
  const activityStart = html.indexOf('<section class="panel" data-dashboard-activity-panel');
  const dayEnd = html.indexOf('class="dashboard-column" data-dashboard-action-column');
  assert.ok(dayStart < todayStart && todayStart < depositStart && depositStart < activityStart && activityStart < dayEnd);
  assert.doesNotMatch(deposits,/scroll|max-height|overflow/);
  assert.match(attention,/<span class="summary-pill attention">2<\/span>/);
  assert.match(extractHtmlSection(html,'data-dashboard-today'),/11 awaiting outcome/);
  assert.match(extractHtmlSection(html,'data-dashboard-carryover-panel'),/data-dashboard-appointment="/);
});

test('enquiry emphasis uses existing action palette while retaining the same paths and decision controls', () => {
  const html = renderDashboardPage(desktopDashboardModel('sparse'));
  assert.match(html,/data-workspace-action="primary" class="button"[^>]*>Arrange booking/);
  const item = {id:8,client_id:9,client_name:'Synthetic',client_mobile:'27820000000'};
  assert.match(planningRequestContact(item),/data-workspace-action="secondary"[^>]*href="tel:/);
  assert.match(planningRequestContact(item),/data-workspace-action="secondary"[^>]*href="\/calendar\/clients\/9"/);
  const completion = planningRequestCompletion(item);
  assert.match(completion,/<details data-attended-details><summary data-workspace-action="create" class="button">Already attended/);
  assert.match(completion,/data-workspace-action="danger"[^>]*data-enquiry-action="cancelled">Client cancelled/);
  assert.match(completion,/data-enquiry-action="attended" disabled/);
});
