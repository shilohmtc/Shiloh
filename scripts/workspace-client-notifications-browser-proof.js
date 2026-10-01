const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');

const requestContext = require('../src/middleware/requestContext');
const {
  requireStaffSession,
  sameOriginGuard,
  serializeSessionCookie,
} = require('../src/middleware/staffBrowserSession');
const { sha256 } = require('../src/services/staffBrowserSession');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');
const { createWorkspaceClientNotificationRouter } = require('../src/routes/workspaceClientNotifications');
const {
  createWorkspaceClientNotificationService,
  CLIENT_LOOKUP_CAPABILITY,
  CLIENT_NOTIFY_CAPABILITY,
} = require('../src/services/workspaceClientNotifications');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-client-notifications-browser-proof');
const CLIENT_ID = 901;
const APPOINTMENT_ID = 7001;
const FUTURE_START = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
const FUTURE_END = new Date(FUTURE_START.getTime() + (60 * 60 * 1000));

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function opaque(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const OPERATORS = Object.freeze({
  authorized: {
    id: 71,
    name: 'Authorized Operator',
    permissions: { [CLIENT_LOOKUP_CAPABILITY]: true, [CLIENT_NOTIFY_CAPABILITY]: true },
  },
  lookupOnly: {
    id: 72,
    name: 'Lookup Only Operator',
    permissions: { [CLIENT_LOOKUP_CAPABILITY]: true },
  },
});

function createFixture() {
  const env = {
    NODE_ENV: 'production',
    SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
    SHILOH_WORKSPACE_CLIENT_NOTIFY_PROVIDER_READY: 'true',
    PHONE_NUMBER_ID: 'synthetic-phone-id',
    WHATSAPP_TOKEN: 'synthetic-token-never-sent',
    WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE: 'synthetic-approved-contract',
  };
  const sessions = new Map();
  const sessionsById = new Map();
  for (const [key, operator] of Object.entries(OPERATORS)) {
    const token = opaque(`workspace-notify-session:${key}`);
    const csrfToken = opaque(`workspace-notify-csrf:${key}:0`);
    const row = {
      key,
      token,
      csrfToken,
      csrfHash: sha256(csrfToken),
      sessionId: operator.id + 1000,
      operator,
      rotations: 0,
    };
    sessions.set(token, row);
    sessionsById.set(row.sessionId, row);
  }

  const state = {
    senderCalls: 0,
    providerNetworkCalls: 0,
    providerGuardCalls: 0,
    syntheticSentEvidence: false,
    requests: [],
  };

  const sessionService = {
    async validateSessionToken(token) {
      const row = sessions.get(String(token || ''));
      if (!row) return { ok: false };
      return {
        ok: true,
        sessionId: row.sessionId,
        adminId: row.operator.id,
        csrfHash: row.csrfHash,
        recoveryRequired: false,
        viewer: { calendarScope: 'business_all_staff', operatorAdminId: row.operator.id },
      };
    },
    async rotateCsrfToken(sessionId) {
      const row = sessionsById.get(Number(sessionId));
      if (!row) return { ok: false };
      row.rotations += 1;
      row.csrfToken = opaque(`workspace-notify-csrf:${row.key}:${row.rotations}`);
      row.csrfHash = sha256(row.csrfToken);
      return { ok: true, csrfToken: row.csrfToken, csrfHash: row.csrfHash };
    },
    validateCsrfToken(session, supplied) {
      return Boolean(session?.ok && supplied && sha256(supplied) === session.csrfHash);
    },
  };

  function operatorFor(adminId) {
    return Object.values(OPERATORS).find(item => Number(item.id) === Number(adminId)) || null;
  }

  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('workspaceClientNotifications:principal')) {
        const operator = operatorFor(params[0]);
        return {
          rows: operator ? [{
            id: operator.id,
            staff_id: operator.id,
            display_name: operator.name,
            permissions: operator.permissions,
            admin_active: true,
            staff_status: 'active',
          }] : [],
        };
      }
      if (text.includes('workspaceClientNotifications:preview')) {
        if (Number(params[0]) !== CLIENT_ID) return { rows: [] };
        return { rows: [{
          client_id: CLIENT_ID,
          client_name: 'Synthetic Client',
          normalized_mobile: '27821234001',
          mobile_verified_at: new Date('2026-09-01T08:00:00Z'),
          client_status: 'active',
          appointment_id: APPOINTMENT_ID,
          starts_at: FUTURE_START,
          ends_at: FUTURE_END,
          appointment_status: 'confirmed',
          source: 'shiloh',
          location_name: 'Synthetic Shiloh',
          service_name: 'Synthetic Treatment',
          staff_name: 'Synthetic Practitioner',
          already_sent: state.syntheticSentEvidence,
        }] };
      }
      throw new Error(`Unexpected synthetic DB query: ${text.slice(0, 120)}`);
    },
  };

  const notificationService = createWorkspaceClientNotificationService({
    db,
    env,
    providerGuard: async () => {
      state.providerGuardCalls += 1;
      return { ready: true, synthetic: true };
    },
    sender: async appointmentId => {
      assert.equal(Number(appointmentId), APPOINTMENT_ID);
      state.senderCalls += 1;
      state.syntheticSentEvidence = true;
      return { sent: true, synthetic: true };
    },
  });

  const clientService = {
    async listClients({ adminId }) {
      const operator = operatorFor(adminId);
      if (!operator?.permissions?.[CLIENT_LOOKUP_CAPABILITY]) {
        const error = new Error('Client lookup forbidden');
        error.httpStatus = 403;
        throw error;
      }
      return { clients: [], hasMore: false, offset: 0, pageSize: 24, query: '', status: 'active' };
    },
    async getClientDetail({ adminId, clientId }) {
      const operator = operatorFor(adminId);
      if (!operator?.permissions?.[CLIENT_LOOKUP_CAPABILITY]) {
        const error = new Error('Client lookup forbidden');
        error.httpStatus = 403;
        throw error;
      }
      if (Number(clientId) !== CLIENT_ID) {
        const error = new Error('Client not found');
        error.httpStatus = 404;
        throw error;
      }
      return {
        client: {
          id: CLIENT_ID,
          name: 'Synthetic Client',
          normalized_mobile: '27821234001',
          date_of_birth: '1990-01-01',
          gender: 'female',
          profile_status: 'registered',
          mobile_verified_at: '2026-09-01T08:00:00.000Z',
          status: 'active',
        },
        appointments: [{
          id: APPOINTMENT_ID,
          starts_at: FUTURE_START.toISOString(),
          ends_at: FUTURE_END.toISOString(),
          status: 'confirmed',
          title: 'Synthetic Treatment',
          services: [{ name: 'Synthetic Treatment' }],
          staff: [{ name: 'Synthetic Practitioner' }],
        }],
        communications: state.syntheticSentEvidence ? [{
          id: 'synthetic-evidence-1',
          intent: 'booking_confirmation',
          label: 'Booking confirmation',
          statusLabel: 'Sent',
          occurredAt: '2026-09-02T11:00:00.000Z',
          appointmentId: APPOINTMENT_ID,
        }] : [],
        communicationsUnavailable: false,
        hasMore: false,
        historyOffset: 0,
        pageSize: 20,
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use((req, _res, next) => {
    state.requests.push({ method: req.method, path: req.path });
    next();
  });
  app.get('/proof/:identity', (req, res) => {
    const row = [...sessions.values()].find(item => item.key === req.params.identity);
    if (!row) return res.sendStatus(404);
    res.setHeader('Set-Cookie', serializeSessionCookie(row.token, { env }));
    return res.redirect(302, `/calendar/clients/${CLIENT_ID}`);
  });
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));

  const requireSession = requireStaffSession({ service: sessionService, env });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    if (!rotated.ok) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });

  app.use('/calendar/clients', createWorkspaceClientsRouter({
    env,
    sessionService,
    service: clientService,
    notificationService,
  }));
  app.use('/calendar/clients', createWorkspaceClientNotificationRouter({
    env,
    sessionService,
    service: notificationService,
  }));

  return { app, env, state };
}

function createCertificate(directory) {
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-days', '1',
  ], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(`OpenSSL test certificate failed: ${generated.stderr}`);
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function poll(load, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await load();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for authenticated Workspace notification proof state');
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    send(method, params = {}, timeoutMs = 15_000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome DevTools command timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome for authenticated Workspace client notification proof');
    console.log('Chrome not installed; authenticated Workspace client notification proof is CI-only.');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-workspace-notify-browser-'));
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { app, state } = createFixture();
  let server;
  let chrome;
  let cdp;
  try {
    server = https.createServer(createCertificate(directory), app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`;
    const debugPort = await reservePort();
    chrome = spawn(executable, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--ignore-certificate-errors', '--allow-insecure-localhost', '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(directory, 'profile')}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let browserErrors = '';
    chrome.stderr.on('data', chunk => { browserErrors = `${browserErrors}${String(chunk)}`.slice(-8_000); });
    const targets = await poll(
      async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(),
      items => Array.isArray(items) && items.some(item => item.type === 'page' && item.webSocketDebuggerUrl),
    ).catch(error => { throw new Error(`${error.message}\n${browserErrors}`); });
    cdp = await connectCdp(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
    const network = [];
    const dialogs = [];
    cdp.on('Network.requestWillBeSent', event => network.push({ method: event.request.method, url: event.request.url }));
    cdp.on('Page.javascriptDialogOpening', event => {
      dialogs.push({ type: event.type, message: event.message });
      cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    async function navigate(url) {
      await cdp.send('Page.navigate', { url });
      await poll(() => evaluate(cdp, 'document.readyState'), value => value === 'complete');
    }
    async function screenshot(name) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = `${name}.png`;
      const target = path.join(OUT_DIR, file);
      fs.writeFileSync(target, Buffer.from(shot.data, 'base64'));
      return { file, bytes: fs.statSync(target).size, sha256: fileSha256(target) };
    }

    await navigate(`${origin}/proof/lookupOnly`);
    await poll(() => evaluate(cdp, 'location.pathname'), value => value === `/calendar/clients/${CLIENT_ID}`);
    const lookupOnlyPage = await evaluate(cdp, `({
      hasPreviewLink:[...document.querySelectorAll('a')].some(a=>a.textContent.includes('Preview booking confirmation')),
      text:document.body.innerText
    })`);
    assert.equal(lookupOnlyPage.hasPreviewLink, false);
    assert.match(lookupOnlyPage.text, /My Shiloh updates/);
    assert.doesNotMatch(lookupOnlyPage.text, /Send booking confirmation|Additional capability required: client:notify/);
    const deniedPreview = await evaluate(cdp, `(async()=>{const r=await fetch('/calendar/clients/${CLIENT_ID}/booking-confirmation',{cache:'no-store'});return{status:r.status,text:await r.text()};})()`);
    assert.equal(deniedPreview.status, 403);
    assert.match(deniedPreview.text, /does not permit client notifications/i);
    const deniedSend = await evaluate(cdp, `(async()=>{
      const t=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      const token=(await t.json()).csrfToken;
      const r=await fetch('/calendar/clients/${CLIENT_ID}/booking-confirmation/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-shiloh-csrf-token':token},body:'{}'});
      return{status:r.status,body:await r.json()};
    })()`);
    assert.equal(deniedSend.status, 403);
    assert.equal(state.senderCalls, 0);
    const lookupOnlyShot = await screenshot('lookup-only-client-detail');

    await navigate(`${origin}/proof/authorized`);
    await poll(() => evaluate(cdp, 'location.pathname'), value => value === `/calendar/clients/${CLIENT_ID}`);
    const authorizedPage = await evaluate(cdp, `({
      hasPreviewLink:[...document.querySelectorAll('a')].some(a=>a.textContent.includes('Preview booking confirmation')),
      evidenceText:document.querySelector('[data-client-communications]')?.innerText||''
    })`);
    assert.equal(authorizedPage.hasPreviewLink, false, 'Retired transport control must remain absent even for notification-authorized staff');
    assert.match(authorizedPage.evidenceText, /No recorded Shiloh notifications yet/);
    // Historical injected transport fixture: exercise the existing authorization
    // boundary directly; the production client view has no transport action.
    await navigate(`${origin}/calendar/clients/${CLIENT_ID}/booking-confirmation`);
    await poll(() => evaluate(cdp, 'location.pathname'), value => value.endsWith('/booking-confirmation'));
    await poll(() => evaluate(cdp, 'document.readyState'), value => value === 'complete');
    const previewState = await evaluate(cdp, `({
      hasSendButton:!!document.querySelector('[data-send-booking-confirmation]'),
      body:document.body.innerText,
      rawMeta:/template[_ -]?id|phone[_ -]?number[_ -]?id|whatsapp[_ -]?token/i.test(document.body.innerText)
    })`);
    assert.equal(previewState.hasSendButton, true);
    assert.equal(previewState.rawMeta, false);
    assert.match(previewState.body, /Synthetic Treatment/);
    assert.match(previewState.body, /Nothing is sent until you press the button and confirm/);
    assert.equal(state.senderCalls, 0, 'preview must be non-mutating');
    const previewShot = await screenshot('authorized-booking-confirmation-preview');

    await evaluate(cdp, `document.querySelector('[data-send-booking-confirmation]').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('[data-shiloh-confirm]')?.open`), Boolean);
    assert.equal(state.senderCalls, 0, 'opening the branded confirmation is non-mutating');
    await evaluate(cdp, `document.querySelector('[data-shiloh-confirm-action]').click();true`);
    await poll(() => state.senderCalls, value => value === 1);
    assert.deepEqual(dialogs, [], 'no native browser confirmation');
    assert.equal(state.syntheticSentEvidence, true);
    await navigate(`${origin}/calendar/clients/${CLIENT_ID}/booking-confirmation`);
    const afterSend = await evaluate(cdp, `({
      hasSendButton:!!document.querySelector('[data-send-booking-confirmation]'),
      body:document.body.innerText
    })`);
    assert.equal(afterSend.hasSendButton, false);
    assert.match(afterSend.body, /already recorded as sent/i);
    const afterSendShot = await screenshot('authorized-after-synthetic-evidence');

    await navigate(`${origin}/calendar/clients/${CLIENT_ID}`);
    const detailAfterSend = await evaluate(cdp, `({body:document.querySelector('[data-client-communications]')?.innerText||''})`);
    assert.match(detailAfterSend.body, /Booking confirmation/);
    assert.match(detailAfterSend.body, /Sent/);

    const cookies = (await cdp.send('Network.getAllCookies')).cookies;
    const sessionCookie = cookies.find(cookie => cookie.name === '__Host-shiloh_staff_session');
    assert.ok(sessionCookie);
    assert.equal(sessionCookie.secure, true);
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.sameSite, 'Strict');
    assert.equal(sessionCookie.path, '/');

    const unexpectedExternal = network.filter(item => {
      try {
        const url = new URL(item.url);
        return url.origin !== origin && !url.hostname.startsWith('127.0.0.1');
      } catch (_error) {
        return false;
      }
    });
    assert.deepEqual(unexpectedExternal, []);
    assert.equal(state.providerNetworkCalls, 0);
    assert.equal(state.senderCalls, 1);
    assert.ok(state.providerGuardCalls >= 2);

    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.match(exactHead, /^[0-9a-f]{40}$/);
    const manifest = {
      generatedAt: new Date().toISOString(),
      exactHead,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerNetworkCalls: state.providerNetworkCalls,
      realClientSends: 0,
      syntheticSenderCalls: state.senderCalls,
      unauthorizedPreviewStatus: deniedPreview.status,
      unauthorizedSendStatus: deniedSend.status,
      previewNonMutating: true,
      evidenceAfterSyntheticSend: state.syntheticSentEvidence,
      sessionCookie: { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' },
      screenshots: [lookupOnlyShot, previewShot, afterSendShot],
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Authenticated Workspace client notification proof passed at ${exactHead}`);
    console.log(JSON.stringify(manifest));
  } finally {
    if (cdp) cdp.close();
    if (chrome && !chrome.killed) chrome.kill('SIGTERM');
    if (server) await new Promise(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
