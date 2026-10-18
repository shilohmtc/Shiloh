'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createStaffDetailAuthRouter } = require('../src/routes/staffDetailAuth');
const { createStaffCalendarAccessPageHandler } = require('../src/routes/staffCalendarAccessUx');
const { sha256 } = require('../src/services/staffBrowserSession');
const env = {
  SHILOH_STAFF_DETAIL_AUTH_ENABLED: 'true',
  SHILOH_STAFF_DETAIL_AUTH_RATE_KEY: 'synthetic-rate-key'.repeat(3),
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true',
  SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://staff.example.test',
};
async function server(t, patch = {}) {
  const calls = [];
  const session = {
    ok: true,
    sessionId: 17,
    adminId: 42,
    authMethod: 'staff_details',
    authenticatedAt: new Date(),
    csrfHash: sha256('C'.repeat(43)),
  };
  const sessions = {
    async validateSessionToken(token) {
      return token === 'A'.repeat(43) ? session : { ok: false };
    },
    validateCsrfToken(actual, token) {
      return sha256(token) === actual.csrfHash;
    },
  };
  const auth = {
    async attempt(input) {
      calls.push(input);
      return {
        ok: true,
        sessionToken: 'B'.repeat(43),
        browserToken: 'D'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000),
        viewer: { calendarScope: 'business_all_staff' },
      };
    },
  };
  const setup = {
    async save(input) {
      calls.push(input);
      return { ok: true };
    },
    async read() {
      return {
        ok: true,
        targetId: 42,
        displayName: 'Synthetic',
        mobile: '27820000001',
        revision: 'e'.repeat(64),
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/calendar/staff-auth/details',
    createStaffDetailAuthRouter({ env, auth, setup, sessions, ...patch }),
  );
  app.get('/calendar/staff', createStaffCalendarAccessPageHandler({ env }));
  const listening = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => listening.close(resolve)));
  const origin = `http://127.0.0.1:${listening.address().port}`;
  return {
    origin,
    calls,
    session,
    post: (path, body = {}, headers = {}) =>
      fetch(origin + '/calendar/staff-auth/details' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
        body: JSON.stringify(body),
      }),
  };
}
test('four-detail entry is mounted with private cookies and refuses cross-origin requests', async (t) => {
  const h = await server(t);
  const response = await h.post('/sign-in', { firstName: 'Synthetic' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authenticated, true);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((value) => /HttpOnly/.test(value) && /SameSite=Strict/.test(value)));
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await h.post('/sign-in', {}, { Origin: 'https://other.example' })).status, 403);
  assert.equal(h.calls.length, 1);
  const page = await fetch(h.origin + '/calendar/staff');
  const html = await page.text();
  for (const field of ['firstName', 'surname', 'dateOfBirth', 'mobile'])
    assert.ok(html.includes(`name="${field}"`));
  assert.match(html, /Use a saved passkey/);
  assert.doesNotMatch(html, /Open from Shiloh WhatsApp/);
});
test('setup requires session/CSRF and ignores a body-supplied operator session', async (t) => {
  const h = await server(t);
  const cookies = { Cookie: 'shiloh_staff_session=' + 'A'.repeat(43) };
  assert.equal((await h.post('/setup')).status, 401);
  assert.equal((await h.post('/setup', {}, cookies)).status, 403);
  const response = await h.post(
    '/setup',
    { targetId: 70, expectedRevision: 'e'.repeat(64), input: {}, session: { adminId: 999 } },
    { ...cookies, 'x-shiloh-csrf-token': 'C'.repeat(43) },
  );
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].session.adminId, 42);
  assert.equal(h.calls[0].session.authMethod, 'staff_details');
});
test('setup reports the three-account restriction for denied reads and saves', async (t) => {
  const setup = {
    async read() {
      return { ok: false, code: 'STAFF_DETAIL_SETUP_FORBIDDEN' };
    },
    async save() {
      return { ok: false, code: 'STAFF_DETAIL_SETUP_FORBIDDEN' };
    },
  };
  const h = await server(t, { setup });
  const headers = {
    Cookie: 'shiloh_staff_session=' + 'A'.repeat(43),
    'x-shiloh-csrf-token': 'C'.repeat(43),
  };
  const page = await fetch(h.origin + '/calendar/staff-auth/details/manage', { headers });
  assert.equal(page.status, 403);
  assert.match(await page.text(), /Only Reception, Christel and JP/);
  const response = await h.post('/setup', {}, headers);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Only Reception, Christel and JP/);
});
test('ordinary details entry stays disabled until configured; existing authenticated setup remains available', async (t) => {
  const h = await server(t, { env: { ...env, SHILOH_STAFF_DETAIL_AUTH_ENABLED: 'false' } });
  assert.equal((await h.post('/sign-in')).status, 404);
  assert.equal(h.calls.length, 0);
  const page = await fetch(h.origin + '/calendar/staff-auth/details/manage', {
    headers: { Cookie: 'shiloh_staff_session=' + 'A'.repeat(43) },
  });
  assert.equal(page.status, 200);
});

test('Workspace exposes WhatsApp navigation only while the channel is available', async (t) => {
  let available = true;
  const app = express();
  app.get('/calendar/staff', createStaffCalendarAccessPageHandler({ env,
    whatsappAvailable: () => { if (available === 'error') throw Error('unavailable'); return available; },
  }));
  const listening = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => new Promise(resolve => listening.close(resolve)));
  const origin = `http://127.0.0.1:${listening.address().port}`;
  for (const state of [true, false, 'error']) {
    available = state;
    const response = await fetch(origin + '/calendar/staff');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const html = await response.text();
    assert.equal(html.includes('href="/calendar/staff-auth/whatsapp/"'), state === true);
    assert.match(html, /Use a saved passkey/);
    assert.match(html, /data-staff-detail-form/);
    assert.doesNotMatch(html, /Open from Shiloh WhatsApp/);
  }
});
