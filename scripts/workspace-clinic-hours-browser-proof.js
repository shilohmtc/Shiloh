const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const { createWorkspaceClinicHoursRouter } = require('../src/routes/workspaceClinicHours');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-clinic-hours-v1');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => candidate && fs.existsSync(candidate)) || null;
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function poll(load, accept, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await load(); if (accept(value)) return value; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for Clinic hours proof');
}
async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
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
    send(method, params = {}, timeoutMs = 15000) {
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

function model() {
  return {
    authority: { operatorAdminId: 41, displayName: 'Clinic operator', capability: 'schedule:manage' },
    location: { id: 7, name: 'Shiloh', timezone: 'Africa/Johannesburg' },
    revision: 'a'.repeat(64),
    days: [
      { dayOfWeek: 1, name: 'Monday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 2, name: 'Tuesday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 3, name: 'Wednesday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 4, name: 'Thursday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 5, name: 'Friday', open: true, startsLocal: '08:00', endsLocal: '17:00' },
      { dayOfWeek: 6, name: 'Saturday', open: true, startsLocal: '08:00', endsLocal: '14:00' },
      { dayOfWeek: 0, name: 'Sunday', open: false, permanent: true },
    ],
    exceptions: [
      { id: 91, exceptionDate: '2026-12-16', exceptionType: 'closed', holidayName: 'Day of Reconciliation', actorAdminId: 41, updatedAt: '2026-09-11T12:00:00.000Z' },
      { id: 92, exceptionDate: '2026-12-25', exceptionType: 'open', startsLocal: '09:00', endsLocal: '13:00', holidayName: 'Christmas Day', actorAdminId: 41, updatedAt: '2026-09-11T12:05:00.000Z' },
    ],
  };
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) throw new Error('Chrome is required for authenticated Clinic hours proof');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-clinic-hours-proof-'));
  let buildCalls = 0;
  let mutationCalls = 0;
  const sessionService = {
    validateSessionToken: async token => token === 'synthetic-clinic-hours-session' ? { ok: true, adminId: 41 } : { ok: false },
    validateCsrfToken: () => false,
  };
  const service = {
    buildModel: async ({ adminId }) => { assert.equal(adminId, 41); buildCalls++; return model(); },
    updateHours: async () => { mutationCalls++; throw new Error('Visual proof must not mutate weekly hours'); },
    upsertException: async () => { mutationCalls++; throw new Error('Visual proof must not mutate exceptions'); },
  };
  const app = express();
  app.use(express.json());
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send(''));
  app.use('/calendar/clinic-hours', createWorkspaceClinicHoursRouter({ env: ENV, sessionService, service, holidayGuard: { requireLoadedZaPublicHoliday: async () => true } }));
  const server = http.createServer(app);
  let chrome;
  let cdp;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const profileDirectory = path.join(directory, 'profile');
    fs.mkdirSync(profileDirectory, { recursive: true });
    chrome = spawn(executable, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profileDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let browserErrors = '';
    chrome.stderr.on('data', chunk => { browserErrors = `${browserErrors}${String(chunk)}`.slice(-8000); });
    const devToolsActivePort = path.join(profileDirectory, 'DevToolsActivePort');
    const debuggingPort = await poll(() => {
      if (chrome.exitCode != null) throw new Error(`Chrome exited before DevTools became ready (code ${chrome.exitCode}).\n${browserErrors}`);
      if (!fs.existsSync(devToolsActivePort)) return null;
      const [portLine] = fs.readFileSync(devToolsActivePort, 'utf8').trim().split(/\r?\n/);
      const port = Number(portLine);
      return Number.isSafeInteger(port) && port > 0 ? port : null;
    }, Boolean);
    const targets = await poll(
      async () => (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json(),
      value => Array.isArray(value) && value.some(target => target.type === 'page' && target.webSocketDebuggerUrl)
    );
    cdp = await connectCdp(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    await cdp.send('Page.navigate', { url: `${origin}/calendar/clinic-hours` });
    await poll(() => evaluate(cdp, 'document.body.innerText'), text => String(text).includes('Unauthorized'));
    await cdp.send('Network.setCookie', { name: 'shiloh_staff_session', value: 'synthetic-clinic-hours-session', url: origin, httpOnly: true, sameSite: 'Strict' });

    const screenshots = [];
    for (const [name, width, height] of [['desktop', 1440, 960], ['phone', 390, 844]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
      await cdp.send('Page.navigate', { url: `${origin}/calendar/clinic-hours?proof=${name}` });
      await poll(() => evaluate(cdp, "document.readyState==='complete' && !!document.querySelector('[data-workspace-clinic-hours]')"), Boolean);
      const geometry = await evaluate(cdp, `({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        text: document.body.textContent,
        tabs: document.querySelectorAll('[data-hours-tab]').length,
        visiblePanels: Array.from(document.querySelectorAll('[data-view-panel],#special-dates')).filter(node=>!node.hidden).length,
        editButtons: document.querySelectorAll('[data-edit-exception]').length,
        deleteButtons: document.querySelectorAll('[data-delete-exception]').length,
        sunday: document.querySelector('[data-clinic-day="0"]')?.textContent || '',
        targets: Array.from(document.querySelectorAll('button,input,select,a.workspace-nav-item')).filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;}).map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))
      })`);
      assert.equal(geometry.width, width);
      assert.equal(geometry.overflow, false);
      assert.equal(geometry.editButtons, 2);
      assert.equal(geometry.deleteButtons, 0);
      assert.equal(geometry.tabs, 3);
      assert.equal(geometry.visiblePanels, 1);
      assert.match(geometry.text, /Good to know/);
      assert.match(geometry.text, /Staff booking hours/);
      assert.match(geometry.text, /Day of Reconciliation/);
      assert.match(geometry.text, /Christmas Day/);
      assert.match(geometry.text, /practitioner leave or practitioner blocks/);
      assert.match(geometry.sunday, /Permanent clinic closure/);
      assert.doesNotMatch(geometry.text, /synthetic-clinic-hours-session/);
      if (width === 390) assert.ok(geometry.targets.every(target => target.height >= 43 && target.width >= 43));
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = `${name}-clinic-hours.png`;
      const filePath = path.join(OUT_DIR, file);
      fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
      screenshots.push({ file, width, height, sha256: sha256(filePath), noHorizontalOverflow: true, touchTargets: geometry.targets.length });
    }

    assert.equal(mutationCalls, 0);
    assert.ok(buildCalls >= 2);
    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      authenticated: true,
      syntheticDataOnly: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      canonicalMutationCalls: mutationCalls,
      screenshots,
    }, null, 2));
    console.log(`Authenticated Clinic hours proof passed at ${exactHead}: Desktop + Phone; no mutations.`);
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
