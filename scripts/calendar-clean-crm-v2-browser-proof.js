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
const { createCalendarCreateBookingRouter } = require('../src/routes/calendarCreateBooking');
const { sha256 } = require('../src/services/staffBrowserSession');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-clean-crm-v2-browser-proof');
const DATE = '2026-09-03';

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find((candidate) => candidate && fs.existsSync(candidate)) || null;
}
function opaque(value) { return crypto.createHash('sha256').update(String(value)).digest('base64url'); }
function fileSha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function createFixture() {
  const env = { NODE_ENV: 'production' };
  const token = opaque('crm-v2-calendar-browser-session');
  const session = { sessionId: 1526, adminId: 71, csrfToken: opaque('csrf:0'), rotations: 0 };
  session.csrfHash = sha256(session.csrfToken);
  const state = { requests: [], browses: [], searches: [], prepares: [], confirmations: [], canonicalReloads: 0 };
  const sessionService = {
    async validateSessionToken(supplied) {
      if (supplied !== token) return { ok: false };
      return { ok: true, sessionId: session.sessionId, adminId: session.adminId, csrfHash: session.csrfHash, recoveryRequired: false };
    },
    async rotateCsrfToken(id) {
      if (Number(id) !== session.sessionId) return { ok: false };
      session.rotations += 1;
      session.csrfToken = opaque(`csrf:${session.rotations}`);
      session.csrfHash = sha256(session.csrfToken);
      return { ok: true, csrfToken: session.csrfToken, csrfHash: session.csrfHash };
    },
    validateCsrfToken(validated, supplied) {
      return Boolean(validated?.ok && supplied && sha256(supplied) === validated.csrfHash);
    },
  };
  const selectedClient = {
    id: '912', displayName: 'Synthetic Existing Client', status: 'active', profileStatus: 'minimal', contactHint: 'ending in 4567',
  };
  const clientDirectory = {
    async listActiveClients(limit) {
      state.browses.push({ limit });
      return {
        clients: [selectedClient, { ...selectedClient, id: '913', displayName: 'Synthetic Similar Name', contactHint: 'ending in 9876' }],
        requiresExplicitSelection: true,
        ambiguous: true,
        identityModel: 'crm_v2_operator_browse_only',
      };
    },
  };
  const bookingService = {
    async resolveOperator(adminId) {
      assert.equal(Number(adminId), 71);
      return { id: 71, display_name: 'Christel' };
    },
    async listBookableOptions(adminId) {
      assert.equal(Number(adminId), 71);
      return {
        staff: [{ id: 9, displayName: 'Christel', serviceIds: [44] }],
        services: [{
          id: 44, name: 'Cupping Area Specific', categoryName: 'Massage',
          externalSource: 'goldie', externalId: '409ef0e8-2063-47b2-86db-ca0af30787de',
          durationMinutes: 60, price: 500, variablePrice: false, staffIds: [9],
        }],
        authority: { operatorAdminId: 71, serviceScope: 'all_business:all_services' },
      };
    },
    async searchClients(adminId, query) {
      state.searches.push({ adminId, query });
      return {
        clients: [selectedClient, { ...selectedClient, id: '913', displayName: 'Synthetic Similar Name', contactHint: 'ending in 9876' }],
        requiresExplicitSelection: true,
        ambiguous: true,
        identityModel: 'crm_v2_operator_search_only',
      };
    },
    async prepare(payload) {
      state.prepares.push(structuredClone(payload));
      const isNew = Boolean(payload.newClient);
      return {
        status: 'pending_confirmation',
        review: {
          client: {
            id: isNew ? '914' : String(payload.clientId),
            displayName: isNew ? payload.newClient.name : selectedClient.displayName,
            created: isNew,
            matchedExisting: false,
            profileStatus: 'minimal',
            contactHint: isNew ? 'ending in 4321' : 'ending in 4567',
            mobile: isNew ? '+27820004321' : '+27821234567',
          },
          service: {
            id: 44, name: 'Cupping Area Specific', categoryName: 'Massage',
            externalSource: 'goldie', externalId: '409ef0e8-2063-47b2-86db-ca0af30787de',
          },
          practitioner: { id: 9, displayName: 'Christel' },
          startsAt: '2026-09-03T08:00:00.000Z',
          endsAt: '2026-09-03T09:00:00.000Z',
          durationMinutes: 60,
          price: 'R500.00',
        },
      };
    },
    async discard(payload) { return { status: 'discarded', adminId: payload.adminId, crmV2ClientRemoved: false }; },
    async confirm(payload) {
      state.confirmations.push(structuredClone(payload));
      return {
        status: 'created', appointmentId: 99001,
        customerConfirmation: { sent: true, deliveryStatus: 'sent' },
        customerConfirmationObligation: { queued: true, status: 'pending', identityModel: 'crm_v2' },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use((req, _res, next) => {
    state.requests.push({ method: req.method, path: req.path, body: structuredClone(req.body || {}) });
    next();
  });
  app.get('/proof', (_req, res) => {
    res.setHeader('Set-Cookie', serializeSessionCookie(token, { env }));
    return res.redirect(302, `/calendar/book?date=${DATE}`);
  });
  const requireSession = requireStaffSession({ service: sessionService, env });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });
  app.get('/calendar/read-only', (_req, res) => {
    state.canonicalReloads += 1;
    return res.status(200).type('html').send('<!doctype html><title>Canonical Calendar</title><h1>Canonical Calendar refreshed</h1>');
  });
  app.use('/calendar/book', createCalendarCreateBookingRouter({ env, sessionService, bookingService, clientDirectory }));
  return { app, state };
}

function certificate(directory) {
  const key = path.join(directory, 'key.pem');
  const cert = path.join(directory, 'cert.pem');
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-days', '1'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}
async function poll(load, accept, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await load(); if (accept(value)) return value; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (last) throw last;
  throw new Error('Browser proof timed out');
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    send(method, params = {}) {
      const callId = id++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
        pending.set(callId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: callId, method, params }));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome for Calendar CRM V2 browser proof');
    console.log('Chrome not installed; Calendar CRM V2 browser proof is CI-only.');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-calendar-crm-v2-'));
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { app, state } = createFixture();
  let server; let chrome; let cdp;
  try {
    server = https.createServer(certificate(temporary), app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`;
    const debugPort = await reservePort();
    chrome = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--allow-insecure-localhost', '--remote-allow-origins=*', '--window-size=1440,1000', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const targets = await poll(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(), (items) => items?.some((item) => item.type === 'page' && item.webSocketDebuggerUrl));
    cdp = await connectCdp(targets.find((item) => item.type === 'page').webSocketDebuggerUrl);
    const network = [];
    const exceptions = [];
    cdp.on('Network.requestWillBeSent', (event) => network.push(event.request.url));
    cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    async function navigate() {
      await cdp.send('Page.navigate', { url: `${origin}/proof` });
      await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
      await poll(() => evaluate(cdp, 'location.pathname'), (value) => value === '/calendar/book');
    }
    async function screenshot(name) {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = `${name}.png`;
      const target = path.join(OUT_DIR, file);
      fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
      return { file, bytes: fs.statSync(target).size, sha256: fileSha256(target) };
    }
    async function chooseSlot() {
      await evaluate(cdp, `(()=>{const date=document.querySelector('#booking-date');date.value='2026-09-03';date.dispatchEvent(new Event('input',{bubbles:true}));const time=document.querySelector('#booking-time');time.value='10:00';time.dispatchEvent(new Event('input',{bubbles:true}));const service=document.querySelector('#service-select');service.value='44';service.dispatchEvent(new Event('change',{bubbles:true}));const staff=document.querySelector('#staff-select');staff.value='9';staff.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    }
    async function prepareDirect() {
      const before = state.prepares.length;
      await evaluate(cdp, `document.querySelector('[data-review-booking]').click();true`);
      await poll(() => state.prepares.length, (value) => value > before);
      await poll(() => evaluate(cdp, `!document.querySelector('[data-review-panel]').hidden`), Boolean);
      await poll(() => evaluate(cdp, `!document.querySelector('[data-create-booking]').disabled`), Boolean);
    }

    const screenshots = [];
    await navigate();
    await poll(() => state.browses.length, (value) => value === 1);
    await poll(() => evaluate(cdp, `document.querySelectorAll('.client-result').length`), (value) => value === 2);
    const surface = await evaluate(cdp, `({
      choices:[...document.querySelectorAll('[data-client-mode-existing],[data-client-mode-search],[data-client-mode-new]')].map(e=>e.textContent.trim()),
      hasAck:Boolean(document.querySelector('[data-mobile-ack-panel],[data-mobile-ack-check],[data-acknowledge-mobile]')),
      hasInternalJargon:/CRM V2|canonical client|guarded canonical write|review before write/i.test(document.body.innerText),
      cookieVisible:document.cookie,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    })`);
    assert.deepEqual(surface.choices, ['Existing clients', 'Search clients', 'Add new client']);
    assert.equal(surface.hasAck, false);
    assert.equal(surface.hasInternalJargon, false);
    assert.equal(surface.cookieVisible, '');
    assert.ok(surface.overflow <= 1);
    assert.equal(state.prepares.length, 0, 'client browse must not auto-select or prepare');

    const missingReview = await evaluate(cdp, `(()=>{const button=document.querySelector('[data-review-booking]');button.click();const status=document.querySelector('[data-booking-status]');return{enabled:!button.disabled,message:status.textContent.trim(),error:status.classList.contains('error')};})()`);
    assert.equal(missingReview.enabled, true);
    assert.equal(missingReview.message, 'Choose Find client or New client and complete that selection first.');
    assert.equal(missingReview.error, true);
    assert.equal(state.prepares.length, 0, 'missing-field feedback must not call prepare');

    await evaluate(cdp, `document.querySelectorAll('.client-result')[0].click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('[data-booking-status]').hidden`), Boolean);
    const restoredStatus = await evaluate(cdp, `(()=>{const button=document.querySelector('[data-review-booking]');button.click();const status=document.querySelector('[data-booking-status]');return{hidden:status.hidden,message:status.textContent.trim(),error:status.classList.contains('error')};})()`);
    assert.equal(restoredStatus.hidden, false);
    assert.equal(restoredStatus.message, 'Choose a start time.');
    assert.equal(restoredStatus.error, true);
    assert.equal(state.prepares.length, 0, 'visible missing-field feedback must not call prepare');
    await chooseSlot();
    await prepareDirect();
    const existingReview = await evaluate(cdp, `({
      review:document.querySelector('[data-review]').innerText,
      createEnabled:!document.querySelector('[data-create-booking]').disabled,
      family:document.querySelector('[data-review] [data-service-family]')?.getAttribute('data-service-family')
    })`);
    assert.match(existingReview.review, /Synthetic Existing Client/);
    assert.match(existingReview.review, /\+27821234567/);
    assert.match(existingReview.review, /Cupping Area Specific/);
    assert.equal(existingReview.createEnabled, true);
    assert.equal(existingReview.family, 'targeted_therapeutic');
    screenshots.push({ state: 'existing-client-direct-review', ...(await screenshot('existing-client-direct-review')) });

    const beforeConfirm = state.confirmations.length;
    await evaluate(cdp, `document.querySelector('[data-create-booking]').click();true`);
    await poll(() => state.confirmations.length, (value) => value > beforeConfirm);
    await poll(() => evaluate(cdp, 'location.pathname'), (value) => value === '/calendar/read-only');
    assert.equal(await evaluate(cdp, 'location.search'), `?view=week&date=${DATE}&staff=all`);
    assert.deepEqual(state.confirmations.at(-1), { adminId: 71, notes: '' });
    assert.equal(state.canonicalReloads, 1);

    await navigate();
    await evaluate(cdp, `document.querySelector('[data-client-mode-new]').click();true`);
    await evaluate(cdp, `(()=>{document.querySelector('#new-client-name').value='Synthetic New Client';document.querySelector('#new-client-mobile').value='082 000 4321';document.querySelector('[data-select-new-client]').click();return true;})()`);
    await chooseSlot();
    await prepareDirect();
    const newReview = await evaluate(cdp, `document.querySelector('[data-review]').innerText`);
    assert.match(newReview, /Synthetic New Client/);
    assert.match(newReview, /New client created/);
    assert.match(newReview, /\+27820004321/);
    screenshots.push({ state: 'new-client-direct-review', ...(await screenshot('new-client-direct-review')) });

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobile = await evaluate(cdp, `(()=>{const controls=[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length>0);return{count:controls.length,minHeight:Math.min(...controls.map(e=>e.getBoundingClientRect().height)),overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,createEnabled:!document.querySelector('[data-create-booking]').disabled};})()`);
    assert.ok(mobile.count > 0);
    assert.ok(mobile.minHeight >= 44);
    assert.ok(mobile.overflow <= 1);
    assert.equal(mobile.createEnabled, true);
    screenshots.push({ state: 'new-client-mobile-direct-review', ...(await screenshot('new-client-mobile-direct-review')) });

    const acknowledgementRequests = state.requests.filter((item) => item.path === '/calendar/book/mobile-acknowledgement');
    assert.equal(acknowledgementRequests.length, 0);
    const confirmRequests = state.requests.filter((item) => item.path === '/calendar/book/confirm');
    assert.equal(confirmRequests.length, 1);
    assert.deepEqual(confirmRequests[0].body, { notes: '' });
    assert.equal(exceptions.length, 0);
    assert.equal(network.some((url) => /google|whatsapp|provider|meta/i.test(url)), false);

    const checkedOutHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.match(checkedOutHead, /^[0-9a-f]{40}$/);
    const manifest = {
      generatedAt: new Date().toISOString(),
      exactHead: checkedOutHead,
      environment: 'ephemeral HTTPS + authenticated synthetic staff session + system Chromium',
      clientSurface: surface.choices,
      explicitSelection: true,
      directReview: { exactMobileVisible: true, acknowledgementCeremonyPresent: false, createEnabledAfterPrepare: true },
      finalConfirmation: { authenticatedActorAdminId: 71, browserIdentityFieldsSubmitted: 0, canonicalCalendarReloads: state.canonicalReloads },
      externalProviderRequests: false,
      screenshots,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Calendar Clean CRM V2 direct-confirm browser proof PASS: ${screenshots.length} screenshots; exact head ${checkedOutHead}`);
  } finally {
    if (cdp) cdp.close();
    if (chrome) {
      chrome.kill('SIGTERM');
      await Promise.race([once(chrome, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      if (chrome.exitCode == null) chrome.kill('SIGKILL');
    }
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });