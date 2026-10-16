'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { workspacePwaServiceWorkerScript } = require('../src/presentation/workspacePwa');
const { workspaceDashboardAttention } = require('../src/services/workspaceDashboardAttention');

function workerFixture({ api = 'supported' } = {}) {
  const handlers = {}, badges = [], shown = [], waits = [];
  const navigator = api === 'unsupported' ? {} : {
    async setAppBadge(...args) { badges.push(args); if (api === 'reject') throw Error('OS rejected'); },
    async clearAppBadge() { badges.push(['clear']); if (api === 'reject') throw Error('OS rejected'); },
  };
  const self = { navigator, addEventListener: (name, callback) => { (handlers[name] ||= []).push(callback); },
    registration: { async showNotification(...args) { shown.push(args); } } };
  vm.runInNewContext(workspacePwaServiceWorkerScript(), { self });
  function dispatch(type, data = {}) {
    for (const handler of handlers[type]) handler({ ...data, waitUntil(promise) { waits.push(promise); } });
  }
  function snapshot() { let revision; dispatch('message', { data: { type: 'SHILOH_BADGE_SNAPSHOT' }, ports: [{ postMessage(value) { revision = value; } }] }); return revision; }
  return { badges, shown, dispatch, snapshot, async settle() { await Promise.all(waits.splice(0)); } };
}

test('badge uses exactly the existing Needs attention projection, without counting today/carry-over visits twice', () => {
  const model = { operationalDateKey: '2026-10-16', appointments: [{ id: 1 }], carryOver: [{ id: 2, operationalDateKey: '2026-10-15' }],
    awaitingFinalization: [{ id: 1 }, { id: 2, operationalDateKey: '2026-10-15' }, { id: 3 }], bookingRequests: [{}], planningRequests: [{}, {}],
    rescheduleRequests: [{}], holidayDecisions: [{}], bookingProblems: { pendingCount: '3' } };
  assert.deepEqual(workspaceDashboardAttention(model), { exceptionalFinalization: [{ id: 3 }], count: 9 });
  assert.equal(workspaceDashboardAttention({}).count, 0);
});

for (const api of ['supported', 'unsupported', 'reject']) test(`push badge is optional and preserves immediate generic notification: ${api}`, async () => {
  const f = workerFixture({ api });
  f.dispatch('push'); await f.settle();
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0][1].body, 'Open Workspace to review updates.');
  assert.deepEqual(f.badges, api === 'unsupported' ? [] : [[]]);
});

test('fresh counts update the badge, zero clears, malformed numbers do not change it', async () => {
  const f = workerFixture(); const revision = f.snapshot();
  for (const count of [4, 0, -1, 2.5, '5', null, Number.MAX_SAFE_INTEGER + 1]) f.dispatch('message', { data: { type: 'SHILOH_BADGE_COUNT', revision, count } });
  await f.settle(); assert.deepEqual(f.badges, [[4], ['clear']]);
});

test('a new push or opt-out invalidates an older in-flight count, including a zero-pending race', async () => {
  const f = workerFixture(); const oldRevision = f.snapshot();
  f.dispatch('push');
  f.dispatch('message', { data: { type: 'SHILOH_BADGE_COUNT', revision: oldRevision, count: 0 } });
  await f.settle(); assert.deepEqual(f.badges, [[]]);
  const currentRevision = f.snapshot();
  f.dispatch('message', { data: { type: 'SHILOH_BADGE_CLEAR' } });
  f.dispatch('message', { data: { type: 'SHILOH_BADGE_COUNT', revision: currentRevision, count: 9 } });
  await f.settle(); assert.deepEqual(f.badges, [[], ['clear']]);
  const restarted = workerFixture();
  restarted.dispatch('message', { data: { type: 'SHILOH_BADGE_COUNT', revision: f.snapshot(), count: 9 } });
  await restarted.settle(); assert.deepEqual(restarted.badges, []);
});

test('attention count route reuses current Dashboard authority, protects sessions and returns no private details', async t => {
  const express = require('express'); const { createWorkspaceOperationalRouter } = require('../src/routes/workspaceOperational');
  const viewer = { calendarScope: 'business_all_staff' }; const accountPrincipal = { id: 7 }; let mode = 'ok'; const calls = [];
  const app = express();
  app.use('/calendar/workspace', createWorkspaceOperationalRouter({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' },
    sessionService: { async validateSessionToken(token) { return token === 'valid' ? { ok: true, adminId: 7, viewer, accountPrincipal } : { ok: false }; } },
    dashboardService: { async buildModel(input) { calls.push(input); if (mode === 'forbidden') throw Object.assign(Error('forbidden'), { httpStatus: 403 }); if (mode === 'failed') throw Error('offline');
      return { appointments: [], bookingRequests: [{ clientName: 'Synthetic private name' }], bookingProblems: { unavailable: mode === 'partial' } }; } },
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/calendar/workspace/attention-count?adminId=999`;
  assert.equal((await fetch(url)).status, 401); assert.equal(calls.length, 0);
  const response = await fetch(url, { headers: { Cookie: 'shiloh_staff_session=valid' } });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(await response.json(), { count: 1 }); assert.deepEqual(calls, [{ adminId: 7, viewer, sessionPrincipal: accountPrincipal }]);
  for (const [scenario, expected] of [['forbidden', 403], ['failed', 503], ['partial', 503]]) {
    mode = scenario; assert.equal((await fetch(url, { headers: { Cookie: 'shiloh_staff_session=valid' } })).status, expected);
  }
});

function clientFixture() {
  const { workspaceBadgeClientScript } = require('../src/presentation/workspaceAppBadge');
  const messages = [], writes = [], requests = [], handlers = {};
  const document = { visibilityState: 'visible', addEventListener(type, handler) { handlers[type] = handler; } };
  const navigator = { async setAppBadge(count) { writes.push(count); }, async clearAppBadge() { writes.push('clear'); },
    serviceWorker: { controller: { postMessage(data, ports) { messages.push(data); if (ports) ports[0].postMessage('revision'); } } } };
  class Channel { constructor() { this.port1 = { close() {} }; this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage({ data })) }; } }
  const context = { document, navigator, Notification: { permission: 'granted' }, location: { pathname: '/calendar/workspace' }, MessageChannel: Channel, setTimeout, clearTimeout,
    request: (...args) => new Promise(resolve => requests.push({ args, resolve })) };
  vm.runInNewContext(workspaceBadgeClientScript() + '\nglobalThis.api={refreshBadge,clearBadge};', context);
  return { context, messages, writes, requests, handlers, tick: () => new Promise(resolve => setImmediate(resolve)) };
}

test('foreground count preserves a cue on unavailable network/partial data and clears known expired/forbidden authority', async () => {
  for (const status of [200, 401, 403, 503]) {
    const f = clientFixture(); const pending = f.context.api.refreshBadge(); await f.tick();
    f.requests[0].resolve({ status, ok: status === 200, json: async () => ({ count: 4 }) }); await pending;
    assert.equal(f.messages.filter(m => m.type === 'SHILOH_BADGE_COUNT').length, status === 200 ? 1 : 0);
    assert.deepEqual(f.writes, [401, 403].includes(status) ? ['clear'] : []);
  }
});

test('logout or newer foreground refresh prevents an older count from being applied', async () => {
  const f = clientFixture(); const old = f.context.api.refreshBadge(); await f.tick();
  const fresh = f.context.api.refreshBadge(); await f.tick();
  f.requests[1].resolve({ status: 200, ok: true, json: async () => ({ count: 2 }) }); await fresh;
  f.requests[0].resolve({ status: 200, ok: true, json: async () => ({ count: 9 }) }); await old;
  assert.deepEqual(f.messages.filter(m => m.type === 'SHILOH_BADGE_COUNT').map(m => m.count), [2]);
  const inFlight = f.context.api.refreshBadge(); await f.tick();
  f.handlers.click({ target: { closest: () => true } });
  f.requests[2].resolve({ status: 200, ok: true, json: async () => ({ count: 8 }) }); await inFlight;
  assert.deepEqual(f.messages.filter(m => m.type === 'SHILOH_BADGE_COUNT').map(m => m.count), [2]);
  assert.deepEqual(f.writes, ['clear']);
});

test('hidden, unsupported and permission-changed foreground states never apply a count', async () => {
  const hidden = clientFixture(); hidden.context.document.visibilityState = 'hidden'; await hidden.context.api.refreshBadge(); assert.equal(hidden.requests.length, 0);
  const android = clientFixture(); delete android.context.navigator.setAppBadge; await android.context.api.refreshBadge(); assert.equal(android.requests.length, 0);
  const denied = clientFixture(); const pending = denied.context.api.refreshBadge(); await denied.tick(); denied.context.Notification.permission = 'denied';
  denied.requests[0].resolve({ status: 200, ok: true, json: async () => ({ count: 3 }) }); await pending;
  assert.equal(denied.messages.filter(m => m.type === 'SHILOH_BADGE_COUNT').length, 0);
});
