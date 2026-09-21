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

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-web-desktop-visual-v1');
const STAFF = [
  { id: 41, displayName: 'Abigail', schedulingType: 'regular' },
  { id: 42, displayName: 'Christel', schedulingType: 'regular' },
  { id: 43, displayName: 'ILince', schedulingType: 'regular' },
  { id: 44, displayName: 'Marietjie', schedulingType: 'regular' },
  { id: 45, displayName: 'Jean-Pierre', schedulingType: 'regular' },
];

function currentJohannesburgDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const TODAY = currentJohannesburgDate();

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function appointment(id, staffId, clientName, hour, minute = 0, duration = 60) {
  const startsAt = new Date(`${TODAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);
  return {
    id, kind: 'appointment', canonical: true, revision: `rev-${id}`, status: 'scheduled',
    clientName, clientMobile: '27821234567', serviceName: id % 2 ? 'Deep tissue massage' : 'Skin consultation',
    serviceContexts: [{ serviceId: 81, categoryName: id % 2 ? 'Massage' : 'Beauty' }],
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    staffIds: [staffId], staff: [{ staffId, nameSnapshot: STAFF.find((person) => person.id === staffId)?.displayName }],
  };
}

function timeline() {
  const appointments = [
    appointment(9601, 41, 'Naledi Mokoena', 8, 0, 60),
    appointment(9602, 41, 'Amelia Jacobs', 9, 15, 45),
    appointment(9603, 41, 'Lerato Dlamini', 10, 15, 60),
    appointment(9604, 41, 'Sarah Botha', 11, 30, 45),
    appointment(9605, 41, 'Mia Petersen', 13, 0, 60),
    appointment(9606, 41, 'Thandi Nkosi', 14, 15, 45),
    appointment(9610, 42, 'Chloe van Wyk', 8, 30, 60),
    appointment(9611, 42, 'Zanele Khumalo', 12, 0, 60),
    appointment(9620, 43, 'Emma Naidoo', 9, 0, 45),
    appointment(9640, 45, 'Ava Smith', 15, 0, 60),
  ];
  return {
    staff: STAFF,
    workingWindows: STAFF.map((person) => ({ staffId: person.id, dayOfWeek: new Date(`${TODAY}T12:00:00+02:00`).getUTCDay(), startsLocal: '08:00:00', endsLocal: '17:00:00' })),
    scheduleExceptions: [], recurringClosures: [], closures: [], blocks: [], leave: [], externalBusy: [],
    appointments, events: appointments,
  };
}

const AUTHORIZED = timeline();

function requestedStaff(value) {
  if (value == null || value === 'all') return STAFF.map((person) => person.id);
  const raw = Array.isArray(value) ? value : [value];
  const allowed = new Set(STAFF.map((person) => person.id));
  const ids = raw.map(Number).filter((id) => Number.isSafeInteger(id) && allowed.has(id));
  return ids.length ? ids : STAFF.map((person) => person.id);
}

function buildModel({ view = 'day', date = TODAY, staff }) {
  const visibleIds = requestedStaff(staff);
  const visible = new Set(visibleIds);
  const appointments = AUTHORIZED.appointments.filter((item) => item.staffIds.some((id) => visible.has(id)));
  const visibleStaff = STAFF.filter((person) => visible.has(person.id));
  const explicit = staff != null;
  return {
    view: view || 'day', dateKey: date || TODAY, permittedStaff: STAFF,
    visibleStaffIds: visibleIds, visibleStaffSelectionExplicit: explicit,
    selectedStaffId: visibleIds.length === 1 ? visibleIds[0] : null,
    authorizedTimeline: AUTHORIZED,
    period: { startKey: date || TODAY, previousAnchor: date || TODAY, nextAnchor: date || TODAY, dateKeys: [date || TODAY] },
    timeline: {
      ...AUTHORIZED,
      staff: visibleStaff,
      workingWindows: AUTHORIZED.workingWindows.filter((item) => visible.has(item.staffId)),
      appointments, events: appointments,
    },
  };
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
  throw new Error('Timed out waiting for authenticated Desktop Calendar visual proof');
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else waiter.resolve(message.result || {});
  });
  return {
    send(method, params = {}, timeoutMs = 15_000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome DevTools command timed out: ${method}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

function createFixture({ secure = true } = {}) {
  const env = {
    NODE_ENV: secure ? 'production' : 'test',
    SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
    SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
  };
  const token = crypto.createHash('sha256').update('calendar-web-visual-proof').digest('base64url');
  const sessionService = {
    async validateSessionToken(supplied) {
      if (supplied !== token) return { ok: false, code: 'STAFF_SESSION_INVALID' };
      return {
        ok: true, sessionId: 901, adminId: 71, recoveryRequired: false,
        viewer: { calendarScope: 'business_all_staff', operatorAdminId: 71 },
      };
    },
    validateCsrfToken() { return false; },
  };
  const app = express();
  app.use(requestContext);
  app.get('/proof', (req, res) => {
    res.setHeader('Set-Cookie', serializeSessionCookie(token, { env }));
    const staff = req.query.staff || 'all';
    return res.redirect(302, `/calendar/workspace?view=day&date=${TODAY}&staff=${encodeURIComponent(staff)}`);
  });
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  app.use(
    '/calendar/workspace',
    createOptionalCalendarSessionMiddleware({ service: sessionService, env }),
    createCalendarReadOnlyRouter({
      env,
      buildModel: async (args) => buildModel(args),
      bookingService: { async resolveOperator() { return { adminId: 71 }; } },
      retrospectiveBookingService: { async resolveOperator() { const error = new Error('forbidden'); error.code = 'FORBIDDEN'; throw error; } },
      mutationService: { async resolveOperator() { const error = new Error('forbidden'); error.code = 'FORBIDDEN'; throw error; } },
      clientAccessService: { async resolveAccess() { return false; } },
    }),
  );
  return app;
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome for authenticated Desktop Calendar visual proof');
    console.log('Chrome not installed; authenticated Desktop Calendar visual proof skipped outside CI.');
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-calendar-web-visual-'));
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const certificate = createCertificate(directory);
  const app = createFixture({ secure: Boolean(certificate) });
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
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    async function viewport(width, height, mobile = false) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    }
    async function navigate(url) {
      await cdp.send('Page.navigate', { url });
      await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
      await poll(() => evaluate(cdp, 'location.pathname'), (value) => value === '/calendar/workspace');
    }
    async function capture(name) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = `${name}.png`;
      const filePath = path.join(OUT_DIR, file);
      fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
      return { name, file, bytes: fs.statSync(filePath).size, sha256: fileSha256(filePath) };
    }
    async function metrics() {
      return evaluate(cdp, `(()=>{const visible=(n)=>{if(!n)return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const lanes=[...document.querySelectorAll('.day-time-grid .lane')].filter(visible);const populated=lanes.filter(l=>l.querySelector('.positioned-event'));const empty=lanes.filter(l=>!l.querySelector('.positioned-event'));const shell=document.querySelector('.shell');const canvas=document.querySelector('.day-time-grid');const period=document.querySelector('.period-context');return {viewportWidth:innerWidth,shellWidth:shell?.getBoundingClientRect().width||0,canvasClientWidth:canvas?.clientWidth||0,canvasScrollWidth:canvas?.scrollWidth||0,laneWidths:lanes.map(l=>l.getBoundingClientRect().width),laneCount:lanes.length,populatedCount:populated.length,emptyCount:empty.length,populatedBackground:populated[0]?getComputedStyle(populated[0]).backgroundColor:null,emptyBackground:empty[0]?getComputedStyle(empty[0]).backgroundColor:null,appointmentCount:document.querySelectorAll('.positioned-event').length,selectedChips:document.querySelectorAll('[data-calendar-staff-chip].active').length,allSelected:document.querySelector('[data-calendar-staff-chip="all"]')?.classList.contains('active')||false,desktopChipsVisible:visible(document.querySelector('[data-desktop-practitioner-chips]')),periodText:period?.textContent?.trim()||'',todayVisible:visible(document.querySelector('.today')),oldPeopleDropdownVisible:visible(document.querySelector('[data-people-picker]'))};})()`);
    }

    const manifest = [];
    const cases = [
      { name: 'desktop-one-practitioner', width: 1366, staff: '41', expectedLanes: 1 },
      { name: 'desktop-two-practitioners', width: 1440, staff: '41&staff=42', expectedLanes: 2 },
      { name: 'desktop-all-permitted-wide', width: 1920, staff: 'all', expectedLanes: 5 },
      { name: 'desktop-dense-day', width: 1440, staff: '41', expectedLanes: 1, dense: true },
    ];
    for (const proof of cases) {
      await viewport(proof.width, 1000, false);
      const staffQuery = proof.staff === '41&staff=42' ? '41%26staff%3D42' : encodeURIComponent(proof.staff);
      if (proof.staff === '41&staff=42') {
        await navigate(`${origin}/proof?staff=41`);
        await cdp.send('Page.navigate', { url: `${origin}/calendar/workspace?view=day&date=${TODAY}&staff=41&staff=42` });
        await poll(() => evaluate(cdp, 'document.readyState'), (value) => value === 'complete');
      } else {
        await navigate(`${origin}/proof?staff=${staffQuery}`);
      }
      const m = await metrics();
      assert.equal(m.laneCount, proof.expectedLanes, `${proof.name} lane count`);
      assert.equal(m.desktopChipsVisible, proof.expectedLanes > 1 || STAFF.length > 1);
      assert.equal(m.oldPeopleDropdownVisible, false, `${proof.name} must not expose old Desktop People dropdown`);
      assert.equal(m.todayVisible, true, `${proof.name} must retain Today`);
      assert.ok(m.periodText.length > 0, `${proof.name} must retain selected-date context`);
      assert.ok(m.shellWidth <= m.viewportWidth, `${proof.name} must stay within the viewport`);
      if (proof.name === 'desktop-all-permitted-wide') {
        assert.ok(m.shellWidth >= 1680, 'wide all-staff proof must use the available Desktop width');
        assert.equal(m.emptyCount >= 1, true, 'all-staff proof must contain an empty lane');
        assert.equal(m.populatedCount >= 1, true, 'all-staff proof must contain populated lanes');
        assert.notEqual(m.populatedBackground, m.emptyBackground, 'populated lanes should visually dominate empty lanes');
        assert.ok(Math.min(...m.laneWidths) >= 299, 'wide all-staff lanes must remain readable');
        assert.ok(m.canvasScrollWidth >= m.canvasClientWidth, 'wide all-staff canvas may retain local overflow');
      }
      if (proof.dense) assert.ok(m.appointmentCount >= 6, 'dense day must contain at least six appointments');
      manifest.push({ ...(await capture(proof.name)), viewport: { width: proof.width, height: 1000 }, metrics: m });
    }

    await viewport(1440, 1000, false);
    await navigate(`${origin}/proof?staff=all`);
    await evaluate(cdp, `document.querySelector('[data-calendar-staff-chip="43"]').click();true`);
    await poll(() => evaluate(cdp, 'new URL(location.href).searchParams.getAll("staff").join(",")'), (value) => value === '43');
    const selected = await metrics();
    assert.equal(selected.selectedChips, 1, 'direct practitioner chip click should produce one selected chip');
    assert.equal(selected.allSelected, false, 'All staff should clear after selecting one practitioner');
    assert.equal(selected.laneCount, 1, 'direct practitioner chip navigation should focus one lane');
    manifest.push({ ...(await capture('desktop-direct-chip-selected')), viewport: { width: 1440, height: 1000 }, metrics: selected });

    await viewport(390, 844, true);
    await navigate(`${origin}/proof?staff=41`);
    const phone = await metrics();
    const phoneControls = await evaluate(cdp, `(()=>{const visible=(n)=>{if(!n)return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const controls=document.querySelector('[data-phone-calendar-utility-bar]');const staff=document.querySelector('.phone-staff-menu');const summary=staff?.querySelector('summary');return {controlsVisible:visible(controls),staffVisible:visible(staff),activeStaff:document.querySelector('[data-phone-active-staff]')?.textContent?.trim()||'',summaryMinHeight:summary?parseFloat(getComputedStyle(summary).minHeight):0,oldPickerVisible:visible(document.querySelector('.practitioner-control'))};})()`);
    assert.equal(phone.desktopChipsVisible, false, 'Phone must hide Desktop practitioner chips');
    assert.equal(phoneControls.controlsVisible, true, 'Phone must render the approved compact Calendar toolbar');
    assert.equal(phoneControls.staffVisible, false, 'Phone should omit an unnecessary practitioner menu when one practitioner is available');
    assert.equal(phoneControls.activeStaff, 'Abigail', 'Phone compact practitioner menu must retain the selected practitioner');
    assert.equal(phoneControls.summaryMinHeight, 0, 'Phone should not render a redundant single-practitioner control');
    assert.equal(phoneControls.oldPickerVisible, false, 'Phone V2 may hide the canonical Desktop-era picker wrapper after rendering compact controls');
    manifest.push({ ...(await capture('phone-picker-regression')), viewport: { width: 390, height: 844 }, metrics: { ...phone, phoneControls } });

    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(exactHead)) throw new Error('Desktop Calendar visual proof could not resolve exact checked-out head');
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(), exactHead, clinicDate: TODAY, authenticated: true,
      productionMutations: 0, providerWrites: 0, datastoreWrites: 0,
      authority: 'canonical permittedStaff presentation only', screenshots: manifest,
    }, null, 2)}\n`);
    console.log(`Authenticated Desktop Calendar visual proof PASS: ${manifest.length} screenshots at ${exactHead}`);
    for (const item of manifest) console.log(`${item.name}: ${item.bytes} bytes sha256=${item.sha256}`);
  } finally {
    try { cdp?.close(); } catch (_error) {}
    if (chrome && !chrome.killed) {
      chrome.kill('SIGTERM');
      await Promise.race([
        once(chrome, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_error) {}
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
