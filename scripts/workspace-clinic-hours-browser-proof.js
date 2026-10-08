const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
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
function timedCdp(session) {
  return {
    async send(method, params = {}, timeoutMs = 15000) {
      let timer;
      try {
        return await Promise.race([
          session.send(method, params),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Chrome DevTools command timed out: ${method}`)), timeoutMs); }),
        ]);
      } finally { clearTimeout(timer); }
    },
    close() { return session.detach(); },
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
    // Keep the approved preinstalled executable and the existing 15-second startup bound.
    // Playwright uses its pipe transport; no downloaded browser or DevToolsActivePort file.
    chrome = await chromium.launch({ executablePath: executable, headless: true, timeout: 15000,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'], });
    const context = await chrome.newContext({ viewport: null });
    const page = await context.newPage();
    cdp = timedCdp(await context.newCDPSession(page));
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
        header: (()=>{const menu=document.querySelector('[data-workspace-drawer-toggle]')?.getBoundingClientRect(),title=document.querySelector('.brand h1')?.getBoundingClientRect();return menu&&title?{menuRight:menu.right,titleLeft:title.left,titleRight:title.right}:null})(),
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
      assert.match(geometry.text, /Staff leave and blocked-off time will stay exactly as they are/);
      assert.match(geometry.sunday, /Permanent clinic closure/);
      assert.doesNotMatch(geometry.text, /synthetic-clinic-hours-session/);
      if (width === 390) {
        assert.ok(geometry.targets.every(target => target.height >= 43 && target.width >= 43));
        assert.ok(geometry.header.titleLeft >= geometry.header.menuRight + 8, 'Phone menu must not overlap the Clinic hours heading');
        assert.ok(geometry.header.titleRight <= width, 'Clinic hours heading must remain inside the Phone viewport');
      }
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
    await cdp?.close();
    await chrome?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
