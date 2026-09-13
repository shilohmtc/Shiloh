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

test('#814 duplicate credential protection remains present in bootstrap ceremony', () => {
  const script = bootstrapScript();
  assert.match(script, /excludeCredentials/);
  assert.match(script, /InvalidStateError/);
  assert.match(script, /location\.replace\('\/calendar\/staff'\)/);
  assert.match(script, /bootstrap\/finish/);
});
