const test = require('node:test');
const assert = require('node:assert/strict');
const { renderRequestQueue } = require('../src/presentation/workspaceRequestQueue');
const { stripUndatedRebookFilterChrome: strip } = require('../scripts/rebook-request-filter-contract');
const cards = Array.from({ length: 5 }, (_, i) => ({ html: `<article id="request-${i}"><a href="/review/${i}">Review</a><input name="date" value="2030-11-02"><button data-decision="accept">Accept</button></article>` }));
const original = cards.map(row => row.html).join('');
const queue = renderRequestQueue(cards, '2030-11-02T10:00:00Z');

test('legacy Rebook proof accepts only the exact five undated staff-request wrappers', () => {
  assert.equal(strip(queue), original);
  assert.equal(strip(original), original);
  for (const changed of [queue.replace('All requests (5)', 'All requests (4)'), queue.replace('data-request-state="staff"', 'data-request-state="client"'), queue.replace('role="status"', 'role="alert"')]) {
    assert.notEqual(strip(changed), original);
  }
});

test('Rebook proof still rejects changed actions, identity, fields, copy, timestamps and scripts', () => {
  for (const [from, to] of [['/review/0', '/review/99'], ['request-0', 'request-99'], ['2030-11-02', '2030-11-03'], ['data-decision="accept"', 'data-decision="cancel"'], ['>Accept<', '>Decline<'], ['<article id="request-0">', '<article id="request-0"><p class="request-age">Requested 1 day ago</p>']]) {
    assert.notEqual(strip(queue.replace(from, to)), original);
  }
  assert.notEqual(strip(queue + '<script>changedAction()</script>'), original);
  const reordered = renderRequestQueue([...cards].reverse(), '2030-11-02T10:00:00Z');
  assert.notEqual(strip(reordered), original);
});

const { normalizeRebookTodaySummary: normalizeToday } = require('../scripts/rebook-request-filter-contract');
test('Rebook proof allows only the exact approved future-request badge removal from Today', () => {
  const day = '<div class="day-summary"><span class="summary-pill">3 appointments</span><span class="summary-pill attention">2 awaiting outcome</span>';
  const before = day + '<span class="summary-pill attention">5 pending requests</span></div>' + original;
  const after = day + '</div>' + original;
  assert.equal(normalizeToday(before), after);
  assert.equal(normalizeToday(after), after);
  for (const [from,to] of [['3 appointments','4 appointments'],['2 awaiting outcome','1 awaiting outcome'],['5 pending requests','4 pending requests'],['/review/0','/review/99'],['2030-11-02','2030-11-03'],['data-decision="accept"','data-decision="cancel"']]) {
    assert.notEqual(normalizeToday(before.replace(from,to)), after);
  }
  assert.notEqual(normalizeToday(before+'<script>changed()</script>'),after);
});

const { normalizeRebookEmptyVisitReview: normalizeReview } = require('../scripts/rebook-request-filter-contract');
const { rebookHtml } = require('../stories/fixtures/rebookActionPresentation');
test('Rebook proof accepts exact empty-review relocation without masking booking mutations', () => {
  const after = rebookHtml();
  const panel = after.match(/<section class="panel carryover-panel"[\s\S]*?<\/section>/)[0];
  const link = after.match(/<a [^>]*data-dashboard-unfinished-link[^>]*>[\s\S]*?<\/a>/)[0];
  const oldPanel = panel.replace(' id="dashboard-unfinished" tabindex="-1"', '').replace('<p class="operation-status" data-dashboard-section-status role="status" tabindex="-1"></p>', '');
  const before = after.replace(panel, '').replace(link, '').replace('<dialog class="outcome-dialog"', oldPanel + '<dialog class="outcome-dialog"');
  assert.equal(normalizeReview(after), normalizeReview(before));
  for (const [from,to] of [
    ['appointment=8101','appointment=9999'],
    ['2030-11-02','2030-11-03'],
    ['Synthetic existing organiser','Different client'],
    ['value="41"','value="99"'],
    ['>Manage booking</a>','>Cancel booking</a>'],
    ['role="status" tabindex="-1"','role="alert" tabindex="-1"'],
    ['href="#dashboard-unfinished"','href="/different"'],
    ['No unfinished past visits are waiting for an outcome.','A visit is waiting for an outcome.'],
  ]) {
    assert.ok(after.includes(from), from);
    assert.notEqual(normalizeReview(after.replace(from,to)), normalizeReview(before), from);
  }
  assert.notEqual(normalizeReview(after + '<script>changedBooking()</script>'), normalizeReview(before));
});

const { normalizeRebookIndividualRequestLink: normalizeRequest } = require('../scripts/rebook-request-filter-contract');
test('Rebook evidence allows only the exact approved individual client/date/return link', () => {
  const after = rebookHtml();
  const before = after.replace(' id="planning-request-8201"', '').replace('/calendar/book?client=8301&amp;returnTo=%2Fcalendar%2Fworkspace%23planning-request-8201&amp;date=2030-11-02', '/calendar/read-only?view=week&amp;date=2030-11-02&amp;staff=all');
  assert.notEqual(after, before);
  assert.equal(normalizeRequest(after), before);
  for (const [from, to] of [['client=8301', 'client=9999'], ['%23planning-request-8201', '%23planning-request-9999'], ['date=2030-11-02', 'date=2030-11-03'], ['id="planning-request-8201"', 'id="planning-request-9999"'], ['value="41"', 'value="42"'], ['appointment=8101', 'appointment=9999'], ['>Arrange booking</a>', '>Confirm booking</a>']]) {
    assert.ok(after.includes(from), from);
    assert.notEqual(normalizeRequest(after.replace(from, to)), before, from);
  }
  assert.notEqual(normalizeRequest(after + '<script>changed()</script>'), before);
});
