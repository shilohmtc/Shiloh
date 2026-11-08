const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCalendarGroupBookingRouter } = require('../src/routes/calendarGroupBooking');

test('all group writes retain the session actor and require session, origin and CSRF', async t => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/calendar/book/group', createCalendarGroupBookingRouter({
    env: { NODE_ENV: 'test' },
    sessionService: {
      validateSessionToken: async token => token === 'synthetic' ? { ok: true, adminId: 7 } : { ok: false },
      validateCsrfToken: (_session, token) => token === 'csrf',
    },
    bookingService: Object.fromEntries(['prepare', 'discard', 'confirm'].map(action => [action, async input => {
      calls.push({ action, input });
      return { status: 'synthetic' };
    }])),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: 'shiloh_staff_session=synthetic', origin,
    'content-type': 'application/json', 'x-shiloh-csrf-token': 'csrf' };
  for (const action of ['prepare', 'discard', 'confirm']) {
    const post = extra => fetch(`${origin}/calendar/book/group/${action}`, {
      method: 'POST', headers: { ...headers, ...extra },
      body: JSON.stringify({ adminId: 999, organiserClientId: 201, reviewKey: 'synthetic-review' }),
    });
    const before = calls.length;
    assert.equal((await post({ cookie: '' })).status, 401);
    assert.equal((await post({ origin: 'https://other.test' })).status, 403);
    assert.equal((await post({ 'x-shiloh-csrf-token': '' })).status, 403);
    assert.equal(calls.length, before);
    assert.equal((await post()).status, action === 'confirm' ? 201 : 200);
    assert.equal(calls.at(-1).input.adminId, 7);
    assert.equal(calls.at(-1).input.organiserClientId, 201);
  }
});

test('group enquiry GET passes only server context and date, and never falls back to a blank form on invalid context', async t => {
  const app = express();
  let rendered;
  const context = { requestId: 501, preferredDate: '2030-12-12', organiser: { clientId: '201', name: 'Synthetic Organiser' } };
  app.use('/calendar/book/group', createCalendarGroupBookingRouter({
    env: { NODE_ENV: 'test' },
    sessionService: { validateSessionToken: async () => ({ ok: true, adminId: 7 }) },
    bookingService: {
      listOptions: async () => ({ services: [], staff: [] }),
      requestContext: async (adminId, id) => {
        assert.equal(adminId, 7);
        if (id !== '501') throw Object.assign(new Error('Unavailable enquiry'), { code: 'GROUP_REQUEST_UNAVAILABLE', httpStatus: 409 });
        return context;
      },
    },
    renderPage: input => { rendered = input; return 'Synthetic group page'; },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: 'shiloh_staff_session=synthetic' };
  assert.equal((await fetch(`${origin}/calendar/book/group?request=501&date=2040-01-01&client=999&service=81`, { headers })).status, 200);
  assert.deepEqual(rendered.options.requestContext, context);
  assert.deepEqual(rendered.prefill, { date: '2030-12-12' });
  rendered = null;
  assert.equal((await fetch(`${origin}/calendar/book/group?request=missing`, { headers })).status, 409);
  assert.equal(rendered, null);
});
