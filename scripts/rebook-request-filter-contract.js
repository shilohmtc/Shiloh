'use strict';
// This legacy fixture has exactly five undated, staff-response requests.
// Accept only its new filter chrome; preserve every byte of every request card.
// Age, ordering, action, field, identity and script changes still fail comparison.
function stripUndatedRebookFilterChrome(html) {
  const opening = '<div data-request-queue><div class="request-filter-row" data-request-filter-wrap hidden><label>Show requests <select data-request-filter><option value="all">All requests (5)</option><option value="staff">Needs staff response (5)</option><option value="client">Awaiting client (0)</option></select></label></div><p class="request-filter-status" data-request-filter-status role="status" aria-live="polite"></p>';
  const escaped = opening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queue = new RegExp(escaped + '((?:<div data-request-state="staff"><article\\b[\\s\\S]*?<\\/article><\\/div>){5})<\\/div>', 'g');
  return html.replace(queue, (_, cards) => cards.replace(/<div data-request-state="staff">(<article\b[\s\S]*?<\/article>)<\/div>/g, '$1'));
}
module.exports = { stripUndatedRebookFilterChrome };

// This fixture has three selected-day appointments, two unfinished outcomes and
// five requests for another date. Only the misplaced Today request badge moves.
function normalizeRebookTodaySummary(html) {
  const selectedDay = '<div class="day-summary"><span class="summary-pill">3 appointments</span><span class="summary-pill attention">2 awaiting outcome</span>';
  return html.replace(selectedDay + '<span class="summary-pill attention">5 pending requests</span></div>', selectedDay + '</div>');
}
module.exports.normalizeRebookTodaySummary = normalizeRebookTodaySummary;

// The Rebook fixture has no carry-over visits. Only this exact empty panel may
// move, gaining its review anchor/status; no populated cards are normalized.
function normalizeRebookEmptyVisitReview(html) {
  const body = '<header class="panel-head"><div><span class="eyebrow">Carry-over</span><h2>Unfinished visits</h2><p class="truth-note">Past visits stay here until they are recorded as Completed or No-show.</p></div></header>';
  const empty = '<div class="empty">No unfinished past visits are waiting for an outcome.</div></section>';
  const oldPanel = '<section class="panel carryover-panel" data-dashboard-carryover-panel>' + body + empty;
  const newPanel = '<section class="panel carryover-panel" data-dashboard-carryover-panel id="dashboard-unfinished" tabindex="-1">' + body + '<p class="operation-status" data-dashboard-section-status role="status" tabindex="-1"></p>' + empty;
  const link = '<a data-workspace-action="secondary" class="button" data-dashboard-unfinished-link href="#dashboard-unfinished">Review unfinished visits</a>';
  return html.replace(oldPanel, '').replace(newPanel, '').replace(link, '');
}
module.exports.normalizeRebookEmptyVisitReview = normalizeRebookEmptyVisitReview;

// Only the accepted individual request fixture gains a client-bound booking
// destination and return anchor. Group/couples fields and actions remain exact.
function normalizeRebookIndividualRequestLink(html) {
  return html
    .replace('<article class="booking-request" id="planning-request-8201" data-dashboard-planning-request="8201">', '<article class="booking-request" data-dashboard-planning-request="8201">')
    .replace('<a data-workspace-action="primary" class="button" href="/calendar/book?client=8301&amp;returnTo=%2Fcalendar%2Fworkspace%23planning-request-8201&amp;date=2030-11-02">Arrange booking</a>', '<a data-workspace-action="primary" class="button" href="/calendar/read-only?view=week&amp;date=2030-11-02&amp;staff=all">Arrange booking</a>');
}
module.exports.normalizeRebookIndividualRequestLink = normalizeRebookIndividualRequestLink;
