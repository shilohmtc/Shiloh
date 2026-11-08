const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCalendarCreateBookingRouter } = require('../src/routes/calendarCreateBooking');
const { renderCalendarCreateBookingPage } = require('../src/presentation/calendarCreateBookingUx');

const returnTo = '/calendar/workspace#planning-request-81';
async function fixture(t, authorized = true) {
  const reads = [], renders = [];
  const app = express();
  app.use('/calendar/book', createCalendarCreateBookingRouter({
    sessionService: { async validateSessionToken() { return { ok: authorized, adminId: 7 }; } },
    bookingService: {
      async listBookableOptions(actor) { assert.equal(actor, 7); return { staff: [], services: [] }; },
      async bookingClient(actor, id) { reads.push({ actor, id }); return { id, displayName: 'Synthetic client', status: 'active' }; },
    },
    retrospectiveService: { async resolveOperator() { throw Error('No retrospective access'); } },
    creationService: { async resolveCreateAccess() { return false; } },
    injectAppointmentNotes: html => html,
    renderPage(input) { renders.push(input); return renderCalendarCreateBookingPage(input); },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { reads, renders, get: query => fetch(`http://127.0.0.1:${server.address().port}/calendar/book/?${query}`) };
}
test('booking request GET carries the authorized client and editable date with a bounded return destination', async t => {
  const f = await fixture(t);
  const response = await f.get(new URLSearchParams({ client: '123', date: '2030-11-02', returnTo }));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.deepEqual(f.reads, [{ actor: 7, id: '123' }]);
  assert.equal(f.renders[0].prefill.client.id, '123');
  assert.equal(f.renders[0].prefill.date, '2030-11-02');
  assert.equal(f.renders[0].prefill.returnTo, returnTo);
  assert.match(html, /Back to request/);
  assert.match(html, /id="booking-date"[^>]*value="2030-11-02"/);
  assert.doesNotMatch(html, /id="booking-(?:date|time)"[^>]*(?:readonly|disabled)/);
});
test('untrusted return destinations are omitted, and unauthenticated requests cannot look up clients', async t => {
  const f = await fixture(t);
  for (const destination of ['https://example.test', '//example.test', '/calendar/workspace?admin=1', '/calendar/workspace#planning-request-0', returnTo + '\n', returnTo + '/elsewhere']) {
    const response = await f.get(new URLSearchParams({ returnTo: destination }));
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(f.renders.at(-1).prefill.returnTo, undefined);
  }
  const denied = await fixture(t, false);
  assert.equal((await denied.get('client=123')).status, 401);
  assert.deepEqual(denied.reads, []);
});

test('individual and group requests use their distinct context-preserving booking handoffs', () => {
  const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
  const { rebookModel } = require('../stories/fixtures/rebookActionPresentation');
  const html = renderDashboardPage(rebookModel());
  assert.match(html, /id="planning-request-8201"/);
  assert.match(html, /href="\/calendar\/book\?client=8301&amp;returnTo=%2Fcalendar%2Fworkspace%23planning-request-8201&amp;date=2030-11-02"/);
  const group = html.match(/<article[^>]*data-dashboard-planning-request="8202"[\s\S]*?<\/article>/)[0];
  assert.match(group, /href="\/calendar\/book\/group\?request=8202"/);
  assert.match(group, /id="planning-request-8202"/);
  assert.doesNotMatch(group, /\/calendar\/book\?/);
  const model = rebookModel();
  model.planningRequests[0].client_id = null;
  model.planningRequests[1].client_id = null;
  assert.doesNotMatch(renderDashboardPage(model), /\/calendar\/book\/group\?request=/);
  assert.doesNotMatch(renderDashboardPage(model), /\/calendar\/book\?client=/);
});
