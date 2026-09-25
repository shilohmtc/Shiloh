'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bootstrapScript } = require('../src/presentation/staffPasskeyBootstrapUx');

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function runWithCredentialError(errorName) {
  const status = {
    textContent: '',
    classList: { toggle() {}, add() {} },
  };
  const retry = {
    shown: false,
    classList: {
      remove() { retry.shown = false; },
      add() { retry.shown = true; },
    },
    addEventListener() {},
  };
  const replacements = [];
  const requests = [];
  let choose;
  const modeButton = {
    disabled: false,
    getAttribute() { return 'add'; },
    addEventListener(_event, listener) { choose = () => listener.call(modeButton); },
  };
  const error = new Error(errorName);
  error.name = errorName;
  const token = 'A'.repeat(43);
  const context = {
    document: {
      querySelector(selector) {
        if (selector === '[data-bootstrap-status]') return status;
        if (selector === '[data-bootstrap-retry]') return retry;
        if (selector === '[data-bootstrap-choices]') return { setAttribute() {} };
        return null;
      },
      querySelectorAll(selector) { return selector === '[data-bootstrap-mode]' ? [modeButton] : []; },
    },
    window: { PublicKeyCredential: function PublicKeyCredential() {} },
    navigator: {
      credentials: {
        async create() { throw error; },
      },
    },
    location: {
      hash: `#setup=${token}`,
      pathname: '/calendar/staff-auth/passkeys/bootstrap',
      replace(target) { replacements.push(target); },
    },
    history: { replaceState() {} },
    URLSearchParams,
    Uint8Array,
    JSON,
    String,
    Error,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      requests.push(url);
      if (url === '/calendar/staff-auth/passkeys/bootstrap/start') {
        return {
          ok: true,
          async json() {
            return {
              displayName: 'Shiloh Reception',
              options: {
                challenge: base64url([1, 2, 3]),
                user: { id: base64url([4, 5, 6]) },
                excludeCredentials: [{ type: 'public-key', id: base64url([7, 8, 9]) }],
              },
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };

  vm.runInNewContext(bootstrapScript(), context);
  choose();
  await new Promise((resolve) => setImmediate(resolve));
  return { status, retry, replacements, requests };
}

test('#814 already-enrolled authenticator routes to existing passkey sign-in without finish or retry loop', async () => {
  const result = await runWithCredentialError('InvalidStateError');
  assert.equal(result.status.textContent, 'This device is already set up for Shiloh. Opening sign-in…');
  assert.deepEqual(result.replacements, ['/calendar/staff']);
  assert.deepEqual(result.requests, ['/calendar/staff-auth/passkeys/bootstrap/start']);
  assert.equal(result.retry.shown, false);
});

test('#814 ordinary cancelled verification remains retryable and does not impersonate already-enrolled state', async () => {
  const result = await runWithCredentialError('NotAllowedError');
  assert.match(result.status.textContent, /Device verification was cancelled/);
  assert.deepEqual(result.replacements, []);
  assert.deepEqual(result.requests, ['/calendar/staff-auth/passkeys/bootstrap/start']);
  assert.equal(result.retry.shown, true);
});

async function runWithStalledCredential() {
  const status = { textContent:'', classList:{ toggle() {}, add() {} } };
  const retry = { shown:false, classList:{ remove(){ retry.shown=false; }, add(){ retry.shown=true; } }, addEventListener(){} };
  const signin = { shown:false, classList:{ remove(){ signin.shown=false; }, add(){ signin.shown=true; } }, addEventListener(_event, listener){ signin.open = listener; } };
  const replacements = [];
  const requests = [];
  let choose;
  let timeoutHandler;
  const modeButton = { disabled:false, getAttribute(){ return 'add'; }, addEventListener(_event, listener){ choose=()=>listener.call(modeButton); } };
  const token='A'.repeat(43);
  const context = {
    document: {
      querySelector(selector) {
        if (selector === '[data-bootstrap-status]') return status;
        if (selector === '[data-bootstrap-retry]') return retry;
        if (selector === '[data-bootstrap-signin]') return signin;
        if (selector === '[data-bootstrap-choices]') return { setAttribute() {} };
        return null;
      },
      querySelectorAll(selector) { return selector === '[data-bootstrap-mode]' ? [modeButton] : []; },
    },
    window: { PublicKeyCredential: function PublicKeyCredential() {} },
    navigator: { credentials: { create() { return new Promise(() => {}); } } },
    location: {
      hash: `#setup=${token}`,
      pathname: '/calendar/staff-auth/passkeys/bootstrap',
      replace(target) { replacements.push(target); },
    },
    history: { replaceState() {} },
    URLSearchParams, Uint8Array, JSON, String, Error, Promise, atob, btoa,
    setTimeout(handler) { timeoutHandler = handler; return 1; },
    clearTimeout() {},
    fetch: async (url) => {
      requests.push(url);
      if (url === '/calendar/staff-auth/passkeys/bootstrap/start') {
        return {
          ok:true,
          async json() {
            return {
              displayName:'Abigail',
              options:{
                challenge:base64url([1,2,3]),
                user:{ id:base64url([4,5,6]) },
                excludeCredentials:[],
              },
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  vm.runInNewContext(bootstrapScript(), context);
  choose();
  await new Promise(resolve => setImmediate(resolve));
  timeoutHandler();
  return { status, retry, signin, replacements, requests };
}

test('stalled Android credential creation becomes recoverable without posting an unfinished credential', async () => {
  const result = await runWithStalledCredential();
  assert.match(result.status.textContent, /Android did not finish device verification/);
  assert.equal(result.retry.shown, true);
  assert.equal(result.signin.shown, true);
  assert.deepEqual(result.requests, ['/calendar/staff-auth/passkeys/bootstrap/start']);
  assert.deepEqual(result.replacements, []);
  result.signin.open();
  assert.deepEqual(result.replacements, ['/calendar/staff']);
});

test('#814 duplicate credential protection remains present in bootstrap ceremony', () => {
  const script = bootstrapScript();
  assert.match(script, /excludeCredentials/);
  assert.match(script, /InvalidStateError/);
  assert.match(script, /location\.replace\('\/calendar\/staff'\)/);
  assert.match(script, /bootstrap\/finish/);
  assert.match(script, /PASSKEY_STALL_MS=30000/);
  assert.match(script, /Android did not finish device verification/);
  assert.match(script, /data-bootstrap-signin/);
});
