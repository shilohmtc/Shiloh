const test = require('node:test');
const assert = require('node:assert/strict');
const { requestAge, renderRequestQueue } = require('../src/presentation/workspaceRequestQueue');
const now = '2026-11-02T10:00:00Z';
const row = (id, requestedAt, awaitingClient = false) => ({ requestedAt, awaitingClient, html: `<article id="${id}"><a href="/unchanged/${id}">Review</a></article>` });

test('mixed requests sort by received date, retain undated rows and count client waiting separately', () => {
  const input = [row('new', '2026-11-02T09:00:00Z'), row('undated', null), row('old', '2026-10-30T10:00:00Z'), row('client', '2026-11-01T10:00:00Z', true)];
  const before = JSON.stringify(input);
  const html = renderRequestQueue(input, now);
  assert.deepEqual([...html.matchAll(/<article id="([^"]+)"/g)].map(match => match[1]), ['old', 'client', 'new', 'undated']);
  assert.match(html, /All requests \(4\)/);
  assert.match(html, /Needs staff response \(3\)/);
  assert.match(html, /Awaiting client \(1\)/);
  assert.match(html, /data-request-filter-wrap hidden/);
  for (const id of ['new', 'undated', 'old', 'client']) assert.ok(html.includes(`<a href="/unchanged/${id}">Review</a>`));
  assert.equal(JSON.stringify(input), before);
});

test('request age uses the projection clock and clinic timezone without inventing overdue rules', () => {
  assert.match(requestAge('2026-11-01T10:00:00Z', now), /Requested 1 day ago/);
  assert.match(requestAge('2026-11-02T09:00:00Z', now), /Requested 1 hour ago/);
  assert.match(requestAge('2026-11-02T09:30:00Z', now), /less than an hour ago/);
  assert.match(requestAge('2026-11-01T10:00:00Z', now), /12:00 SAST/);
  for (const value of [null, '', 'invalid', '2026-11-03T10:00:00Z']) assert.equal(requestAge(value, now), '');
  assert.equal(requestAge(now, undefined), '');
  assert.doesNotMatch(requestAge('2025-01-01T10:00:00Z', now), /overdue/i);
});

test('empty and single request queues avoid redundant filters and preserve the original card', () => {
  assert.equal(renderRequestQueue([], now), '');
  const one = row('only', null);
  assert.equal(renderRequestQueue([one], now), one.html);
});
