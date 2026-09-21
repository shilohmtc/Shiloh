const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');
const {
  renderPhoneCalendarUtilityBar,
  renderPhoneWeekPlannerHeader,
} = require('../src/presentation/calendarPhoneCompactV2');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-phone-column-toggle-v1');
const VIEWPORTS = [
  { name: 'compact-android', width: 360, height: 800 },
  { name: 's24-plus-class', width: 384, height: 832 },
  { name: 'iphone-class', width: 390, height: 844 },
  { name: 'large-phone', width: 440, height: 956 },
];

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => candidate && fs.existsSync(candidate)) || null;
}

async function reservePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function poll(load, accept, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await load(); if (accept(value)) return value; } catch (_error) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Phone Calendar column-toggle proof');
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
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result || {});
  });
  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

function fixtureHtml() {
  const script = calendarPhoneAllStaffClientScript().replace(/<\/script/gi, '<\\/script');
  const people = [
    ['51', 'Abigail'], ['52', 'Christel'], ['53', 'Ilince'], ['54', 'Marietjie'], ['55', 'Naomi'], ['56', 'Pieter'], ['57', 'Savanna'],
  ];
  const staff = people.map(([id, displayName]) => ({ id: Number(id), displayName }));
  const model = {
    view: 'week',
    dateKey: '2026-09-11',
    activeStaffId: 51,
    visibleStaffIds: staff.map(person => person.id),
    permittedStaff: staff,
    timeline: { staff },
    period: { dateKeys: ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12'] },
  };
  const utilityBar = renderPhoneCalendarUtilityBar(model, { basePath: '/' });
  const plannerHeader = renderPhoneWeekPlannerHeader(model, { basePath: '/' });
  const events = people.map(([id, name], index) => `<div class="positioned-event" data-proof-event="${id}" style="--phone-event-top:${80 + index * 55}px;--phone-event-height:48px"><article class="event-card" data-event-staff-ids="${id}"><span class="event-time">09:${String(index * 5).padStart(2, '0')}</span><h4>Client ${index + 1}</h4><span class="event-meta event-practitioners"><span class="event-practitioner-full">${name}</span><span class="event-practitioner-compact">${name}</span></span></article></div>`).join('');
  const hours = Array.from({ length: 14 }, (_, i) => `<span>${String(7 + i).padStart(2,'0')}:00</span>`).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--line:#d8dfda;--line-strong:#a9b5ad;--leaf:#43805f;--leaf-deep:#275b45;--leaf-soft:#eef5ef;--panel:#fffdf9;--ink:#20322b;--muted:#69756f}*{box-sizing:border-box}html,body{margin:0;width:100%;min-height:100%;overflow-x:hidden;font-family:Arial,sans-serif;color:var(--ink)}.workspace-main>.shell{padding:4px}.phone-calendar-utility-bar{display:grid}.phone-week-date-strip{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:2px}.phone-week-date{display:grid;place-items:center;min-height:44px}.phone-week-staff-strip{display:grid;gap:3px}.phone-week-staff-toggle{min-height:44px;padding:6px 9px;border:1px solid var(--line);border-radius:9px;background:#fff}.phone-plus-menu>summary{display:flex;min-height:44px;padding:8px;border:1px solid var(--leaf-deep);border-radius:9px;background:var(--leaf-deep);color:#fff}.calendar-view{width:100%;background:#fff}.week-time-grid{display:grid;grid-template-columns:32px minmax(0,1fr);height:900px;overflow:auto}.time-rail{position:relative;height:900px}.time-rail span{display:block;height:60px;font-size:10px}.week-grid{min-width:0}.time-column{position:relative;height:900px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 59px,var(--line) 59px,var(--line) 60px)}.positioned-event{position:absolute;top:var(--phone-event-top);height:var(--phone-event-height);left:2px;width:calc(100% - 4px)}.event-card{height:100%;overflow:hidden;border:1px solid var(--line);background:#fff}.event-card h4,.event-meta{display:block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phone-calendar-view-link,.phone-calendar-today-link{display:block}
</style></head><body data-phone-calendar-v2="true" data-calendar-view="week" data-phone-active-date="2026-09-11"><main class="workspace-main"><div class="shell">${utilityBar}<div class="calendar-view week-view">${plannerHeader}<div class="week-time-grid"><aside class="time-rail">${hours}</aside><div class="week-grid"><section class="week-day week-date-lane" data-week-date-lane data-phone-active-day="true" data-date="2026-09-11"><div class="time-column">${events}</div></section></div></div></div></div></main><script>${script}</script></body></html>`;
}

async function screenshot(cdp, filename) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(image.data, 'base64'));
}

async function verifyViewport(cdp, origin, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true, screenWidth: viewport.width, screenHeight: viewport.height });
  await cdp.send('Page.navigate', { url: `${origin}/?view=week&date=2026-09-11` });
  await poll(() => evaluate(cdp, 'document.readyState'), value => value === 'complete');
  await poll(() => evaluate(cdp, `document.querySelectorAll('[data-phone-staff-column-id]').length`), value => value === 7);
  const initial = await evaluate(cdp, `(() => {
    const visible=node=>{if(!node)return false;const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const grid=document.querySelector('.week-time-grid');
    return {
      month:document.querySelector('[data-phone-week-month-context]')?.textContent.trim()||'',
      headers:Array.from(document.querySelectorAll('[data-phone-staff-column-id]')).map(n=>({id:n.dataset.phoneStaffColumnId,label:n.textContent.trim(),width:Math.round(n.getBoundingClientRect().width)})),
      staffPressed:Array.from(document.querySelectorAll('[data-phone-week-staff-id]')).map(n=>n.getAttribute('aria-pressed')),
      allPressed:document.querySelector('[data-phone-week-staff-all]')?.getAttribute('aria-pressed')||'',
      gridClientWidth:grid.clientWidth,gridScrollWidth:grid.scrollWidth,rootScrollWidth:document.documentElement.scrollWidth,
      late:Array.from(document.querySelectorAll('.time-rail span')).filter(n=>['19:00','20:00'].includes(n.textContent.trim())&&visible(n)).map(n=>n.textContent.trim()),
      eighteen:Array.from(document.querySelectorAll('.time-rail span')).some(n=>n.textContent.trim()==='18:00'&&visible(n)),
      dayContext:!!document.querySelector('.phone-calendar-day-context'),
    };
  })()`);
  assert.ok(['sep','sept'].includes(initial.month.toLowerCase()), `Unexpected month label: ${initial.month}`);
  assert.equal(initial.headers.length, 7);
  assert.ok(initial.headers.every(header => header.width > 20), JSON.stringify(initial.headers));
  assert.ok(initial.staffPressed.every(value => value === 'true'));
  assert.equal(initial.allPressed, 'true');
  assert.ok(initial.gridScrollWidth <= initial.gridClientWidth + 1, JSON.stringify(initial));
  assert.ok(initial.rootScrollWidth <= viewport.width + 1, JSON.stringify(initial));
  assert.deepEqual(initial.late, []);
  assert.equal(initial.eighteen, true);
  assert.equal(initial.dayContext, false);

  await evaluate(cdp, `document.querySelector('[data-phone-week-staff-id="52"]').click()`);
  await poll(() => evaluate(cdp, `document.querySelectorAll('[data-phone-staff-column-id]').length`), value => value === 6);
  const toggled = await evaluate(cdp, `(() => ({
    headers:Array.from(document.querySelectorAll('[data-phone-staff-column-id]')).map(n=>n.textContent.trim()),
    christelPressed:document.querySelector('[data-phone-week-staff-id="52"]')?.getAttribute('aria-pressed'),
    abigailPressed:document.querySelector('[data-phone-week-staff-id="51"]')?.getAttribute('aria-pressed'),
    christelVisible:document.querySelector('[data-proof-event="52"]')?.dataset.phoneColumnVisible,
    abigailVisible:document.querySelector('[data-proof-event="51"]')?.dataset.phoneColumnVisible,
    allPressed:document.querySelector('[data-phone-week-staff-all]')?.getAttribute('aria-pressed')
  }))()`);
  assert.equal(toggled.headers.includes('Christel'), false);
  assert.equal(toggled.christelPressed, 'false');
  assert.equal(toggled.abigailPressed, 'true');
  assert.equal(toggled.christelVisible, 'false');
  assert.equal(toggled.abigailVisible, 'true');
  assert.equal(toggled.allPressed, 'false');

  await evaluate(cdp, `document.querySelector('[data-phone-week-staff-all]').click()`);
  await poll(() => evaluate(cdp, `document.querySelectorAll('[data-phone-staff-column-id]').length`), value => value === 7);
  await screenshot(cdp, `phone-calendar-${viewport.name}.png`);
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome');
    console.log('Chrome not installed; proof is CI-only.');
    return;
  }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = express();
  app.get('/', (_req, res) => res.type('html').send(fixtureHtml()));
  const server = http.createServer(app);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-phone-columns-'));
  let chrome;
  let cdp;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const debugPort = await reservePort();
    chrome = spawn(executable, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(directory,'profile')}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] });
    const targets = await poll(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(), items => Array.isArray(items) && items.some(item => item.type === 'page' && item.webSocketDebuggerUrl));
    cdp = await connectCdp(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    for (const viewport of VIEWPORTS) await verifyViewport(cdp, origin, viewport);
    console.log(`Phone Calendar column-toggle proof passed for ${VIEWPORTS.map(v => `${v.width}x${v.height}`).join(', ')}`);
  } finally {
    try { cdp?.close(); } catch (_error) {}
    try { chrome?.kill('SIGKILL'); } catch (_error) {}
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
