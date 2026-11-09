'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clientRecordedVisitsFixture } = require('./helpers/clientRecordedVisitsFixture');
const { createClientInsightsService } = require('../src/services/clientInsights');
const { insightPeriod } = require('../src/domain/clientInsights');
const {
  insightsHref,
  clientInsightsReturnHref,
} = require('../src/presentation/clientInsightsContext');
const asOf = '2026-11-08T08:00:00Z';
const fixture = () =>
  clientRecordedVisitsFixture({ nativeUrl: process.env.TEST_RECORDED_VISITS_DATABASE_URL || null });
const service = (f) =>
  createClientInsightsService({ db: f.db, accessService: f.service, now: () => new Date(asOf) });

test('Insights calendar periods have explicit SAST boundaries and reject unapproved ranges', () => {
  const two = insightPeriod(2, asOf),
    five = insightPeriod(5, asOf);
  assert.deepEqual(two.monthKeys, ['2026-10', '2026-11']);
  assert.equal(two.startDate, '2026-10-01');
  assert.equal(two.endDate, '2026-11-08');
  assert.deepEqual(five.monthKeys, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(insightPeriod(2, '2026-01-01T00:00:00Z').monthKeys, ['2025-12', '2026-01']);
  assert.equal(insightPeriod(2, '2026-10-31T22:01:00Z').endDate, '2026-11-01');
  assert.throws(
    () => insightPeriod(3, asOf),
    (error) => error.httpStatus === 400,
  );
  assert.throws(
    () => insightPeriod(2, 'invalid'),
    (error) => error.httpStatus === 400,
  );
});

test('actual SQL counts scoped ended client visits, linked treatments once, and guests separately', async (t) => {
  const f = await fixture();
  t.after(f.close);
  for (const [id, date] of [
    [1, '2026-10-01'],
    [2, '2026-10-08'],
    [3, '2026-10-15'],
    [4, '2026-10-22'],
    [7, '2026-11-05'],
  ])
    await f.add({ id, date, group: id === 4 ? 20 : null });
  await f.add({ id: 5, date: '2026-10-22', time: '11:00', group: 20 });
  await f.add({ id: 6, client: 2, date: '2026-10-22', group: 20, status: 'no_charge' });
  await f.add({ id: 8, client: 2, date: '2026-08-01' });
  for (const [id, status] of [
    [9, 'cancelled'],
    [10, 'no_show'],
    [11, 'scheduled'],
    [12, 'confirmed'],
    [13, 'unknown'],
  ])
    await f.add({ id, status, date: '2026-11-06' });
  await f.add({ id: 14, date: '2027-01-01' });
  await f.add({ id: 15, legacy: 99 });
  await f.add({ id: 16, client: 3, services: [{ id: 90, name: 'Private treatment' }] });
  await f.add({ id: 17, services: [{ id: 90, name: 'Private treatment' }] });
  await f.add({ id: 18, date: '2026-11-08', time: '09:30' }); // ends after as-of
  const before = f.calls.length;
  const model = await service(f).getModel({ adminId: 41 });
  assert.equal(model.available, true);
  assert.equal(model.totalVisits, 6);
  assert.equal(model.uniqueClients, 2);
  assert.deepEqual(model.monthly, [
    { month: '2026-10', visits: 5, clients: 2 },
    { month: '2026-11', visits: 1, clients: 1 },
  ]);
  assert.deepEqual(
    model.ranking.map((c) => [c.clientId, c.visits, c.rank]),
    [
      ['1', 5, 1],
      ['2', 1, 2],
    ],
  );
  assert.equal(model.ranking[0].interval.state, 'regular');
  assert.equal(model.ranking[0].interval.days, 7);
  assert.equal(model.ranking[1].interval.state, 'sparse');
  assert.doesNotMatch(JSON.stringify(model), /Private treatment/);
  const query = f.calls.slice(before).find((c) => c.text.includes('clientInsights:scoped-period'));
  assert.ok(query);
  assert.equal(
    f.calls.slice(before).filter((c) => c.text.includes('clientInsights:scoped-period')).length,
    1,
  );
  assert.equal(f.calls.at(-1).text, 'ROLLBACK');
  const five = await service(f).getModel({ adminId: 41, months: 5 });
  assert.equal(five.totalVisits, 7);
  assert.equal(five.ranking[1].visits, 2);
  await f.db.query(
    "UPDATE staff_admin_accounts SET business_role='tenant_practitioner' WHERE id=41",
  );
  const tenant = await service(f).getModel({ adminId: 41 });
  assert.equal(tenant.totalVisits, 2);
  assert.equal(tenant.uniqueClients, 2);
  assert.deepEqual(tenant.ranking.map((c) => c.clientId).sort(), ['1', '3']);
});

test('ranking includes the full authorized period beyond a Directory page, with stable ties and pagination', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.db.query(
    "INSERT INTO crm_v2_clients(id,name,status) SELECT n,'Synthetic '||n,'active' FROM generate_series(10,34) n",
  );
  await f.db.query(
    "INSERT INTO crm_v2_client_relationships SELECT n,'clinic',NULL,'active' FROM generate_series(10,34) n",
  );
  await f.db.query(
    "INSERT INTO appointments SELECT n,NULL,n,'2026-10-01'::timestamptz,'2026-10-01 01:00'::timestamptz,'completed','Synthetic' FROM generate_series(10,34) n",
  );
  await f.add({ id: 1 });
  await f.add({ id: 2, date: '2026-10-08' });
  const first = await service(f).getModel({ adminId: 41 }),
    second = await service(f).getModel({ adminId: 41, offset: 20 });
  assert.equal(first.totalVisits, 27);
  assert.equal(first.uniqueClients, 26);
  assert.equal(first.ranking.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.ranking[0].clientId, '1');
  assert.equal(second.ranking.length, 6);
  assert.equal(second.hasMore, false);
  const all = [...first.ranking, ...second.ranking];
  assert.equal(new Set(all.map((c) => c.clientId)).size, 26);
  assert.ok(all.some((c) => c.clientId === '34'));
  assert.ok(all.slice(1).every((c) => c.rank === 2));
});

test('split-day linked visits fail closed without conflating different guests or hidden members', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.add({ id: 1, date: '2026-10-01', group: 20 });
  await f.add({ id: 2, client: 2, date: '2026-10-02', group: 20 });
  assert.equal((await service(f).getModel({ adminId: 41 })).totalVisits, 2);
  await f.add({
    id: 3,
    date: '2026-07-01',
    group: 20,
    services: [{ id: 90, name: 'Private older visit' }],
  });
  assert.equal((await service(f).getModel({ adminId: 41 })).available, true);
  await f.add({ id: 4, date: '2026-09-30', group: 20 });
  assert.equal((await service(f).getModel({ adminId: 41 })).available, false);
});

test('authorization, cap and query failures cannot produce invented zero totals or partial rankings', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const empty = await service(f).getModel({ adminId: 41 });
  assert.equal(empty.available, true);
  assert.equal(empty.totalVisits, 0);
  assert.equal(empty.ranking.length, 0);
  const before = f.calls.length;
  await assert.rejects(service(f).getModel({ adminId: 999 }), (error) => error.httpStatus === 403);
  assert.equal(
    f.calls.slice(before).filter((c) => c.text.includes('clientInsights:scoped-period')).length,
    0,
  );
  await f.db.query(
    "INSERT INTO appointments SELECT n,NULL,1,'2026-10-01'::timestamptz,'2026-10-01 01:00'::timestamptz,'completed','Synthetic' FROM generate_series(1,10001) n",
  );
  const cap = await service(f).getModel({ adminId: 41 });
  assert.equal(cap.available, false);
  assert.equal(cap.monthly, undefined);
  assert.equal(cap.totalVisits, undefined);
  const broken = createClientInsightsService({
    db: {
      connect: async () => {
        throw Error('Synthetic unavailable');
      },
    },
    accessService: f.service,
    now: () => new Date(asOf),
  });
  assert.equal((await broken.getModel({ adminId: 41 })).available, false);
});

test('Insights return paths preserve periods, pages and Directory filters without accepting external URLs', () => {
  const href = insightsHref({
    months: 5,
    offset: 20,
    returnTo: '/calendar/clients?q=Alpha&status=active',
  });
  assert.equal(clientInsightsReturnHref(href), href);
  for (const value of [
    'https://evil.invalid/calendar/clients/insights?months=5',
    '//evil.invalid/calendar/clients/insights?months=5',
    '/calendar/clients/insights?months=5#external',
    'javascript:alert(1)',
  ])
    assert.equal(clientInsightsReturnHref(value), null);
  const safe = clientInsightsReturnHref(
    '/calendar/clients/insights?months=5&returnTo=https://evil.invalid',
  );
  assert.equal(safe, '/calendar/clients/insights?months=5');
});

test(
  'PostgreSQL Insights scans a representative full cohort once and returns only one ranked page',
  { skip: !process.env.TEST_RECORDED_VISITS_DATABASE_URL },
  async (t) => {
    const f = await fixture();
    t.after(f.close);
    await f.db.query(
      "INSERT INTO crm_v2_clients(id,name,status) SELECT n,'Synthetic cohort '||n,'active' FROM generate_series(10,109) n",
    );
    await f.db.query(
      "INSERT INTO crm_v2_client_relationships SELECT n,'clinic',NULL,'active' FROM generate_series(10,109) n",
    );
    await f.db.query(
      "INSERT INTO appointments SELECT n,NULL,10+(n%100),'2026-10-01'::timestamptz+(n%38)*INTERVAL '1 day','2026-10-01 01:00'::timestamptz+(n%38)*INTERVAL '1 day','completed','Synthetic' FROM generate_series(1,5000) n",
    );
    await f.db.query(
      "INSERT INTO appointment_services SELECT id,10,1,'Back massage' FROM appointments",
    );
    const before = f.calls.length,
      begun = Date.now(),
      model = await service(f).getModel({ adminId: 41, months: 5 });
    assert.equal(model.available, true);
    assert.equal(model.totalVisits, 5000);
    assert.equal(model.uniqueClients, 100);
    assert.equal(model.ranking.length, 20);
    assert.equal(model.hasMore, true);
    assert.equal(model.comparison.available, true);
    assert.deepEqual(
      model.comparison.monthly.map((m) => m.clients),
      [0, 100, 100],
    );
    assert.deepEqual(model.ranking[0].treatment, {
      state: 'recorded',
      leaderCount: 1,
      leaders: [{ name: 'Back massage', visits: 50 }],
    });
    assert.equal(
      f.calls.slice(before).filter((c) => c.text.includes('clientInsights:scoped-period')).length,
      1,
    );
    assert.equal(f.calls.at(-1).text, 'ROLLBACK');
    t.diagnostic(
      JSON.stringify({
        clients: 100,
        appointments: 5000,
        returnedClients: 20,
        elapsedMs: Date.now() - begun,
        statementTimeoutMs: 2000,
      }),
    );
  },
);

test('Insights route retains session, lookup authority, private headers and safe invalid-period guidance', async (t) => {
  const express = require('express'),
    { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');
  const f = await fixture();
  t.after(f.close);
  let signedIn = true,
    actor = 41;
  const app = express();
  app.use(
    '/calendar/clients',
    createWorkspaceClientsRouter({
      env: {
        SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
        SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
      },
      service: f.service,
      insightsService: service(f),
      sessionService: {
        validateSessionToken: async () => (signedIn ? { ok: true, adminId: actor } : { ok: false }),
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/calendar/clients/insights`;
  let response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(await response.text(), /No completed or no-charge visits/);
  response = await fetch(base + '?months=3');
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Choose the 2- or 5-month view/);
  actor = 999;
  response = await fetch(base);
  assert.equal(response.status, 403);
  assert.doesNotMatch(
    await response.text(),
    /Recorded client visits|Total visits|Individual clients/,
  );
  signedIn = false;
  response = await fetch(base, { redirect: 'manual' });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /Synthetic Alpha/);
});

test('selected-period treatment frequencies deduplicate linked treatments, preserve guests and ties, and hide private detail', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.add({ id: 1, date: '2026-10-01', group: 20 });
  await f.add({
    id: 2,
    date: '2026-10-01',
    time: '11:00',
    group: 20,
    services: [
      { id: 10, name: 'Back massage' },
      { id: 90, name: 'Private treatment' },
    ],
  });
  await f.add({ id: 3, date: '2026-10-08' });
  await f.add({ id: 4, date: '2026-10-15', services: [{ id: 11, name: 'Facial' }] });
  await f.add({ id: 5, date: '2026-09-01', services: [{ id: 11, name: 'Facial' }] });
  await f.add({ id: 6, date: '2026-08-01', services: [{ id: 11, name: 'Facial' }] });
  await f.add({
    id: 7,
    client: 2,
    date: '2026-10-01',
    group: 20,
    status: 'no_charge',
    services: [
      { id: 11, name: 'Facial' },
      { id: 12, name: 'Hand massage' },
      { id: 13, name: 'Foot massage' },
      { id: 14, name: 'Scalp massage' },
    ],
  });
  const two = await service(f).getModel({ adminId: 41 });
  assert.equal(two.ranking[0].visits, 3);
  assert.deepEqual(two.ranking[0].treatment, {
    state: 'recorded',
    leaderCount: 1,
    leaders: [{ name: 'Back massage', visits: 2 }],
  });
  assert.equal(two.ranking[1].treatment.leaderCount, 4);
  assert.equal(two.ranking[1].treatment.leaders.length, 3);
  assert.ok(two.ranking[1].treatment.leaders.every((l) => l.visits === 1));
  assert.doesNotMatch(JSON.stringify(two), /Private treatment/);
  const five = await service(f).getModel({ adminId: 41, months: 5 });
  assert.deepEqual(five.ranking[0].treatment, {
    state: 'recorded',
    leaderCount: 1,
    leaders: [{ name: 'Facial', visits: 3 }],
  });
  await f.add({ id: 8, date: '2026-10-22', services: [{ id: 11, name: 'Facial' }] });
  const tied = await service(f).getModel({ adminId: 41 });
  assert.deepEqual(tied.ranking[0].treatment, {
    state: 'recorded',
    leaderCount: 2,
    leaders: [
      { name: 'Back massage', visits: 2 },
      { name: 'Facial', visits: 2 },
    ],
  });
  await f.db.query(
    "UPDATE staff_admin_accounts SET business_role='tenant_practitioner' WHERE id=41",
  );
  const tenant = await service(f).getModel({ adminId: 41 });
  assert.deepEqual(tenant.ranking[0].treatment, {
    state: 'recorded',
    leaderCount: 1,
    leaders: [{ name: 'Private treatment', visits: 1 }],
  });
  assert.doesNotMatch(JSON.stringify(tenant.ranking[0].treatment), /Back massage|Facial/);
});

test('incomplete treatment snapshots or missing service identities prevent a definitive leader', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.add({ id: 1 });
  await f.add({
    id: 2,
    date: '2026-10-08',
    services: [
      { id: 10, name: 'Back massage' },
      { id: 11, name: '   ' },
    ],
  });
  await f.add({ id: 3, date: '2026-10-15', services: [] });
  await f.add({ id: 4, date: '2026-10-22', services: [{ id: null, name: 'Unlinked treatment' }] });
  const model = await service(f).getModel({ adminId: 41 });
  assert.deepEqual(model.ranking[0].treatment, { state: 'incomplete', missingVisits: 3 });
  assert.doesNotMatch(
    JSON.stringify(model.ranking[0].treatment),
    /Back massage|Unlinked treatment/,
  );
});

test('treatment projection rejects invalid summaries and rendering escapes treatment names', () => {
  const { projectInsightTreatment } = require('../src/domain/clientInsights');
  const { renderClientInsightsPage } = require('../src/presentation/clientInsightsUx');
  for (const value of [
    null,
    { missingVisits: -1 },
    { missingVisits: 3 },
    { missingVisits: 0, leaderCount: 2, leaders: [{ name: 'Back', visits: 1 }] },
    { missingVisits: 0, leaderCount: 1, leaders: [{ name: 'Back', visits: 3 }] },
  ])
    assert.equal(projectInsightTreatment(value, 2).state, 'unavailable');
  const period = insightPeriod(2, asOf);
  const html = renderClientInsightsPage({
    available: true,
    period,
    offset: 0,
    pageSize: 20,
    hasMore: false,
    totalVisits: 2,
    uniqueClients: 1,
    monthly: period.monthKeys.map((month) => ({ month, visits: 1, clients: 1 })),
    ranking: [
      {
        clientId: '1',
        name: 'Synthetic',
        rank: 1,
        visits: 2,
        lastVisitAt: asOf,
        interval: { state: 'sparse' },
        treatment: projectInsightTreatment(
          {
            missingVisits: 0,
            leaderCount: 1,
            leaders: [{ name: '<img src=x onerror=alert(1)>', visits: 2 }],
          },
          2,
        ),
      },
    ],
  });
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Most-received treatment/);
  assert.match(html, /not personal preference/);
});

test('Insights presentation keeps four informational bubbles, concise context and one shared comparison cutoff', () => {
  const { insightComparisonPeriod } = require('../src/domain/clientInsights');
  const { renderClientInsightsPage } = require('../src/presentation/clientInsightsUx');
  const treatments = [
    {
      state: 'recorded',
      leaderCount: 1,
      leaders: [{ name: 'Back massage', visits: 2 }],
    },
    {
      state: 'recorded',
      leaderCount: 2,
      leaders: [
        { name: 'Facial', visits: 1 },
        { name: 'Foot massage', visits: 1 },
      ],
    },
    { state: 'incomplete', missingVisits: 1 },
    { state: 'unavailable' },
  ];
  for (const date of [asOf, '2026-03-31T08:00:00Z']) {
    const period = insightPeriod(2, date),
      comparisonPeriod = insightComparisonPeriod(date);
    const html = renderClientInsightsPage({
      available: true,
      period,
      offset: 0,
      pageSize: 20,
      hasMore: false,
      totalVisits: 8,
      uniqueClients: 4,
      monthly: period.monthKeys.map((month) => ({ month, visits: 4, clients: 4 })),
      comparison: {
        available: true,
        period: comparisonPeriod,
        monthly: comparisonPeriod.monthKeys.map((month) => ({ month, clients: 4 })),
      },
      ranking: treatments.map((treatment, index) => ({
        clientId: String(index + 1),
        name: `Synthetic client ${index + 1}`,
        visits: 2,
        lastVisitAt: date,
        interval: { state: 'sparse' },
        treatment,
      })),
    });
    assert.doesNotMatch(html, /\bSAST\b/);
    assert.match(html, /<h2 id="insight-ranking-title">Most frequent clients<\/h2>/);
    assert.match(
      html,
      /Most visits first, then alphabetical\. Details are for the selected period\./,
    );
    assert.match(html, /<span>Includes this month so far<\/span>/);
    assert.match(html, /<p class="insight-caption">The current month is incomplete\.<\/p>/);
    assert.match(
      html,
      /<p class="insight-note">Based on completed and no-charge visits recorded in Shiloh, within your access\. Older or unlinked history may be incomplete\. Treatment reflects recorded visits, not personal preference\.<\/p>/,
    );
    const comparison = html.match(
      /<section class="insight-panel" aria-labelledby="insight-comparison-title">(.*?)<\/section>/,
    )[1];
    const cutoff = comparisonPeriod.clamped
      ? 'Compared through the end of each date range.'
      : 'Compared up to 10:00 each month.';
    assert.ok(
      comparison.includes(`Same dates each month. ${cutoff} Each client counts once per month.`),
    );
    assert.equal(comparison.split(cutoff).length - 1, 1);
    assert.match(
      comparison,
      /<\/ul><p class="insight-caption">Three-month comparison, regardless of the selected view\.<\/p>/,
    );
    const ranges = [...comparison.matchAll(/<li>.*?<small>(.*?)<\/small><\/li>/g)].map(
      (match) => match[1],
    );
    // Node and Chromium ICU releases may abbreviate September as Sep or Sept.
    assert.deepEqual(
      ranges.map((range) => range.replaceAll('Sept ', 'Sep ')),
      comparisonPeriod.clamped
        ? ['01 Jan 2026 – 28 Jan 2026', '01 Feb 2026 – 28 Feb 2026', '01 Mar 2026 – 28 Mar 2026']
        : ['01 Sep 2026 – 08 Sep 2026', '01 Oct 2026 – 08 Oct 2026', '01 Nov 2026 – 08 Nov 2026'],
    );
    if (comparisonPeriod.clamped) {
      assert.match(comparison, /All three months end on day 28 because one month is shorter\./);
      assert.doesNotMatch(comparison, /Compared up to|\d{2}:\d{2}|end of day/);
    } else {
      assert.equal((comparison.match(/10:00/g) || []).length, 1);
      assert.doesNotMatch(comparison, /All three months end|end of each date range/);
    }
    const rows = [...html.matchAll(/<li class="insight-client">(.*?)<\/li>/g)];
    assert.equal(rows.length, 4);
    for (const [, row] of rows) {
      const details = row.match(/<dl>(.*?)<\/dl>/)[1];
      assert.equal(
        (details.match(/class="insight-bubble(?: insight-treatment)?"/g) || []).length,
        4,
      );
      assert.match(
        details,
        /<div class="insight-bubble insight-treatment"><dt>Most-received treatment<\/dt>/,
      );
      assert.doesNotMatch(details, /<(?:a|button|input)\b|\b(?:tabindex|onclick|role)=/);
    }
    assert.match(rows[0][1], /Back massage · 2 visits/);
    assert.match(rows[1][1], /2 treatments tied/);
    assert.match(rows[1][1], /<small>Facial · Foot massage<\/small>/);
    assert.match(
      rows[2][1],
      /Treatment details incomplete<small>1 visit has incomplete details<\/small>/,
    );
    assert.match(rows[3][1], /Treatment details unavailable/);
  }
});

test('same-date comparison windows keep SAST day and time aligned through month ends and leap years', () => {
  const { insightComparisonPeriod } = require('../src/domain/clientInsights');
  const current = insightComparisonPeriod('2026-11-08T08:17:49.500Z');
  assert.equal(current.timeLabel, '10:17');
  assert.equal(current.day, 8);
  assert.equal(current.clamped, false);
  assert.deepEqual(current.windows, [
    {
      month: '2026-09',
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      endAt: '2026-09-08T08:17:00.000Z',
    },
    {
      month: '2026-10',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
      endAt: '2026-10-08T08:17:00.000Z',
    },
    {
      month: '2026-11',
      startDate: '2026-11-01',
      endDate: '2026-11-08',
      endAt: '2026-11-08T08:17:00.000Z',
    },
  ]);
  const short = insightComparisonPeriod('2027-03-31T12:00:00Z');
  assert.equal(short.currentDay, 31);
  assert.equal(short.day, 28);
  assert.equal(short.clamped, true);
  assert.equal(short.timeLabel, 'end of day');
  assert.equal(short.windows[1].endAt, '2027-02-28T22:00:00.000Z');
  assert.deepEqual(insightComparisonPeriod('2027-03-29T01:00:00Z').windows, short.windows);
  assert.ok(short.windows.every((window) => window.endDate.endsWith('-28')));
  assert.equal(insightComparisonPeriod('2028-03-31T12:00:00Z').day, 29);
  const boundary = insightComparisonPeriod('2026-12-31T22:00:00Z');
  assert.deepEqual(boundary.monthKeys, ['2026-11', '2026-12', '2027-01']);
  assert.equal(boundary.day, 1);
  assert.equal(boundary.timeLabel, '00:00');
  assert.equal(boundary.windows[2].endAt, '2026-12-31T22:00:00.000Z');
  assert.throws(() => insightComparisonPeriod('invalid'));
});

test('same-date trend counts each canonical client once per month, preserving repeated visits and identity boundaries', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.db.query(
    "UPDATE crm_v2_clients SET name='Same synthetic name',normalized_mobile='+27820000000' WHERE id IN (1,2)",
  );
  await f.add({ id: 1, date: '2026-09-01' });
  await f.add({ id: 2, date: '2026-09-08', time: '08:30', group: 20 });
  await f.add({ id: 3, date: '2026-09-08', time: '08:45', group: 20 });
  await f.add({
    id: 4,
    client: 2,
    date: '2026-09-08',
    time: '09:00',
    status: 'no_charge',
    group: 20,
  });
  await f.add({ id: 5, date: '2026-10-01' });
  await f.add({ id: 6, date: '2026-11-08', time: '09:00' }); // ends exactly at 10:00 SAST cutoff
  await f.add({ id: 7, client: 2, date: '2026-10-08', time: '09:01' }); // one minute after cutoff
  await f.add({ id: 8, client: 2, date: '2026-10-09' }); // outside matched dates, still in full-month total
  await f.add({ id: 9, date: '2026-11-08', time: '09:01' }); // not yet ended
  await f.add({ id: 10, date: '2026-09-01', status: 'cancelled' });
  await f.add({ id: 11, client: 3, date: '2026-09-01' }); // outside clinic scope
  await f.add({ id: 12, date: '2026-09-01', legacy: 99 });
  await f.add({ id: 13, date: '2026-09-01', services: [{ id: 90, name: 'Private treatment' }] });
  const before = f.calls.length;
  const model = await service(f).getModel({ adminId: 41 });
  assert.equal(model.available, true);
  assert.equal(model.comparison.available, true);
  assert.deepEqual(model.comparison.monthly, [
    { month: '2026-09', clients: 2 },
    { month: '2026-10', clients: 1 },
    { month: '2026-11', clients: 1 },
  ]);
  assert.equal(model.totalVisits, 4);
  assert.equal(model.monthly[0].visits, 3);
  assert.deepEqual(
    (await service(f).getModel({ adminId: 41, months: 5, offset: 20 })).comparison,
    model.comparison,
  );
  assert.equal(
    f.calls.slice(before).filter((c) => c.text.includes('clientInsights:same-date-comparison'))
      .length,
    2,
  );
  assert.doesNotMatch(JSON.stringify(model.comparison), /clientId|name|mobile|Private treatment/);
  await f.db.query(
    "UPDATE staff_admin_accounts SET business_role='tenant_practitioner' WHERE id=41",
  );
  const tenant = await service(f).getModel({ adminId: 41 });
  assert.deepEqual(tenant.comparison.monthly, [
    { month: '2026-09', clients: 1 },
    { month: '2026-10', clients: 0 },
    { month: '2026-11', clients: 0 },
  ]);
});

test('same-date query obeys common short-month cutoff and first-day SAST midnight', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.add({ id: 1, date: '2027-01-28', time: '09:00' });
  await f.add({ id: 2, client: 2, date: '2027-01-29', time: '09:00' });
  await f.add({ id: 3, date: '2027-02-28', time: '09:00' });
  await f.add({ id: 4, client: 2, date: '2027-03-28', time: '09:01' });
  await f.add({ id: 5, date: '2027-03-29', time: '09:00' });
  const short = await createClientInsightsService({
    db: f.db,
    accessService: f.service,
    now: () => new Date('2027-03-31T08:00:00Z'),
  }).getModel({ adminId: 41 });
  assert.equal(short.comparison.period.day, 28);
  assert.deepEqual(
    short.comparison.monthly.map((m) => m.clients),
    [1, 1, 1],
  );
  assert.equal(short.totalVisits, 3);
  const midnight = await createClientInsightsService({
    db: f.db,
    accessService: f.service,
    now: () => new Date('2027-03-31T22:00:00Z'),
  }).getModel({ adminId: 41 });
  assert.equal(midnight.comparison.period.day, 1);
  assert.deepEqual(
    midnight.comparison.monthly.map((m) => m.clients),
    [0, 0, 0],
  );
});

test('comparison overflow, ambiguity and query failure are unavailable without erasing verified selected-period totals', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.add({ id: 1, date: '2026-10-01' });
  const brokenDb = {
    connect: async () => {
      const client = await f.db.connect();
      return {
        ...client,
        query: (text, values) => {
          if (text.includes('clientInsights:same-date-comparison'))
            throw Error('Synthetic comparison failure');
          return client.query(text, values);
        },
      };
    },
  };
  const broken = await createClientInsightsService({
    db: brokenDb,
    accessService: f.service,
    now: () => new Date(asOf),
  }).getModel({ adminId: 41 });
  assert.equal(broken.available, true);
  assert.equal(broken.totalVisits, 1);
  assert.equal(broken.comparison.available, false);
  assert.equal(broken.comparison.monthly, undefined);
  await f.add({ id: 2, date: '2026-09-01', group: 20 });
  await f.add({ id: 3, date: '2026-09-02', group: 20 });
  const split = await service(f).getModel({ adminId: 41 });
  assert.equal(split.available, true);
  assert.equal(split.comparison.available, false);
  await f.db.query(
    "INSERT INTO appointments SELECT n,NULL,1,'2026-09-01'::timestamptz,'2026-09-01 01:00'::timestamptz,'completed','Synthetic' FROM generate_series(10,10010) n",
  );
  const cap = await service(f).getModel({ adminId: 41 });
  assert.equal(cap.available, true);
  assert.equal(cap.totalVisits, 1);
  assert.equal(cap.comparison.available, false);
});

test('comparison projection rejects incomplete, reordered, invalid and inconsistent rows rather than inventing values', () => {
  const {
    insightComparisonPeriod,
    projectInsightComparison,
  } = require('../src/domain/clientInsights');
  const period = insightComparisonPeriod(asOf);
  const valid = {
    record_count: 4,
    split_group: false,
    monthly: period.monthKeys.map((month) => ({ month, clients: 1 })),
  };
  assert.equal(projectInsightComparison(valid, period).available, true);
  for (const row of [
    null,
    { ...valid, record_count: 10001 },
    { ...valid, split_group: true },
    { ...valid, split_group: undefined },
    { ...valid, monthly: [null, ...valid.monthly.slice(1)] },
    { ...valid, monthly: valid.monthly.slice(1) },
    { ...valid, monthly: valid.monthly.toReversed() },
    { ...valid, record_count: 2 },
    { ...valid, monthly: valid.monthly.map((m) => ({ ...m, clients: -1 })) },
    { ...valid, monthly: valid.monthly.map((m) => ({ ...m, clients: null })) },
  ])
    assert.equal(projectInsightComparison(row, period).available, false);
});
