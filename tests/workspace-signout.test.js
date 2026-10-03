'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { workspaceSignoutClientScript } = require('../src/presentation/workspaceSessionUx');
const { workspaceNavigationClientScript } = require('../src/presentation/workspaceShell');
const { staffCalendarAccessClientScript } = require('../src/presentation/staffCalendarAccessUx');

function harness(responses) {
  const listeners = [];
  const button = { dataset: {}, disabled: false, addEventListener(event, handler) { listeners.push(handler); } };
  const status = { textContent: '' };
  const calls = [], redirects = [];
  const context = vm.createContext({
    document: {
      querySelectorAll: () => [button],
      querySelector: selector => selector === '[data-shiloh-calendar-access-status]' ? status : null,
    },
    window: { location: { replace: path => redirects.push(path) } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { status: response.status, ok: response.status < 400, json: async () => response.body || {} };
    },
  });
  return { button, status, calls, redirects, listeners, context, async click() {
    listeners.forEach(handler => handler());
    await new Promise(resolve => setImmediate(resolve));
  } };
}

test('every Workspace menu includes the same sign-out behavior as the staff landing', () => {
  const shared = workspaceSignoutClientScript();
  assert.ok(workspaceNavigationClientScript().includes(shared));
  assert.ok(staffCalendarAccessClientScript().includes(shared));
  assert.doesNotMatch(shared, /localStorage|sessionStorage/);
});

test('duplicate scripts bind once and sign-out waits for CSRF and successful revocation', async () => {
  const h = harness([{ status: 200, body: { csrfToken: 'synthetic-csrf' } }, { status: 204 }]);
  vm.runInContext(workspaceSignoutClientScript(), h.context);
  vm.runInContext(workspaceSignoutClientScript(), h.context);
  assert.equal(h.listeners.length, 1);
  await h.click();
  assert.deepEqual(h.calls.map(call => call.url), ['/calendar/staff-auth/csrf', '/calendar/staff-auth/logout']);
  assert.equal(h.calls[1].options.headers['x-shiloh-csrf-token'], 'synthetic-csrf');
  assert.equal(h.calls[1].options.credentials, 'same-origin');
  assert.deepEqual(h.redirects, ['/calendar/staff?reason=logout']);
});

test('failed and offline sign-out stays on the page, explains failure and permits retry', async () => {
  for (const responses of [
    [{ status: 503 }],
    [{ status: 200, body: {} }],
    [{ status: 200, body: { csrfToken: 'synthetic-csrf' } }, { status: 403 }],
    [new Error('Offline')],
  ]) {
    const h = harness(responses);
    vm.runInContext(workspaceSignoutClientScript(), h.context);
    await h.click();
    assert.deepEqual(h.redirects, []);
    assert.match(h.status.textContent, /Could not/);
    assert.equal(h.button.disabled, false);
  }
});

test('expired session returns to sign-in without claiming a successful sign-out', async () => {
  const h = harness([{ status: 401 }]);
  vm.runInContext(workspaceSignoutClientScript(), h.context);
  await h.click();
  assert.deepEqual(h.redirects, ['/calendar/staff?reason=session']);
  assert.equal(h.calls.length, 1);
});

test('double taps issue one revocation request', async () => {
  const h = harness([{ status: 200, body: { csrfToken: 'synthetic-csrf' } }, { status: 204 }]);
  vm.runInContext(workspaceSignoutClientScript(), h.context);
  h.listeners[0]();
  h.listeners[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 2);
});
