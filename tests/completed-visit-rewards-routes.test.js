const test = require('node:test'),
  assert = require('node:assert/strict'),
  express = require('express');
const { createCalendarPaymentsRouter } = require('../src/routes/calendarPayments');
test('completed reward preview and apply preserve session, origin, CSRF and server-owned actor/appointment', async (t) => {
  const calls = [],
    app = express();
  app.use(express.json());
  app.use(
    '/calendar/payments',
    createCalendarPaymentsRouter({
      env: { NODE_ENV: 'test' },
      sessionService: {
        validateSessionToken: async (token) =>
          token === 'synthetic' ? { ok: true, adminId: 2 } : { ok: false },
        validateCsrfToken: (_s, token) => token === 'csrf',
      },
      completedRewardsService: {
        preview: async (input) => {
          calls.push(input);
          return { amount: '100' };
        },
        apply: async (input) => {
          calls.push(input);
          return { status: 'applied' };
        },
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    cookie: 'shiloh_staff_session=synthetic',
    origin,
    'content-type': 'application/json',
    'x-shiloh-csrf-token': 'csrf',
  };
  for (const suffix of ['/preview', '']) {
    const post = (extra) =>
      fetch(origin + '/calendar/payments/appointments/201/completed-rewards' + suffix, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body: JSON.stringify({ adminId: 99, appointmentId: 99, amount: '100' }),
      });
    const before = calls.length;
    assert.equal((await post({ cookie: '' })).status, 401);
    assert.equal((await post({ origin: 'https://other.test' })).status, 403);
    assert.equal((await post({ 'x-shiloh-csrf-token': '' })).status, 403);
    assert.equal(calls.length, before);
    assert.equal((await post()).status, 200);
    assert.equal(calls.at(-1).adminId, 2);
    assert.equal(calls.at(-1).appointmentId, '201');
  }
});
test('completed review uses its guarded endpoint while upcoming rewards and settled presentation retain their boundaries', () => {
  const {
    renderCalendarPaymentPage,
    calendarPaymentsClientScript,
  } = require('../src/presentation/calendarPaymentsUx');
  const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');
  const completed = paymentFixture({ paid: false });
  assert.match(renderCalendarPaymentPage({ model: completed }), /data-completed-rewards/);
  completed.noncash.eligible = false;
  assert.doesNotMatch(renderCalendarPaymentPage({ model: completed }), /data-completed-rewards/);
  const upcoming = paymentFixture({ paid: false });
  upcoming.subject.status = 'scheduled';
  assert.doesNotMatch(renderCalendarPaymentPage({ model: upcoming }), /data-completed-rewards/);
  assert.match(renderCalendarPaymentPage({ model: upcoming }), />Apply rewards<\/button>/);
  assert.doesNotMatch(
    renderCalendarPaymentPage({ model: paymentFixture({ paid: true }) }),
    /data-rewards-form/,
  );
  assert.doesNotThrow(() => new Function(calendarPaymentsClientScript()));
});
