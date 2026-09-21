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
  createOptionalCalendarSessionMiddleware,
  requireStaffSession,
  sameOriginGuard,
  serializeSessionCookie,
} = require('../src/middleware/staffBrowserSession');
const { createCalendarReadOnlyRouter } = require('../src/routes/calendarReadOnlyUx');
const { createCalendarOperationalMutationRouter } = require('../src/routes/calendarOperationalMutations');
const { staticMutationCapability, OPERATIONS } = require('../src/services/calendarOperationalMutations');
const {
  CALENDAR_CAPABILITIES,
  evaluateCalendarAuthority,
  hasCapability,
} = require('../src/services/calendarAuthorization');
const { sha256 } = require('../src/services/staffBrowserSession');

const DATE = '2026-09-03';
const REVISION = '2026-08-27T05:00:00.000Z';
const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-operational-mutations-browser-proof');

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function opaque(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function admin(overrides = {}) {
  return {
    id: 71,
    staff_id: 1,
    display_name: 'Christel',
    business_role: 'owner',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: {
      [CALENDAR_CAPABILITIES.VIEW]: true,
      [CALENDAR_CAPABILITIES.BOOKING_CREATE]: true,
      [CALENDAR_CAPABILITIES.CLIENT_LOOKUP]: true,
      [CALENDAR_CAPABILITIES.BOOKING_RESCHEDULE]: true,
      [CALENDAR_CAPABILITIES.BOOKING_CANCEL]: true,
      [CALENDAR_CAPABILITIES.BOOKING_REASSIGN]: true,
      [CALENDAR_CAPABILITIES.SCHEDULE_MANAGE]: true,
    },
    allowedServiceIds: null,
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

const ADMINS = Object.freeze({
  christel: admin(),
  abigail: admin({
    id: 72, staff_id: 2, display_name: 'Abigail', business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments', service_scope: 'own_services', allowedServiceIds: [901],
    permissions: { [CALENDAR_CAPABILITIES.VIEW]: true, [CALENDAR_CAPABILITIES.CLIENT_LOOKUP]: true },
  }),
  marietjie: admin({
    id: 73, staff_id: 3, display_name: 'Marietjie', business_role: 'tenant_practitioner',
    calendar_scope: 'own_services', service_scope: 'own_services', allowedServiceIds: [901],
  }),
  jp: admin({ id: 74, staff_id: null, staff_status: null, display_name: 'Jean-Pierre', business_role: 'business_admin' }),
  naomi: admin({
    id: 75, staff_id: null, staff_status: null, display_name: 'Naomi', business_role: 'booking_operator',
    permissions: {
      [CALENDAR_CAPABILITIES.VIEW]: true,
      [CALENDAR_CAPABILITIES.BOOKING_CREATE]: true,
      [CALENDAR_CAPABILITIES.CLIENT_LOOKUP]: true,
      [CALENDAR_CAPABILITIES.BOOKING_RESCHEDULE]: true,
      [CALENDAR_CAPABILITIES.BOOKING_CANCEL]: true,
      [CALENDAR_CAPABILITIES.BOOKING_REASSIGN]: true,
    },
  }),
  ineligible: admin({
    id: 76, staff_id: 4, display_name: 'Unrelated Operator', business_role: 'employee_practitioner',
    calendar_scope: 'own_appointments', service_scope: 'own_services', allowedServiceIds: [901], permissions: {},
  }),
});

function dayModel() {
  const appointment = {
    kind: 'appointment', canonical: true, id: 7001, revision: REVISION,
    startsAt: '2026-09-03T06:00:00.000Z', endsAt: '2026-09-03T06:45:00.000Z', status: 'scheduled',
    clientName: 'Synthetic Client', serviceName: 'Synthetic Treatment', staffIds: [1],
    serviceContexts: [{ serviceId: 901, serviceName: 'Synthetic Treatment' }],
  };
  const block = {
    kind: 'calendar_block', canonical: true, id: 7101, revision: REVISION,
    startsAt: '2026-09-03T08:00:00.000Z', endsAt: '2026-09-03T09:00:00.000Z',
    staffIds: [1], blockType: 'other', title: 'Synthetic admin block', source: 'shiloh',
  };
  const operationalLeave = {
    kind: 'operational_leave', canonical: true, id: 7201, revision: REVISION,
    date: DATE, allDay: true, staffIds: [1], reason: 'Synthetic training leave',
  };
  const approvedLeave = {
    kind: 'approved_leave', canonical: true, id: 7202, revision: REVISION,
    date: DATE, allDay: true, staffIds: [2], reason: 'Synthetic approved leave',
  };
  const staff = [
    { id: 1, displayName: 'Christel' },
    { id: 2, displayName: 'Abigail' },
    { id: 3, displayName: 'Marietjie' },
  ];
  return {
    view: 'day', dateKey: DATE, selectedStaffId: null, readOnly: true,
    period: { dateKeys: [DATE], startKey: DATE, previousAnchor: '2026-09-02', nextAnchor: '2026-09-04' },
    permittedStaff: staff,
    timeline: {
      staff,
      workingWindows: staff.map((person) => ({ staffId: person.id, dayOfWeek: 4, startsLocal: '08:00', endsLocal: '17:00' })),
      scheduleExceptions: [], recurringClosures: [], appointments: [appointment], blocks: [block],
      leave: [operationalLeave, approvedLeave], closures: [], externalBusy: [],
      events: [appointment, block, operationalLeave, approvedLeave],
    },
  };
}

function createFixture() {
  const env = {
    NODE_ENV: 'production',
    SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  };
  const sessions = new Map();
  const byId = new Map();
  for (const [key, operator] of Object.entries(ADMINS)) {
    const token = opaque(`session:${key}`);
    const csrfToken = opaque(`csrf:${key}:0`);
    const row = {
      key, token, csrfToken, csrfHash: sha256(csrfToken), sessionId: operator.id + 1000,
      operator, rotations: 0,
    };
    sessions.set(token, row);
    byId.set(row.sessionId, row);
  }
  const state = { operations: [], customerNotifications: [], requests: [], renders: new Map(), sessions };
  const sessionService = {
    async validateSessionToken(token) {
      const row = sessions.get(String(token || ''));
      if (!row) return { ok: false };
      return {
        ok: true, sessionId: row.sessionId, adminId: row.operator.id, csrfHash: row.csrfHash,
        recoveryRequired: false,
        viewer: { calendarScope: 'business_all_staff', operatorAdminId: row.operator.id },
      };
    },
    async rotateCsrfToken(sessionId) {
      const row = byId.get(Number(sessionId));
      if (!row) return { ok: false };
      row.rotations += 1;
      row.csrfToken = opaque(`csrf:${row.key}:${row.rotations}`);
      row.csrfHash = sha256(row.csrfToken);
      return { ok: true, csrfToken: row.csrfToken, csrfHash: row.csrfHash };
    },
    validateCsrfToken(session, supplied) {
      return Boolean(session?.ok && supplied && sha256(supplied) === session.csrfHash);
    },
  };

  function operatorFor(adminId) {
    return Object.values(ADMINS).find((item) => Number(item.id) === Number(adminId)) || null;
  }
  function resolvedOperator(adminId) {
    const row = operatorFor(adminId);
    const capability = staticMutationCapability(row || {}, { allowedServiceIds: row?.allowedServiceIds || [] });
    if (!row || !capability) {
      const error = new Error('Current canonical staff authority does not permit Calendar operations.');
      error.code = 'CALENDAR_OPERATION_FORBIDDEN';
      throw error;
    }
    return { ...row, mutationCapability: capability };
  }
  function resolvedBookingOperator(adminId) {
    const row = operatorFor(adminId);
    const authority = evaluateCalendarAuthority(row || {}, { allowedServiceIds: row?.allowedServiceIds || [] });
    if (
      !row
      || !authority
      || !hasCapability(authority, CALENDAR_CAPABILITIES.BOOKING_CREATE)
      || !hasCapability(authority, CALENDAR_CAPABILITIES.CLIENT_LOOKUP)
    ) {
      const error = new Error('Current canonical staff authority does not permit Calendar booking.');
      error.code = 'CALENDAR_BOOKING_FORBIDDEN';
      throw error;
    }
    return { ...row, calendarAuthority: authority };
  }
  function record(type, payload) {
    const entry = { type, ...payload };
    state.operations.push(entry);
    return entry;
  }
  function authorizedRecord(type, operation, payload) {
    const operator = resolvedOperator(payload.adminId);
    if (!operator.mutationCapability.operations.includes(operation)) {
      const error = new Error('Current canonical staff authority does not permit this Calendar operation.');
      error.code = 'CALENDAR_OPERATION_FORBIDDEN';
      throw error;
    }
    return record(type, payload);
  }
  const mutationService = {
    async resolveOperator(adminId) { return resolvedOperator(adminId); },
    async getScheduleState(adminId, payload) {
      authorizedRecord('schedule-read', 'working_schedule:manage', { adminId, ...payload });
      return { mode: 'window', revision: opaque('schedule-revision'), windows: [{ startsLocal: '08:00', endsLocal: '17:00' }] };
    },
    async reschedule(payload) { authorizedRecord('reschedule', 'appointment:reschedule', payload); return { status: 'rescheduled', appointmentId: Number(payload.appointmentId) }; },
    async reassign(payload) { authorizedRecord('reassign', 'appointment:reassign', payload); return { status: 'reassigned', appointmentId: Number(payload.appointmentId) }; },
    async cancel(payload) { authorizedRecord('cancel', 'appointment:cancel', payload); return { status: 'cancelled', appointmentId: Number(payload.appointmentId) }; },
    async createBlock(payload) { authorizedRecord('block-create', 'calendar_block:manage', payload); return { status: 'created', blockId: 7301 }; },
    async editBlock(payload) { authorizedRecord('block-edit', 'calendar_block:manage', payload); return { status: 'updated', blockId: Number(payload.blockId) }; },
    async removeBlock(payload) { authorizedRecord('block-remove', 'calendar_block:manage', payload); return { status: 'removed', blockId: Number(payload.blockId) }; },
    async createLeave(payload) { authorizedRecord('leave-create', 'operational_leave:manage', payload); return { status: 'created', leaveId: 7401 }; },
    async editLeave(payload) { authorizedRecord('leave-edit', 'operational_leave:manage', payload); return { status: 'updated', leaveId: Number(payload.leaveId) }; },
    async removeLeave(payload) { authorizedRecord('leave-remove', 'operational_leave:manage', payload); return { status: 'removed', leaveId: Number(payload.leaveId) }; },
    async setWorkingSchedule(payload) { authorizedRecord('schedule-write', 'working_schedule:manage', payload); return { status: 'updated', mode: payload.mode }; },
  };

  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use((req, _res, next) => {
    state.requests.push({ method: req.method, path: req.path });
    next();
  });
  app.get('/proof/:identity', (req, res) => {
    const row = [...sessions.values()].find((item) => item.key === req.params.identity);
    if (!row) return res.sendStatus(404);
    res.setHeader('Set-Cookie', serializeSessionCookie(row.token, { env }));
    return res.redirect(302, `/calendar/read-only?view=day&date=${DATE}`);
  });
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));

  const requireSession = requireStaffSession({ service: sessionService, env });
  app.post('/calendar/staff-auth/csrf', sameOriginGuard({ env }), requireSession, async (req, res) => {
    const rotated = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
    if (!rotated.ok) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ csrfToken: rotated.csrfToken });
  });
  app.use('/calendar/operations', createCalendarOperationalMutationRouter({
    env,
    sessionService,
    mutationService,
    customerChangeNotificationService: {
      async queueCustomerChangeNotification(appointmentId, changeKind) {
        state.customerNotifications.push({ appointmentId, changeKind });
        return { queued: true };
      },
    },
  }));
  app.use(
    '/calendar/read-only',
    createOptionalCalendarSessionMiddleware({ service: sessionService, env }),
    createCalendarReadOnlyRouter({
      env,
      mutationService,
      bookingService: {
        async resolveOperator(adminId) { return resolvedBookingOperator(adminId); },
      },
      async buildModel({ viewer }) {
        const adminId = Number(viewer.operatorAdminId);
        state.renders.set(adminId, Number(state.renders.get(adminId) || 0) + 1);
        return dayModel();
      },
    }),
  );
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
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function poll(load, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await load();
      if (accept(value)) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for authenticated browser proof state');
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
  socket.addEventListener('message', (event) => {
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

function js(value) {
  return JSON.stringify(value);
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome for authenticated Calendar mutation proof');
    console.log('Chrome not installed; authenticated Calendar mutation proof is CI-only.');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-calendar-operations-browser-'));
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
    chrome.stderr.on('data', (chunk) => { browserErrors = `${browserErrors}${String(chunk)}`.slice(-8_000); });
    const targets = await poll(
      async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(),
      (items) => Array.isArray(items) && items.some((item) => item.type === 'page' && item.webSocketDebuggerUrl),
    ).catch((error) => { throw new Error(`${error.message}\n${browserErrors}`); });
    cdp = await connectCdp(targets.find((item) => item.type === 'page').webSocketDebuggerUrl);
    const network = [];
    const exceptions = [];
    let dialogPlan = [];
    const dialogs = [];
    const dialogErrors = [];
    cdp.on('Network.requestWillBeSent', (event) => network.push({ method: event.request.method, url: event.request.url }));
    cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    cdp.on('Page.javascriptDialogOpening', (event) => {
      const expected = dialogPlan.shift();
      dialogs.push({ type: event.type, message: event.message });
      if (!expected) {
        dialogErrors.push(`Unexpected ${event.type} dialog: ${event.message}`);
        cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch((error) => dialogErrors.push(error.message));
        return;
      }
      if (expected.type && expected.type !== event.type) dialogErrors.push(`Expected ${expected.type}, saw ${event.type}: ${event.message}`);
      if (expected.includes && !event.message.includes(expected.includes)) dialogErrors.push(`Dialog did not include ${expected.includes}: ${event.message}`);
      cdp.send('Page.handleJavaScriptDialog', {
        accept: expected.accept !== false,
        ...(event.type === 'prompt' ? { promptText: expected.text || '' } : {}),
      }).catch((error) => dialogErrors.push(error.message));
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    async function navigate(identity) {
      await cdp.send('Page.navigate', { url: `${origin}/proof/${identity}` });
      await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
      await poll(() => evaluate(cdp, 'location.pathname'), (value) => value === '/calendar/read-only');
    }
    async function snapshot(identity) {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = `${identity}.png`;
      fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(result.data, 'base64'));
      return { file, bytes: fs.statSync(path.join(OUT_DIR, file)).size, sha256: fileSha256(path.join(OUT_DIR, file)) };
    }
    async function operation(selector, plan, expectedType, adminId = 71) {
      const beforeOperations = state.operations.length;
      const beforeRenders = Number(state.renders.get(adminId) || 0);
      dialogPlan = plan.map((item) => ({ type: 'prompt', ...item }));
      await evaluate(cdp, `document.querySelector(${js(selector)}).click();true`);
      await poll(
        () => state.operations.slice(beforeOperations),
        (items) => items.some((item) => item.type === expectedType),
      );
      assert.equal(state.operations.slice(beforeOperations).at(-1).type, expectedType);
      await poll(() => Number(state.renders.get(adminId) || 0), (value) => value > beforeRenders);
      await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
      assert.deepEqual(dialogPlan, []);
    }
    async function panelOperation(action, setup, expectedType, adminId = 71) {
      const beforeOperations = state.operations.length;
      const beforeRenders = Number(state.renders.get(adminId) || 0);
      await evaluate(cdp, `(()=>{document.querySelector('[data-appointment-management-target="true"]').click();const form=document.querySelector('[data-panel-action="${action}"]');${setup};form.requestSubmit();return true;})()`);
      await poll(() => state.operations.slice(beforeOperations), (items) => items.some((item) => item.type === expectedType));
      assert.equal(state.operations.slice(beforeOperations).at(-1).type, expectedType);
      await poll(() => Number(state.renders.get(adminId) || 0), (value) => value > beforeRenders);
      await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
    }

    const screenshots = [];
    const operatorProof = [];
    for (const [identity, expectedName, expectedOperations, minimumControls] of [
      ['christel', 'Christel', OPERATIONS, 8],
      ['marietjie', 'Marietjie', OPERATIONS, 4],
      ['naomi', 'Naomi', OPERATIONS.slice(0, 3), 1],
      ['jp', 'Jean-Pierre', OPERATIONS, 8],
    ]) {
      await navigate(identity);
      const page = await evaluate(cdp, `({
        controls:document.querySelectorAll('[data-calendar-operation],[data-appointment-management-target="true"]').length,
        draggable:document.querySelectorAll('[data-appointment-id][draggable="true"]').length,
        readOnly:document.body.dataset.calendarReadonly,
        hasGoogle:/google/i.test(document.body.innerText),
        hasCreateBooking:document.querySelector('a[aria-label="Create booking"]')!==null,
        hasApprovedLeaveControl:document.querySelector('[data-leave-id="7202"]')!==null
      })`);
      assert.equal(page.readOnly, 'false');
      assert.ok(page.controls >= minimumControls, `${expectedName} must see the intended scoped operation set`);
      assert.equal(page.draggable, 1);
      assert.equal(page.hasGoogle, false);
      assert.equal(page.hasCreateBooking, true);
      assert.equal(page.hasApprovedLeaveControl, false);
      const capability = await evaluate(cdp, `(async()=>{const r=await fetch('/calendar/operations/capability',{cache:'no-store'});return{status:r.status,body:await r.json()};})()`);
      assert.equal(capability.status, 200);
      assert.deepEqual(capability.body.capability.operations, expectedOperations);
      const cookies = (await cdp.send('Network.getAllCookies')).cookies;
      const sessionCookie = cookies.find((cookie) => cookie.name === '__Host-shiloh_staff_session');
      assert.ok(sessionCookie);
      assert.equal(sessionCookie.secure, true);
      assert.equal(sessionCookie.httpOnly, true);
      assert.equal(sessionCookie.sameSite, 'Strict');
      assert.equal(sessionCookie.path, '/');
      screenshots.push({ identity, ...(await snapshot(identity)) });
      operatorProof.push({
        identity: expectedName,
        adminId: ADMINS[identity].id,
        controls: page.controls,
        operations: capability.body.capability.operations,
        sessionCookie: { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' },
      });
    }
    assert.ok(operatorProof.find((item) => item.identity === 'Naomi').controls < operatorProof.find((item) => item.identity === 'Christel').controls);

    await navigate('christel');
    await panelOperation('appointment:reschedule', `form.elements.date.value='2026-09-04';form.elements.time.value='10:00'`, 'reschedule');
    const manualPath = state.requests.filter((item) => item.path.endsWith('/reschedule')).at(-1);
    assert.deepEqual(manualPath, { method: 'POST', path: '/calendar/operations/appointments/7001/reschedule' });

    const beforeDrag = state.operations.length;
    const beforeDragRender = Number(state.renders.get(71));
    dialogPlan = [{ type: 'prompt', text: '11:00', includes: 'Exact new start time' }];
    await evaluate(cdp, `(()=>{const card=document.querySelector('[data-appointment-id="7001"]');const target=document.querySelector('[data-calendar-drop-target]');const transfer=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));return true;})()`);
    await poll(() => state.operations.length, (value) => value > beforeDrag);
    assert.equal(state.operations.at(-1).type, 'reschedule');
    await poll(() => Number(state.renders.get(71)), (value) => value > beforeDragRender);
    assert.deepEqual(dialogPlan, []);
    const reschedulePaths = state.requests.filter((item) => item.path.endsWith('/reschedule'));
    assert.equal(reschedulePaths.length, 2);
    assert.equal(new Set(reschedulePaths.map((item) => `${item.method} ${item.path}`)).size, 1);
    assert.deepEqual(state.customerNotifications, [
      { appointmentId: 7001, changeKind: 'time' },
      { appointmentId: 7001, changeKind: 'time' },
    ]);

    await panelOperation('appointment:reassign', `form.elements.destinationStaffId.value='2'`, 'reassign');

    const beforeDecline = state.operations.length;
    await evaluate(cdp, `(()=>{document.querySelector('[data-appointment-management-target="true"]').click();const form=document.querySelector('[data-panel-action="appointment:cancel"]');form.requestSubmit();return true;})()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(state.operations.length, beforeDecline, 'unchecked cancellation confirmation must not submit');
    await evaluate(cdp, `document.querySelector('[data-panel-close]').click();true`);
    await panelOperation('appointment:cancel', `form.elements.confirmed.checked=true`, 'cancel');
    assert.deepEqual(state.operations.at(-1).confirmation, { confirmed: true, appointmentId: 7001, revision: REVISION });

    await operation('[data-calendar-operation="add-block"]', [
      { text: '08:00', includes: 'Block start' }, { text: '09:00', includes: 'Block end' }, { text: 'Synthetic block', includes: 'Block title' },
    ], 'block-create');
    await operation('[data-calendar-operation="manage-block"]', [
      { text: 'E', includes: 'Manage block' }, { text: DATE, includes: 'Block date' },
      { text: '10:00', includes: 'Block start' }, { text: '11:00', includes: 'Block end' }, { text: 'Edited synthetic block', includes: 'Block title' },
    ], 'block-edit');
    await operation('[data-calendar-operation="manage-block"]', [
      { text: 'R', includes: 'Manage block' }, { type: 'confirm', accept: true, includes: 'Remove this exact canonical block' },
    ], 'block-remove');

    await operation('[data-calendar-operation="add-leave"]', [
      { text: DATE, includes: 'Operational leave date' }, { text: 'Synthetic leave', includes: 'Operational leave reason' },
    ], 'leave-create');
    await operation('[data-calendar-operation="manage-leave"]', [
      { text: 'E', includes: 'Manage operational leave' }, { text: DATE, includes: 'Leave date' }, { text: 'Edited synthetic leave', includes: 'Operational leave reason' },
    ], 'leave-edit');
    await operation('[data-calendar-operation="manage-leave"]', [
      { text: 'R', includes: 'Manage operational leave' }, { type: 'confirm', accept: true, includes: 'Remove this exact operational leave record' },
    ], 'leave-remove');
    await operation('[data-calendar-operation="manage-schedule"]', [
      { text: 'window', includes: 'Schedule mode' }, { text: '09:00', includes: 'Working start' }, { text: '16:00', includes: 'Working end' },
    ], 'schedule-write');
    assert.ok(state.operations.some((item) => item.type === 'schedule-read'));

    const impersonation = await evaluate(cdp, `(async()=>{
      const tokenResponse=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      const token=(await tokenResponse.json()).csrfToken;
      const response=await fetch('/calendar/operations/blocks',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify({adminId:75,actorAdminId:75,staffId:1,startsAt:'2026-09-04T06:00:00.000Z',endsAt:'2026-09-04T07:00:00.000Z',blockType:'other',title:'Impersonation rejection proof',requestId:'browser_actor_proof_1'})});
      return{status:response.status,body:await response.json()};
    })()`);
    assert.equal(impersonation.status, 201);
    assert.equal(state.operations.at(-1).type, 'block-create');
    assert.equal(state.operations.at(-1).adminId, 71);
    assert.equal(Object.hasOwn(state.operations.at(-1), 'actorAdminId'), false);
    const effectiveImpersonationActor = state.operations.at(-1).adminId;

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate('jp');
    const touchProof = await evaluate(cdp, `(()=>{
      const operations=[...document.querySelectorAll('[data-calendar-operation]')];
      const compactEventTargets=operations.filter(element=>element.closest('.positioned-event'));
      const candidates=[...document.querySelectorAll('[data-calendar-operation],.phone-calendar-v2-controls>details>summary,.phone-today-action,.phone-plus-menu>summary')]
        .filter(element=>!element.closest('.positioned-event'));
      const visible=candidates.filter(element=>{
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&style.pointerEvents!=='none'&&rect.width>0&&rect.height>0;
      });
      const visibleCompactEventTargets=compactEventTargets.filter(element=>{
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&style.pointerEvents!=='none'&&rect.width>0&&rect.height>0;
      });
      return{
        domOperationCount:operations.length,
        count:visible.length,
        minHeight:visible.length?Math.min(...visible.map(element=>element.getBoundingClientRect().height)):0,
        compactEventTargetCount:visibleCompactEventTargets.length,
        compactEventTargetMinHeight:visibleCompactEventTargets.length?Math.min(...visibleCompactEventTargets.map(element=>element.getBoundingClientRect().height)):0,
        controls:visible.map(element=>({operation:element.dataset.calendarOperation||null,label:element.getAttribute('aria-label')||element.textContent.trim().slice(0,40),height:element.getBoundingClientRect().height})),
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
      };
    })()`);
    assert.ok(touchProof.domOperationCount >= 8);
    assert.ok(touchProof.count >= 5);
    assert.ok(touchProof.minHeight >= 44);
    assert.ok(touchProof.compactEventTargetCount >= 1);
    assert.ok(touchProof.compactEventTargetMinHeight >= 28);
    assert.ok(touchProof.overflow <= 1);
    screenshots.push({ identity: 'jp-mobile', ...(await snapshot('jp-mobile')) });
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    await navigate('abigail');
    const closed = await evaluate(cdp, `({
      controls:document.querySelectorAll('[data-calendar-operation]').length,
      draggable:document.querySelectorAll('[draggable="true"]').length,
      readOnly:document.body.dataset.calendarReadonly,
      operationsScript:[...document.scripts].some(s=>s.src.includes('/calendar/operations/client.js')),
      hasCreateBooking:document.querySelector('a[aria-label="Create booking"]')!==null
    })`);
    assert.deepEqual(closed, { controls: 0, draggable: 0, readOnly: 'true', operationsScript: false, hasCreateBooking: false });
    const denied = await evaluate(cdp, `(async()=>{const r=await fetch('/calendar/operations/capability',{cache:'no-store'});return{status:r.status,body:await r.json()};})()`);
    assert.equal(denied.status, 403);
    const beforeCraftedDenial = state.operations.length;
    const craftedDenial = await evaluate(cdp, `(async()=>{
      const tokenResponse=await fetch('/calendar/staff-auth/csrf',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      const token=(await tokenResponse.json()).csrfToken;
      const response=await fetch('/calendar/operations/appointments/7001/reschedule',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-shiloh-csrf-token':token},body:JSON.stringify({expectedRevision:${js(REVISION)},startsAt:'2026-09-04T08:00:00.000Z',requestId:'abigail_crafted_denial_1'})});
      return{status:response.status,body:await response.json()};
    })()`);
    assert.equal(craftedDenial.status, 403);
    assert.equal(state.operations.length, beforeCraftedDenial);
    screenshots.push({ identity: 'abigail-denied', ...(await snapshot('abigail-denied')) });

    await navigate('ineligible');
    const unrelatedClosed = await evaluate(cdp, `({
      controls:document.querySelectorAll('[data-calendar-operation]').length,
      draggable:document.querySelectorAll('[draggable="true"]').length,
      readOnly:document.body.dataset.calendarReadonly,
      operationsScript:[...document.scripts].some(s=>s.src.includes('/calendar/operations/client.js')),
      hasCreateBooking:document.querySelector('a[aria-label="Create booking"]')!==null
    })`);
    assert.deepEqual(unrelatedClosed, closed);
    screenshots.push({ identity: 'unrelated-denied', ...(await snapshot('unrelated-denied')) });

    assert.deepEqual(dialogErrors, []);
    assert.deepEqual(exceptions, []);
    assert.equal(network.some((item) => /google|whatsapp|provider/i.test(item.url)), false);
    assert.equal(state.requests.some((item) => /google/i.test(item.path)), false);
    const endpointProof = [...new Set(state.requests
      .filter((item) => item.path.startsWith('/calendar/operations/'))
      .map((item) => `${item.method} ${item.path}`))].sort();
    for (const expected of [
      'POST /calendar/operations/appointments/7001/reschedule',
      'POST /calendar/operations/appointments/7001/reassign',
      'POST /calendar/operations/appointments/7001/cancel',
      'POST /calendar/operations/blocks',
      'PATCH /calendar/operations/blocks/7101',
      'DELETE /calendar/operations/blocks/7101',
      'POST /calendar/operations/leave',
      'PATCH /calendar/operations/leave/7201',
      'DELETE /calendar/operations/leave/7201',
      'GET /calendar/operations/staff/1/schedule/4',
      'PUT /calendar/operations/staff/1/schedule/4',
    ]) assert.ok(endpointProof.includes(expected), `missing authenticated browser endpoint proof: ${expected}`);
    const checkedOutHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.match(checkedOutHead, /^[0-9a-f]{40}$/);
    const manifest = {
      generatedAt: new Date().toISOString(),
      exactHead: checkedOutHead,
      environment: 'ephemeral HTTPS + synthetic fixtures + system Chromium',
      operators: operatorProof,
      denied: [
        { identity: 'Abigail', adminId: 72, result: 'fail-closed', craftedEndpointStatus: craftedDenial.status, ...closed },
        { identity: 'Unrelated Operator', adminId: 76, result: 'fail-closed', ...unrelatedClosed },
      ],
      cancellation: { deliberateConfirmationObserved: true, confirmationControl: 'required checkbox', declinedSubmissionCount: 0 },
      actorAuthority: { suppliedAdminId: 75, effectiveAdminId: effectiveImpersonationActor, source: 'authenticated HttpOnly session' },
      reschedule: { manualAndDragDropPath: 'POST /calendar/operations/appointments/7001/reschedule', sharedPathCount: reschedulePaths.length },
      canonicalRefresh: { verifiedAfterEverySuccessfulUiMutation: true },
      endpointProof,
      touchProof,
      googleOperationalRequests: 0,
      productionMutations: 0,
      screenshots,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Authenticated Calendar mutation browser proof PASS: ${operatorProof.length} eligible + 2 fail-closed; ${screenshots.length} screenshots`);
    console.log(`Covered endpoints: ${endpointProof.join(', ')}`);
  } finally {
    if (cdp) cdp.close();
    if (chrome) {
      chrome.kill('SIGTERM');
      await Promise.race([once(chrome, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      if (chrome.exitCode == null) chrome.kill('SIGKILL');
    }
    if (server) {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
