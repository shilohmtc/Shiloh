const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { createWorkspaceOperationalRouter } = require('../src/routes/workspaceOperational');
const { createStaffCalendarAccessRouter } = require('../src/routes/staffCalendarAccessUx');
const { isHumanBrowserNavigation } = require('../src/middleware/staffBrowserSession');

const execFileAsync = promisify(execFile);
const TEST_KEY = Buffer.alloc(32, 7).toString('base64url');
const ENV = {
  NODE_ENV: 'test',
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  SHILOH_STAFF_TOTP_AUTH_ENABLED: 'true',
  SHILOH_STAFF_TOTP_PILOT_ADMIN_IDS: '7',
  SHILOH_STAFF_TOTP_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: TEST_KEY }),
  SHILOH_STAFF_TOTP_ACTIVE_KEY_VERSION: 'v1',
  SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'false',
};

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function rawRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: responseBody,
      }));
    });
    request.on('error', reject);
    if (body != null) request.write(body);
    request.end();
  });
}

async function withServer(app, work) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try { return await work(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function fixture() {
  const validSession = {
    ok: true,
    adminId: 7,
    recoveryRequired: false,
    viewer: { calendarScope: 'business_all_staff' },
    accountPrincipal: { role: 'owner', businessRole: 'owner', calendarScope: 'all_business', serviceScope: 'all_services' },
  };
  const sessionService = {
    async validateSessionToken(token) {
      if (token === 'valid') return validSession;
      return { ok: false, code: token ? 'STAFF_SESSION_EXPIRED' : 'STAFF_SESSION_INVALID' };
    },
    validateCsrfToken() { return false; },
  };
  const dashboardService = {
    async buildModel() { return { ok: true }; },
  };
  const navigationService = {
    async resolve() { return { destinations: [] }; },
  };
  const app = express();
  app.use('/calendar/staff', createStaffCalendarAccessRouter({ env: ENV }));
  app.use('/calendar/workspace', createWorkspaceOperationalRouter({
    env: ENV,
    sessionService,
    dashboardService,
    navigationService,
    renderDashboard: () => '<!doctype html><html><body data-authenticated-workspace>Authenticated Workspace</body></html>',
  }));
  return app;
}

test('#831 navigation classification distinguishes document navigation from intentional machine requests', () => {
  function req(method, headers) {
    return { method, headers, get(name) { return headers[String(name).toLowerCase()]; } };
  }
  assert.equal(isHumanBrowserNavigation(req('GET', { 'sec-fetch-mode': 'navigate', accept: 'text/html' })), true);
  assert.equal(isHumanBrowserNavigation(req('GET', { 'sec-fetch-dest': 'document', accept: 'text/html' })), true);
  assert.equal(isHumanBrowserNavigation(req('GET', { accept: 'text/html,application/xhtml+xml' })), true);
  assert.equal(isHumanBrowserNavigation(req('GET', { accept: 'application/json' })), false);
  assert.equal(isHumanBrowserNavigation(req('GET', { 'sec-fetch-mode': 'same-origin', accept: 'text/html' })), false);
  assert.equal(isHumanBrowserNavigation(req('POST', { 'sec-fetch-mode': 'navigate', accept: 'text/html' })), false);
});

test('#831 Workspace browser navigation redirects to existing sign-in while JSON/API requests remain 401', async () => {
  await withServer(fixture(), async base => {
    const workspace = `${base}/calendar/workspace`;
    const browser = await rawRequest(workspace, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    assert.equal(browser.status, 302);
    assert.equal(browser.headers.location, '/calendar/staff?reason=session');
    assert.equal(browser.headers['set-cookie'], undefined);

    const signIn = await rawRequest(`${base}${browser.headers.location}`, { headers: { accept: 'text/html' } });
    const signInHtml = signIn.body;
    assert.equal(signIn.status, 200);
    assert.match(signInHtml, /<title>Shiloh Workspace sign-in<\/title>/);
    assert.doesNotMatch(signInHtml, /\{"error":"Unauthorized"/);
    assert.doesNotMatch(signInHtml, /First Time|New Device|device not set up|permissions\/governance/i);
    assert.doesNotMatch(signInHtml, /Use another sign-in method|Sign in with authenticator|Use a recovery code/);

    const json = await rawRequest(workspace, { headers: { accept: 'application/json' } });
    assert.equal(json.status, 401);
    assert.equal(JSON.parse(json.body).error, 'Unauthorized');

    const ajaxHtml = await rawRequest(workspace, { headers: { accept: 'text/html', 'sec-fetch-mode': 'same-origin' } });
    assert.equal(ajaxHtml.status, 401);
    assert.equal(JSON.parse(ajaxHtml.body).error, 'Unauthorized');

    const api = await rawRequest(`${workspace}/appointments/501/finalize`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'completed' }),
    });
    assert.equal(api.status, 401);
    assert.equal(JSON.parse(api.body).error, 'Unauthorized');

    const expired = await rawRequest(workspace, {
      headers: { cookie: 'shiloh_staff_session=expired', accept: 'text/html' },
    });
    assert.equal(expired.status, 302);
    assert.equal(expired.headers['set-cookie'], undefined);

    const authenticated = await rawRequest(workspace, {
      headers: { cookie: 'shiloh_staff_session=valid', accept: 'text/html' },
    });
    assert.equal(authenticated.status, 200);
    assert.match(authenticated.body, /data-authenticated-workspace/);
  });
});

test('#831 real Chromium Desktop and Phone direct navigation land on simplified Shiloh sign-in', async () => {
  const chrome = chromeExecutable();
  assert.ok(chrome, 'Chrome/Chromium is required for #831 browser-navigation proof');
  await withServer(fixture(), async base => {
    async function dump(args, url) {
      const result = await execFileAsync(chrome, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--virtual-time-budget=800', '--dump-dom', ...args, url,
      ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });
      return result.stdout || '';
    }

    const desktop = await dump(['--window-size=1440,900'], `${base}/calendar/workspace`);
    assert.match(desktop, /Shiloh Workspace sign-in/);
    assert.doesNotMatch(desktop, /\{"error":"Unauthorized"/);
    assert.doesNotMatch(desktop, /First Time|New Device|device not set up|permissions\/governance/i);
    assert.doesNotMatch(desktop, /Use another sign-in method|Sign in with authenticator|Use a recovery code/);

    const phone = await dump([
      '--window-size=390,844',
      '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    ], `${base}/calendar/workspace`);
    assert.match(phone, /Shiloh Workspace sign-in/);
    assert.doesNotMatch(phone, /\{"error":"Unauthorized"/);
    assert.doesNotMatch(phone, /First Time|New Device|device not set up|permissions\/governance/i);
    assert.doesNotMatch(phone, /Use another sign-in method|Sign in with authenticator|Use a recovery code/);
  });
});
