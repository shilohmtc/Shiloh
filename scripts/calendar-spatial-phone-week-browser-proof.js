const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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
  serializeSessionCookie,
} = require('../src/middleware/staffBrowserSession');
const { createCalendarReadOnlyRouter } = require('../src/routes/calendarReadOnlyUx');
const { createCalendarCreateBookingRouter } = require('../src/routes/calendarCreateBooking');
const { createCalendarReadOnlyUxService } = require('../src/services/calendarReadOnlyUx');
const { staffCalendarAccessClientScript } = require('../src/presentation/staffCalendarAccessUx');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');
const { workspaceNavigationClientScript } = require('../src/presentation/workspaceShell');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');
const { calendarDesktopApprovedClientScript } = require('../src/presentation/calendarDesktopApprovedUx');
const { calendarDesktopFitCanvasClientScript } = require('../src/presentation/calendarDesktopFitCanvasUx');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-phone-week-planner-v3');
const SESSION_TOKEN = 'synthetic-phone-v2-session';
const DATE_KEY = '2026-09-11';
const ENV = {
  NODE_ENV: 'production',
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createCertificate(directory) {
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-days', '1',
  ], { encoding: 'utf8' });
  if (generated.status !== 0) return null;
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
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for authenticated Phone Week Planner V3 proof');
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

const STAFF = [
  { id: 51, displayName: 'Amber Room', schedulingType: 'regular' },
  { id: 52, displayName: 'Birch Room', schedulingType: 'regular' },
  { id: 53, displayName: 'Cedar Room', schedulingType: 'regular' },
];

function appointment(id, staffIds, day, localHour, durationMinutes, clientName) {
  const utcHour = localHour - 2;
  const startsAt = `${day}T${String(utcHour).padStart(2, '0')}:00:00.000Z`;
  return {
    id,
    kind: 'appointment',
    canonical: true,
    revision: `rev-${id}`,
    status: 'scheduled',
    clientName,
    clientMobile: '27820000000',
    serviceName: durationMinutes > 60 ? 'Extended synthetic treatment' : 'Synthetic treatment',
    serviceContexts: [{ serviceId: 81, categoryName: 'Massage' }],
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000).toISOString(),
    staffIds,
    staff: staffIds.map(staffId => ({ staffId, nameSnapshot: STAFF.find(person => person.id === staffId).displayName })),
  };
}

function canonicalTimeline() {
  const appointments = [
    appointment(9801, [51], '2026-09-07', 8, 60, 'Monday Client'),
    appointment(9802, [52], '2026-09-08', 9, 45, 'Tuesday Client'),
    appointment(9803, [53], '2026-09-10', 11, 90, 'Thursday Client'),
    appointment(9804, [51, 52], '2026-09-11', 10, 120, 'Shared Client'),
    appointment(9805, [53], '2026-09-11', 12, 60, 'Later Client'),
    appointment(9806, [51], '2026-09-12', 13, 45, 'Saturday Client'),
  ];
  return {
    staff: STAFF,
    workingWindows: STAFF.flatMap(person => [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({
      staffId: person.id,
      dayOfWeek,
      startsLocal: '08:00:00',
      endsLocal: dayOfWeek === 6 ? '15:00:00' : '17:00:00',
    }))),
    scheduleExceptions: [],
    recurringClosures: [],
    closures: [],
    appointments,
    blocks: [],
    leave: [],
    externalBusy: [],
    events: appointments,
  };
}

function createFixture() {
  const state = {
    authenticatedCalendarReads: 0,
    productionReads: 0,
    productionMutations: 0,
    providerNetworkCalls: 0,
    senderCalls: 0,
    realClientSends: 0,
  };
  const sessionService = {
    async validateSessionToken(token) {
      if (token !== SESSION_TOKEN) return { ok: false };
      return {
        ok: true,
        sessionId: 88,
        adminId: 77,
        csrfHash: 'synthetic',
        recoveryRequired: false,
        viewer: { calendarScope: 'business_all_staff', operatorAdminId: 77 },
      };
    },
  };
  const calendarService = createCalendarReadOnlyUxService({
    async listTimeline() {
      state.authenticatedCalendarReads += 1;
      return canonicalTimeline();
    },
    async query(_text, params) {
      return { rows: (params?.[0] || []).map(id => ({ appointment_id: id, client_mobile: '27820000000' })) };
    },
    async listPublicHolidays() {
      return [{ date: '2026-09-24', name: 'Heritage Day', observed: false, source: 'public_holidays' }];
    },
  });
  const mutationCapability = {
    enabled: true,
    operations: [
      'appointment:reschedule', 'appointment:cancel', 'appointment:reassign',
      'calendar_block:manage', 'operational_leave:manage',
    ],
    calendarScope: 'all_business',
    serviceScope: 'all_services',
    allowedServiceIds: null,
  };
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.get('/proof', (_req, res) => {
    res.setHeader('Set-Cookie', serializeSessionCookie(SESSION_TOKEN, { env: ENV }));
    return res.redirect(302, `/calendar/read-only?view=week&date=${DATE_KEY}&staff=51&staff=52&staff=53&activeStaff=51`);
  });
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send(staffCalendarAccessClientScript()));
  app.get('/calendar/operations/client.js', (_req, res) => res.type('application/javascript').send(calendarOperationalMutationsClientScript()));
  app.get('/calendar/workspace/nav.js', async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, 450));
    return res.type('application/javascript').send([
      workspaceNavigationClientScript(),
      workspaceIconClientScript(),
      calendarDesktopApprovedClientScript(),
      calendarDesktopFitCanvasClientScript(),
    ].join('\n'));
  });
  app.get('/calendar/workspace/navigation', (_req, res) => res.json({
    dashboard: { allowed: true, href: '/calendar/workspace' },
    calendar: { allowed: true, href: '/calendar/read-only' },
    clients: { allowed: true, href: '/calendar/clients' },
    messages: { allowed: true, href: '/calendar/messages' },
    staff: { allowed: true, href: '/calendar/team' },
    services: { allowed: true, href: '/calendar/services' },
    reports: { allowed: true, href: '/calendar/reports' },
  }));
  app.get('/calendar/operations/appointments/:appointmentId/booking-confirmation', (_req, res) => res.json({
    confirmation: { status: 'delivered', statusLabel: 'Delivered', lastEvidenceAt: '2026-09-05T08:00:00.000Z' },
    canRecover: false,
  }));
  app.use('/calendar/read-only', createOptionalCalendarSessionMiddleware({ service: sessionService, env: ENV }), createCalendarReadOnlyRouter({
    env: ENV,
    buildModel: input => calendarService.buildModel(input),
    bookingService: { async resolveOperator() { return { adminId: 77 }; } },
    retrospectiveBookingService: { async resolveOperator() { return { adminId: 77 }; } },
    mutationService: { async resolveOperator() { return { mutationCapability }; } },
    clientAccessService: { async resolveAccess() { return { capability: 'client:lookup' }; } },
  }));
  app.use('/calendar/book', createCalendarCreateBookingRouter({
    env: ENV,
    sessionService,
    bookingService: {
      async resolveOperator() { return { adminId: 77 }; },
      async listBookableOptions() {
        return {
          staff: STAFF,
          services: [{ id: 81, name: 'Synthetic treatment', durationMinutes: 60, staffIds: STAFF.map(person => person.id) }],
        };
      },
    },
    clientDirectory: { async listActiveClients() { return { clients: [] }; } },
    creationService: { async resolveCreateAccess() { return null; } },
  }));
  return { app, state };
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome for authenticated Phone Week Planner V3 proof');
    console.log('Chrome not installed; authenticated Phone Week Planner V3 proof is CI-only.');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-phone-v2-'));
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const certificate = createCertificate(directory);
  ENV.NODE_ENV = certificate ? 'production' : 'test';
  const { app, state } = createFixture();
  let server;
  let chrome;
  let cdp;
  try {
    server = certificate ? https.createServer(certificate, app) : http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `${certificate ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
    const debugPort = await reservePort();
    chrome = spawn(executable, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
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

    const externalRequests = [];
    const browserExceptions = [];
    cdp.on('Network.requestWillBeSent', event => {
      try {
        const url = new URL(event.request.url);
        if (url.origin !== origin && !event.request.url.startsWith('data:') && !event.request.url.startsWith('about:')) externalRequests.push(event.request.url);
      } catch (_error) { externalRequests.push(event.request.url); }
    });
    cdp.on('Runtime.exceptionThrown', event => browserExceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    async function navigate(url, readySelector) {
      await cdp.send('Page.navigate', { url });
      await poll(() => evaluate(cdp, 'document.readyState'), value => value === 'complete');
      if (readySelector) await poll(() => evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(readySelector)}))`), Boolean);
    }

    async function capture(name) {
      const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      const file = `${name}.png`;
      const target = path.join(OUT_DIR, file);
      fs.writeFileSync(target, Buffer.from(image.data, 'base64'));
      return { name, file, bytes: fs.statSync(target).size, sha256: sha256(target) };
    }

    const screenshots = [];

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1600, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1600 });
    await cdp.send('Page.navigate', { url: `${origin}/proof` });
    await poll(() => evaluate(cdp, 'location.pathname'), value => value === '/calendar/read-only');
    await poll(() => evaluate(cdp, `document.body?.dataset.calendarDesktopPending`), value => value === 'true');
    const pendingMetrics = await evaluate(cdp, `(() => ({
      shellVisibility:getComputedStyle(document.querySelector('.workspace-main>.shell')).visibility,
      shellOpacity:getComputedStyle(document.querySelector('.workspace-main>.shell')).opacity,
      canonicalWeekPresent:Boolean(document.querySelector('.week-grid')),
      approvedPlannerCount:document.querySelectorAll('.desktop-practitioner-grid').length,
    }))()`);
    assert.equal(pendingMetrics.shellVisibility, 'hidden');
    assert.equal(pendingMetrics.shellOpacity, '0');
    assert.equal(pendingMetrics.canonicalWeekPresent, true);
    assert.equal(pendingMetrics.approvedPlannerCount, 0);
    screenshots.push({ ...(await capture('desktop-first-paint-pending')), viewport: { width: 1920, height: 1600 }, metrics: pendingMetrics });
    await poll(() => evaluate(cdp, `document.body.dataset.calendarDesktopApproved`), value => value === 'true');
    await poll(() => evaluate(cdp, `document.body.hasAttribute('data-calendar-desktop-pending')`), value => value === false);
    await poll(() => evaluate(cdp, `document.querySelectorAll('.desktop-practitioner-lane').length`), value => value === 3);
    await poll(() => evaluate(cdp, `document.querySelectorAll('.desktop-create-popover a').length`), value => value >= 2);
    await poll(() => evaluate(cdp, `document.querySelectorAll('.desktop-create-popover [data-calendar-operation="add-block"],.desktop-create-popover [data-calendar-operation="add-leave"]').length`), value => value === 6);
    const desktopMetrics = await evaluate(cdp, `(() => ({
      viewport:{width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height},
      approved:document.body.dataset.calendarDesktopApproved||'',
      compactPeriod:document.querySelector('.desktop-calendar-toolbar .period-context')?.textContent.trim()||'',
      weekStripDays:document.querySelectorAll('.desktop-week-day').length,
      selectedDates:Array.from(document.querySelectorAll('.desktop-week-day[aria-current="date"]')).map(node=>new URL(node.href).searchParams.get('date')),
      practitionerLaneCount:document.querySelectorAll('.desktop-practitioner-lane').length,
      practitionerNames:Array.from(document.querySelectorAll('.desktop-practitioner-lane>header h3')).map(node=>node.textContent.trim()),
      visibleEventIds:Array.from(document.querySelectorAll('.desktop-practitioner-grid [data-event-id]')).map(node=>node.dataset.eventId),
      visibleEventStaffIds:Array.from(document.querySelectorAll('.desktop-practitioner-grid [data-event-staff-ids]')).map(node=>node.dataset.eventStaffIds),
      createLabels:Array.from(document.querySelectorAll('.desktop-create-popover a,.desktop-create-popover button,.desktop-create-submenu>summary')).map(node=>node.textContent.trim()),
      visibleTimeLabels:Array.from(document.querySelectorAll('.week-time-grid>.time-rail span')).filter(node=>getComputedStyle(node).display!=='none').map(node=>node.textContent.trim()),
      sourceWeekDisplay:getComputedStyle(document.querySelector('.week-grid')).display,
      plannerOverflowY:getComputedStyle(document.querySelector('.week-time-grid')).overflowY,
      plannerMaxHeight:getComputedStyle(document.querySelector('.week-time-grid')).maxHeight,
      rootScrollWidth:document.documentElement.scrollWidth,
      navIconCount:document.querySelectorAll('.workspace-nav-icon').length,
      signoutHasIcon:Boolean(document.querySelector('[data-shiloh-logout] .workspace-nav-icon')),
      visibleInlineManage:Array.from(document.querySelectorAll('.desktop-practitioner-grid .event-operation')).filter(node=>getComputedStyle(node).display!=='none').length,
      bookingSlotCounts:Array.from(document.querySelectorAll('.desktop-practitioner-lane')).map(lane=>lane.querySelectorAll('.calendar-booking-slot').length),
      bookingSlotStaff:Array.from(document.querySelectorAll('.desktop-practitioner-lane')).map(lane=>new URL(lane.querySelector('.calendar-booking-slot')?.href||location.href).searchParams.get('staff')),
      phoneControlsDisplay:getComputedStyle(document.querySelector('[data-phone-calendar-v2-controls]')).display,
      verticalFit:document.body.dataset.calendarDesktopVerticalFit||'',
      gridHeight:document.querySelector('.desktop-practitioner-lane .time-column')?.getBoundingClientRect().height||0,
      gridBottom:document.querySelector('.week-time-grid')?.getBoundingClientRect().bottom||0,
    }))()`);
    assert.deepEqual(desktopMetrics.viewport, { width: 1920, height: 1600, screenWidth: 1920, screenHeight: 1600 });
    assert.equal(desktopMetrics.approved, 'true');
    assert.equal(desktopMetrics.compactPeriod, '7–12 Sep 2026');
    assert.equal(desktopMetrics.weekStripDays, 6);
    assert.deepEqual(desktopMetrics.selectedDates, [DATE_KEY]);
    assert.equal(desktopMetrics.practitionerLaneCount, 3);
    assert.deepEqual(desktopMetrics.practitionerNames, ['Amber Room', 'Birch Room', 'Cedar Room']);
    assert.deepEqual(desktopMetrics.visibleEventIds.sort(), ['appointment-9804', 'appointment-9805']);
    assert.deepEqual(desktopMetrics.visibleEventStaffIds.sort(), ['51,52', '53']);
    assert.ok(desktopMetrics.createLabels.includes('New appointment'));
    assert.ok(desktopMetrics.createLabels.includes('Record past appointment'));
    assert.ok(desktopMetrics.createLabels.includes('Block time'));
    assert.ok(desktopMetrics.createLabels.includes('Leave'));
    assert.equal(desktopMetrics.visibleTimeLabels.at(-1), '18:00');
    assert.equal(desktopMetrics.sourceWeekDisplay, 'none');
    assert.equal(desktopMetrics.plannerOverflowY, 'visible');
    assert.equal(desktopMetrics.plannerMaxHeight, 'none');
    assert.ok(desktopMetrics.rootScrollWidth <= 1920);
    assert.ok(desktopMetrics.navIconCount >= 8);
    assert.equal(desktopMetrics.signoutHasIcon, true);
    assert.equal(desktopMetrics.visibleInlineManage, 0);
    assert.deepEqual(desktopMetrics.bookingSlotCounts, [11, 11, 11]);
    assert.deepEqual(desktopMetrics.bookingSlotStaff, ['51', '52', '53']);
    assert.equal(desktopMetrics.phoneControlsDisplay, 'none');
    assert.equal(desktopMetrics.verticalFit, 'true');
    assert.ok(desktopMetrics.gridHeight > 792, JSON.stringify(desktopMetrics));
    assert.ok(1600 - desktopMetrics.gridBottom < 80);
    screenshots.push({ ...(await capture('desktop-approved-calendar-contract')), viewport: desktopMetrics.viewport, metrics: desktopMetrics });
    await evaluate(cdp, `document.querySelector('.desktop-create-menu>summary').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('.desktop-create-menu')?.open`), Boolean);
    screenshots.push({ ...(await capture('desktop-new-menu-complete')), viewport: desktopMetrics.viewport, metrics: { labels: desktopMetrics.createLabels } });
    const desktopViewOptions = await evaluate(cdp, `Array.from(document.querySelectorAll('[data-calendar-view-option]')).map(node=>node.dataset.calendarViewOption)`);
    assert.deepEqual(desktopViewOptions, ['week', 'agenda', 'month']);
    await navigate(`${origin}/calendar/read-only?view=month&date=${DATE_KEY}&staff=51&staff=52&staff=53&activeStaff=51`, '.month-grid');
    const desktopMonthMetrics = await evaluate(cdp, `(() => ({
      view:document.body.dataset.calendarView||'',
      rootScrollWidth:document.documentElement.scrollWidth,
      dayOption:Boolean(document.querySelector('[data-calendar-view-option="day"]')),
      monthGrid:Boolean(document.querySelector('.month-grid')),
    }))()`);
    assert.equal(desktopMonthMetrics.view, 'month');
    assert.equal(desktopMonthMetrics.dayOption, false);
    assert.equal(desktopMonthMetrics.monthGrid, true);
    assert.ok(desktopMonthMetrics.rootScrollWidth <= 1920);
    screenshots.push({ ...(await capture('desktop-month-day-retired')), viewport: { width: 1920, height: 1600 }, metrics: desktopMonthMetrics });


    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(`${origin}/calendar/read-only?date=${DATE_KEY}`, '.week-grid');
    await poll(() => evaluate(cdp, `document.body.dataset.phoneActiveDate`), value => value === DATE_KEY);
    const weekMetrics = await evaluate(cdp, `(() => {
      const visible=node=>{if(!node)return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
      const scroller=document.querySelector('.week-time-grid');
      const grid=document.querySelector('.week-grid');
      const lanes=Array.from(document.querySelectorAll('[data-week-date-lane]'));
      const visibleLanes=lanes.filter(visible);
      const visibleColumns=visibleLanes.map(node=>node.querySelector('.time-column')).filter(Boolean);
      const dateButtons=Array.from(document.querySelectorAll('[data-phone-week-date]'));
      const staffButtons=Array.from(document.querySelectorAll('[data-phone-week-staff-id]'));
      const plus=document.querySelector('.phone-plus-menu>summary');
      const today=document.querySelector('.phone-today-action');
      const menuToggle=document.querySelector('[data-workspace-drawer-toggle]');
      const calendar=document.querySelector('.week-time-grid');
      const frame=document.querySelector('.workspace-frame');
      const columnTops=visibleColumns.map(node=>node.getBoundingClientRect().top);
      const columnHeights=visibleColumns.map(node=>node.getBoundingClientRect().height);
      return {
        viewport:{width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height},
        rootScrollWidth:document.documentElement.scrollWidth,
        weekColumns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
        weekScrollerClientWidth:scroller?.clientWidth||0,
        weekScrollerScrollWidth:scroller?.scrollWidth||0,
        firstColumnWidth:visibleLanes[0]?.getBoundingClientRect().width||0,
        visibleColumns:visibleLanes.length,
        visibleDates:Array.from(new Set(visibleLanes.map(node=>node.dataset.date))),
        practitionerLaneCount:document.querySelectorAll('[data-week-practitioner-lane]').length,
        visibleAppointmentStaffIds:Array.from(document.querySelectorAll('.week-view .positioned-event')).filter(visible).map(node=>node.querySelector('[data-event-staff-ids]')?.dataset.eventStaffIds||''),
        sundayColumns:Array.from(document.querySelectorAll('.week-day')).filter(node=>new Date(node.dataset.date+'T12:00:00Z').getUTCDay()===0).length,
        plannerVisible:visible(document.querySelector('[data-phone-week-planner]')),
        dateButtonCount:dateButtons.length,
        activeDateButtons:dateButtons.filter(node=>node.classList.contains('active')).map(node=>node.dataset.phoneWeekDate),
        visibleRepeatedDateHeaders:visibleLanes.flatMap(node=>Array.from(node.querySelectorAll('.week-day-date'))).filter(visible).length,
        activeStaffButtons:staffButtons.filter(node=>node.classList.contains('active')).map(node=>node.dataset.phoneWeekStaffId),
        minStaffToggleHeight:Math.min(...staffButtons.map(node=>node.getBoundingClientRect().height)),
        actionStaffId:document.body.dataset.phoneActiveStaffId||'',
        activeStaffName:document.querySelector('[data-phone-active-staff]')?.textContent.trim()||'',
        currentView:document.querySelector('.phone-view-menu>summary strong')?.textContent.trim()||'',
        normalPhoneViews:Array.from(document.querySelectorAll('[data-phone-calendar-view]')).map(node=>node.dataset.phoneCalendarView),
        maxColumnTopDelta:columnTops.length?Math.max(...columnTops)-Math.min(...columnTops):0,
        minColumnHeight:columnHeights.length?Math.min(...columnHeights):0,
        maxColumnHeight:columnHeights.length?Math.max(...columnHeights):0,
        plusVisible:visible(plus),
        plusWidth:plus?.getBoundingClientRect().width||0,
        plusHeight:plus?.getBoundingClientRect().height||0,
        todayVisible:visible(today),
        todayHeight:today?.getBoundingClientRect().height||0,
        drawerRight:document.querySelector('[data-workspace-navigation-drawer]')?.getBoundingClientRect().right||0,
        menuToggleHeight:menuToggle?.getBoundingClientRect().height||0,
        framePaddingBottom:frame?parseFloat(getComputedStyle(frame).paddingBottom)||0:0,
        calendarViewportShare:calendar?Number(((innerHeight-calendar.getBoundingClientRect().top)/innerHeight).toFixed(3)):0,
      };
    })()`);
    assert.deepEqual(weekMetrics.viewport, { width: 390, height: 844, screenWidth: 390, screenHeight: 844 });
    assert.ok(weekMetrics.rootScrollWidth <= 391, 'Phone Week Planner leaked horizontal overflow');
    assert.equal(weekMetrics.visibleColumns, 1);
    assert.deepEqual(weekMetrics.visibleDates, [DATE_KEY]);
    assert.equal(weekMetrics.practitionerLaneCount, 0);
    assert.ok(weekMetrics.visibleAppointmentStaffIds.every(ids=>ids.split(',').includes('51')), 'Phone Week showed an appointment outside the active practitioner');
    assert.ok(weekMetrics.firstColumnWidth >= 300, `Phone Week active date lane is too narrow: ${weekMetrics.firstColumnWidth}px`);
    assert.ok(weekMetrics.weekScrollerScrollWidth <= weekMetrics.weekScrollerClientWidth + 2, 'Phone Week Planner requires horizontal panning');
    assert.equal(weekMetrics.sundayColumns, 0);
    assert.equal(weekMetrics.plannerVisible, true);
    assert.equal(weekMetrics.dateButtonCount, 6);
    assert.deepEqual(weekMetrics.activeDateButtons, [DATE_KEY]);
    assert.equal(weekMetrics.visibleRepeatedDateHeaders, 0);
    assert.deepEqual(weekMetrics.activeStaffButtons, ['51']);
    assert.ok(weekMetrics.minStaffToggleHeight >= 44, 'Phone Week practitioner toggle is below 44px');
    assert.equal(weekMetrics.actionStaffId, '51');
    assert.equal(weekMetrics.activeStaffName, 'Amber Room');
    assert.equal(weekMetrics.currentView, 'Week');
    assert.deepEqual(weekMetrics.normalPhoneViews, ['week', 'agenda', 'month']);
    assert.ok(weekMetrics.minColumnHeight >= 658 && weekMetrics.maxColumnHeight <= 662, 'Phone Week does not end its 60px/hour compact grid at 18:00');
    assert.equal(weekMetrics.plusVisible, true);
    assert.ok(weekMetrics.plusWidth >= 44 && weekMetrics.plusHeight >= 44, 'Phone + launcher is below 44px');
    assert.equal(weekMetrics.todayVisible, true);
    assert.ok(weekMetrics.todayHeight >= 44, 'Phone Today control is below 44px');
    assert.ok(weekMetrics.drawerRight <= 1, 'Closed Phone drawer remains on-screen');
    assert.ok(weekMetrics.menuToggleHeight >= 44, 'Phone menu toggle is below 44px');
    assert.equal(weekMetrics.framePaddingBottom, 0, 'Phone shell still reserves persistent bottom-navigation space');
    assert.ok(weekMetrics.calendarViewportShare >= 0.70, `Phone Week calendar receives only ${weekMetrics.calendarViewportShare * 100}% of the viewport`);
    screenshots.push({ ...(await capture('phone-week-planner-all-practitioners')), viewport: weekMetrics.viewport, metrics: weekMetrics });

    await evaluate(cdp, `document.querySelector('.phone-plus-menu>summary').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('.phone-plus-menu')?.open`), Boolean);
    const plusMetrics = await evaluate(cdp, `(() => {
      const visible=node=>{if(!node)return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
      const targets=Array.from(document.querySelectorAll('.phone-plus-popover>a,.phone-plus-popover button')).filter(visible);
      return {labels:targets.map(node=>node.textContent.trim()),minHeight:Math.min(...targets.map(node=>node.getBoundingClientRect().height))};
    })()`);
    assert.deepEqual(plusMetrics.labels, ['New appointment', 'Couples booking', 'Record past appointment', 'Block time', 'Leave']);
    assert.ok(plusMetrics.minHeight >= 44, 'Phone + action target is below 44px');
    screenshots.push({ ...(await capture('phone-plus-actions')), viewport: { width: 390, height: 844 }, metrics: plusMetrics });
    await evaluate(cdp, `document.querySelector('.phone-plus-menu>summary').click();true`);

    await evaluate(cdp, `document.querySelector('[data-workspace-drawer-toggle]').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('[data-workspace-navigation-drawer]').classList.contains('open')`), Boolean);
    await poll(() => evaluate(cdp, `document.querySelector('[data-workspace-navigation-drawer]').getBoundingClientRect().left`), value => value >= -1);
    const drawerMetrics = await evaluate(cdp, `(() => {
      const visible=node=>{if(!node)return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0&&rect.right>0;};
      const drawer=document.querySelector('[data-workspace-navigation-drawer]');
      const destinations=Array.from(drawer.querySelectorAll('[data-workspace-destination]')).filter(visible);
      return {
        width:drawer.getBoundingClientRect().width,
        labels:destinations.map(node=>node.textContent.trim()),
        minHeight:Math.min(...destinations.map(node=>node.getBoundingClientRect().height)),
        moreVisible:visible(drawer.querySelector('[data-workspace-more-toggle]')),
        current:drawer.querySelector('[aria-current="page"]')?.textContent.trim()||'',
        rootScrollWidth:document.documentElement.scrollWidth,
      };
    })()`);
    assert.ok(drawerMetrics.width >= 170 && drawerMetrics.width <= 190, `Phone drawer missed the compact 170–190px target: ${drawerMetrics.width}px`);
    assert.deepEqual(drawerMetrics.labels, ['Dashboard', 'Calendar', 'Clients', 'Messages', 'Staff', 'Services', 'Reports']);
    assert.ok(drawerMetrics.minHeight >= 44, 'Phone drawer destination is below 44px');
    assert.equal(drawerMetrics.moreVisible, false);
    assert.equal(drawerMetrics.current, 'Calendar');
    assert.ok(drawerMetrics.rootScrollWidth <= 391);
    screenshots.push({ ...(await capture('phone-narrow-direct-drawer')), viewport: { width: 390, height: 844 }, metrics: drawerMetrics });
    await evaluate(cdp, `document.querySelector('[data-workspace-drawer-close]').click();true`);
    await poll(() => evaluate(cdp, `!document.querySelector('[data-workspace-navigation-drawer]').classList.contains('open')`), Boolean);
    await poll(() => evaluate(cdp, `document.querySelector('[data-workspace-navigation-drawer]').getBoundingClientRect().right`), value => value <= 1);

    await evaluate(cdp, `document.querySelector('[data-phone-week-staff-id="52"]').click();true`);
    await poll(() => evaluate(cdp, `document.body.dataset.phoneActiveStaffId`), value => value === '52');
    const safeTargetMetrics = await evaluate(cdp, `(() => {
      const visible=node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0;
      const events=Array.from(document.querySelectorAll('.week-view .positioned-event')).filter(visible);
      const operationStaff=Array.from(document.querySelectorAll('.phone-plus-popover [data-staff-id]')).map(node=>node.dataset.staffId);
      const appointmentHref=document.querySelector('.phone-plus-popover a')?.getAttribute('href')||'';
      return {
        activeStaff:document.body.dataset.phoneActiveStaffId||'',
        activeStaffName:document.querySelector('[data-phone-active-staff]')?.textContent.trim()||'',
        visibleAppointmentStaffIds:events.map(node=>node.querySelector('[data-event-staff-ids]')?.dataset.eventStaffIds||''),
        operationStaff,
        appointmentHref,
      };
    })()`);
    assert.equal(safeTargetMetrics.activeStaff, '52');
    assert.equal(safeTargetMetrics.activeStaffName, 'Birch Room');
    assert.ok(safeTargetMetrics.visibleAppointmentStaffIds.every(ids=>ids.split(',').includes('52')), 'Phone practitioner switch did not filter canonical event ownership');
    assert.ok(safeTargetMetrics.operationStaff.length >= 2);
    assert.deepEqual([...new Set(safeTargetMetrics.operationStaff)], ['52']);
    assert.match(safeTargetMetrics.appointmentHref, /staff=52/);
    screenshots.push({ ...(await capture('phone-week-active-practitioner-switch')), viewport: { width: 390, height: 844 }, metrics: safeTargetMetrics });

    await evaluate(cdp, `document.querySelector('[data-phone-week-date="2026-09-07"]').click();true`);
    await poll(() => evaluate(cdp, `document.body.dataset.phoneActiveDate`), value => value === '2026-09-07');
    await poll(() => evaluate(cdp, `Array.from(document.querySelectorAll('[data-week-date-lane]')).filter(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0).length`), value => value === 1);
    screenshots.push({ ...(await capture('phone-week-active-monday')), viewport: { width: 390, height: 844 } });

    await evaluate(cdp, `(() => {
      const column=document.querySelector('[data-week-date-lane][data-date="2026-09-07"] .time-column');
      const rect=column.getBoundingClientRect();
      column.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+Math.max(2,rect.width/2),clientY:rect.top+240,button:0}));
      return true;
    })()`);
    await poll(() => evaluate(cdp, 'location.pathname'), value => value === '/calendar/book');
    const emptySlotTarget = await evaluate(cdp, `({date:new URL(location.href).searchParams.get('date'),time:new URL(location.href).searchParams.get('time'),staff:new URL(location.href).searchParams.get('staff')})`);
    assert.deepEqual(emptySlotTarget, { date: '2026-09-07', time: '11:00', staff: '52' });
    screenshots.push({ ...(await capture('phone-week-empty-slot-booking')), viewport: { width: 390, height: 844 }, metrics: emptySlotTarget });

    await navigate(`${origin}/calendar/read-only?view=week&date=${DATE_KEY}&staff=51&staff=52&staff=53&activeStaff=51`, '.week-grid');
    await evaluate(cdp, `document.querySelector('[data-event-id="appointment-9804"][data-appointment-management-target="true"]').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('[data-calendar-management-panel]')?.open`), Boolean);
    screenshots.push({ ...(await capture('phone-appointment-manage-sheet')), viewport: { width: 390, height: 844 } });
    await evaluate(cdp, `document.querySelector('[data-panel-close]').click();true`);

    await navigate(`${origin}/calendar/read-only?view=month&date=${DATE_KEY}&staff=51&staff=52&staff=53&activeStaff=51`, '.month-grid');
    await poll(() => evaluate(cdp, `Array.from(document.querySelectorAll('.month-events .event-card')).filter(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;}).length`), value => value > 0);
    const monthMetrics = await evaluate(cdp, `(() => {
      const visible=node=>{if(!node)return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
      const dayLinks=Array.from(document.querySelectorAll('.month-day-link')).filter(visible);
      return {
        viewport:{width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height},
        rootScrollWidth:document.documentElement.scrollWidth,
        activeStaff:document.querySelector('[data-phone-active-staff]')?.textContent.trim()||'',
        currentView:document.querySelector('.phone-view-menu>summary strong')?.textContent.trim()||'',
        densityCount:document.querySelectorAll('.phone-month-density').length,
        visibleAppointmentCards:Array.from(document.querySelectorAll('.month-events .event-card')).filter(visible).length,
        compactAppointmentLabels:Array.from(document.querySelectorAll('.month-events .event-card')).filter(visible).map(node=>node.textContent.trim()),
        minDateTargetHeight:Math.min(...dayLinks.map(node=>node.getBoundingClientRect().height)),
        sundayCells:Array.from(document.querySelectorAll('.month-day')).filter(node=>new Date(node.dataset.date+'T12:00:00Z').getUTCDay()===0).length,
        linksPreserveAll:dayLinks.every(node=>{const url=new URL(node.getAttribute('href'),location.origin);return url.searchParams.getAll('staff').join(',')==='51,52,53'&&url.searchParams.get('activeStaff')==='51';}),
        holidayAnnotated:Boolean(document.querySelector('[data-phone-public-holiday="Heritage Day"]')),
        holidayShownAsClosure:Array.from(document.querySelectorAll('.closure-strip')).some(node=>/Heritage Day/.test(node.textContent)),
        bands:Array.from(document.querySelectorAll('[data-phone-capacity-band]')).map(node=>node.dataset.phoneCapacityBand),
      };
    })()`);
    assert.deepEqual(monthMetrics.viewport, { width: 390, height: 844, screenWidth: 390, screenHeight: 844 });
    assert.ok(monthMetrics.rootScrollWidth <= 391, 'Phone Month leaked horizontal overflow');
    assert.equal(monthMetrics.activeStaff, 'Amber Room');
    assert.equal(monthMetrics.currentView, 'Month');
    assert.equal(monthMetrics.densityCount, 0, 'Phone Month still shows dot-only density indicators');
    assert.ok(monthMetrics.visibleAppointmentCards > 0, 'Phone Month hides appointment details');
    assert.ok(monthMetrics.compactAppointmentLabels.some(label => /Client|Shared/.test(label)), 'Phone Month appointment strips do not identify bookings');
    assert.ok(monthMetrics.minDateTargetHeight >= 44, 'Phone Month date target is below 44px');
    assert.equal(monthMetrics.sundayCells, 0);
    assert.equal(monthMetrics.linksPreserveAll, true, 'Phone Month date navigation did not preserve all selected practitioners');
    assert.equal(monthMetrics.holidayAnnotated, true, 'Phone Month did not annotate Heritage Day');
    assert.equal(monthMetrics.holidayShownAsClosure, false, 'Public-holiday annotation was incorrectly promoted to closure authority');
    assert.ok(monthMetrics.bands.every(band => ['light','medium','busy','closed'].includes(band)), 'Phone Month emitted an unknown capacity band');
    screenshots.push({ ...(await capture('phone-month-appointment-overview')), viewport: monthMetrics.viewport, metrics: monthMetrics });

    await evaluate(cdp, `document.querySelector('.month-day[data-date="2026-09-24"] .month-day-link').click();true`);
    await poll(() => evaluate(cdp, `document.body.dataset.phoneActiveDate`), value => value === '2026-09-24');
    await poll(() => evaluate(cdp, `document.querySelector('.phone-view-menu>summary strong')?.textContent.trim()`), value => value === 'Week');
    await evaluate(cdp, `document.querySelector('.phone-date-menu>summary').click();true`);
    await poll(() => evaluate(cdp, `document.querySelector('.phone-date-menu')?.open`), Boolean);
    const holidayPickerMetrics = await evaluate(cdp, `(() => ({
      holidayDotVisible:Array.from(document.querySelectorAll('.phone-date-holiday-dot')).some(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0),
      holidayTitle:Array.from(document.querySelectorAll('.phone-date-holiday-dot')).map(node=>node.getAttribute('title')).find(Boolean)||'',
      activeDate:document.body.dataset.phoneActiveDate||'',
    }))()`);
    assert.equal(holidayPickerMetrics.holidayDotVisible, true);
    assert.match(holidayPickerMetrics.holidayTitle, /Heritage Day/);
    assert.equal(holidayPickerMetrics.activeDate, '2026-09-24');
    screenshots.push({ ...(await capture('phone-public-holiday-date-picker')), viewport: { width: 390, height: 844 }, metrics: holidayPickerMetrics });

    assert.deepEqual(browserExceptions, []);
    assert.deepEqual(externalRequests, []);
    assert.ok(state.authenticatedCalendarReads >= 4);
    assert.deepEqual({ ...state, authenticatedCalendarReads: 0 }, {
      authenticatedCalendarReads: 0,
      productionReads: 0,
      productionMutations: 0,
      providerNetworkCalls: 0,
      senderCalls: 0,
      realClientSends: 0,
    });

    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.match(exactHead, /^[0-9a-f]{40}$/);
    const manifest = {
      generatedAt: new Date().toISOString(),
      exactHead,
      authenticatedSession: true,
      syntheticDataOnly: true,
      authority: 'Existing CalendarReadOnlyUx, permitted-staff filtering, canonical booking/manage authority and #725 Phone presentation extended by #727 Week Planner/Month composition',
      productionReads: 0,
      productionMutations: 0,
      providerNetworkCalls: 0,
      senderCalls: 0,
      realClientSends: 0,
      screenshots,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Authenticated Phone Week Planner V3 proof passed: ${screenshots.length} screenshots at ${exactHead}`);
  } finally {
    if (cdp) cdp.close();
    if (chrome && !chrome.killed) {
      chrome.kill('SIGTERM');
      await Promise.race([once(chrome, 'exit'), new Promise(resolve => setTimeout(resolve, 2_000))]);
      if (chrome.exitCode == null) chrome.kill('SIGKILL');
    }
    if (server) await new Promise(resolve => server.close(() => resolve()));
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_error) {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
