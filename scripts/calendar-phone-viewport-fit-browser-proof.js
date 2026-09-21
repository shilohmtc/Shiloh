'use strict';

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
  renderPhoneMonthNavigation,
  renderPhoneWeekPlannerHeader,
} = require('../src/presentation/calendarPhoneCompactV2');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'calendar-phone-viewport-fit-v1');
const TODAY = '2026-09-11';
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
    try {
      const value = await load();
      if (accept(value)) return value;
    } catch (_error) {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for Phone viewport-fit proof');
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
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
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

function proofModel(view, date) {
  const people = [
    ['51', 'Abigail'], ['52', 'Christel'], ['53', 'Ilince'], ['54', 'Marietjie'], ['55', 'Naomi'], ['56', 'Pieter'], ['57', 'Savanna'],
  ];
  const staff = people.map(([id, displayName]) => ({ id: Number(id), displayName }));
  return {
    view,
    dateKey: date,
    activeStaffId: 51,
    visibleStaffIds: staff.map(person => person.id),
    permittedStaff: staff,
    timeline: { staff },
    period: {
      startKey: '2026-09-01',
      previousAnchor: '2026-08-01',
      nextAnchor: '2026-10-01',
      dateKeys: ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12'],
    },
  };
}

function weekMarkup(model) {
  const people = model.permittedStaff.map(person => [String(person.id), person.displayName]);
  const hours = Array.from({ length: 14 }, (_, i) => {
    const hour = 7 + i;
    return `<span style="--phone-grid-top:${i * 60}px">${String(hour).padStart(2,'0')}:00</span>`;
  }).join('');
  const events = people.slice(0, 3).map(([id, name], index) => `<div class="positioned-event" data-proof-event="${id}" style="--phone-event-top:${120 + index * 75}px;--phone-event-height:60px"><article class="event-card" data-event-staff-ids="${id}"><span class="event-time">${String(9 + index).padStart(2,'0')}:00</span><h4>Client ${index + 1}</h4><span class="event-meta event-practitioners"><span class="event-practitioner-full">${name}</span><span class="event-practitioner-compact">${name}</span></span></article></div>`).join('');
  return `${renderPhoneWeekPlannerHeader(model, { basePath: '/' })}<div class="week-time-grid"><aside class="time-rail">${hours}</aside><div class="week-grid"><section class="week-day week-date-lane" data-week-date-lane data-phone-active-day="true" data-date="${model.dateKey}"><div class="time-column">${events}</div></section></div></div>`;
}

function monthMarkup() {
  const days = Array.from({ length: 30 }, (_, i) => `<a class="month-day month-day-link" href="/?view=week&date=2026-09-${String(i + 1).padStart(2,'0')}">${i + 1}</a>`).join('');
  return `<div class="month-grid"><div class="month-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="month-days">${days}</div></div>`;
}

function fixtureHtml(view, date) {
  const script = calendarPhoneAllStaffClientScript().replace(/<\/script/gi, '<\\/script');
  const model = proofModel(view, date);
  const utilityBar = renderPhoneCalendarUtilityBar(model, { basePath: '/', todayDate: TODAY });
  const monthNavigation = renderPhoneMonthNavigation(model, { basePath: '/' });
  const planner = view === 'month' ? monthMarkup() : weekMarkup(model);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--line:#d8dfda;--line-strong:#a9b5ad;--leaf:#43805f;--leaf-deep:#275b45;--leaf-soft:#eef5ef;--ink:#20322b;--muted:#69756f}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow-x:hidden;font-family:Arial,sans-serif;color:var(--ink)}.workspace-main>.shell{padding:4px}.phone-calendar-utility-bar{display:grid}.phone-week-date-strip{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:2px}.phone-week-date{display:grid;place-items:center;min-height:44px}.phone-week-staff-strip{display:grid;gap:3px}.phone-week-staff-toggle{min-height:44px;padding:6px 9px;border:1px solid var(--line);border-radius:9px;background:#fff}.phone-plus-menu>summary{display:flex;min-height:44px;padding:8px;border:1px solid var(--leaf-deep);border-radius:9px;background:var(--leaf-deep);color:#fff}.calendar-view{width:100%;background:#fff}.week-time-grid{display:grid;grid-template-columns:32px minmax(0,1fr);height:900px;overflow:auto}.time-rail{position:relative;height:900px}.time-rail span{position:absolute;top:var(--phone-grid-top);left:0;font-size:10px}.week-grid{min-width:0}.time-column{position:relative;height:900px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 59px,var(--line) 59px,var(--line) 60px)}.positioned-event{position:absolute;top:var(--phone-event-top);height:var(--phone-event-height);left:2px;width:calc(100% - 4px)}.event-card{height:100%;overflow:hidden;border:1px solid var(--line);background:#fff}.event-card h4,.event-meta{display:block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phone-calendar-view-link,.phone-calendar-today-link{display:block}.month-grid{height:500px}.month-weekdays,.month-days{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}.month-days{height:450px}.month-day{display:grid;place-items:center;min-height:44px;border:1px solid var(--line)}
</style></head><body data-phone-calendar-v2="true" data-calendar-view="${view}" data-phone-active-date="${date}" data-phone-booking-path="/book"><main class="workspace-main"><div class="shell">${utilityBar}${monthNavigation}<div class="calendar-view ${view}-view">${planner}</div></div></main><script>
// Mimic the older fixed-60px/hour bubble handler. The fitted handler must intercept it.
document.addEventListener('click',event=>{const column=event.target.closest?.('.week-view .time-column');if(!column||event.defaultPrevented)return;const rect=column.getBoundingClientRect();const y=Math.max(0,event.clientY-rect.top);const minutes=Math.round((y/60)*2)*30;location.assign('/wrong-booking?time='+minutes);});
</script><script>${script}</script></body></html>`;
}

async function screenshot(cdp, filename) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(image.data, 'base64'));
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await poll(() => evaluate(cdp, 'document.readyState'), value => value === 'complete');
}

async function verifyWeek(cdp, origin, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true, screenWidth: viewport.width, screenHeight: viewport.height });
  await navigate(cdp, `${origin}/?view=week&date=${TODAY}`);
  await poll(() => evaluate(cdp, `document.body.dataset.phoneWeekGridFitted`), value => value === 'true');
  await poll(() => evaluate(cdp, `document.querySelectorAll('[data-phone-staff-column-id]').length`), value => value === 7);
  const metrics = await evaluate(cdp, `(() => {
    const visible=node=>{if(!node)return false;const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const calendar=document.querySelector('.calendar-view');
    const grid=document.querySelector('.week-time-grid');
    const eighteen=Array.from(document.querySelectorAll('.time-rail span')).find(n=>n.textContent.trim()==='18:00');
    return {
      viewport:{width:innerWidth,height:innerHeight},
      todayVisible:visible(document.querySelector('[data-phone-calendar-today]')),
      utilityLabels:Array.from(document.querySelectorAll('.phone-calendar-view-nav>a')).filter(visible).map(n=>n.textContent.trim()),
      calendarBottom:Math.round(calendar.getBoundingClientRect().bottom),
      gridClientHeight:grid.clientHeight,
      gridScrollHeight:grid.scrollHeight,
      gridOverflowY:getComputedStyle(grid).overflowY,
      eighteenVisible:visible(eighteen),
      eighteenBottom:eighteen?Math.round(eighteen.getBoundingClientRect().bottom):0,
      gridBottom:Math.round(grid.getBoundingClientRect().bottom),
      rootScrollHeight:document.documentElement.scrollHeight,
      headers:document.querySelectorAll('[data-phone-staff-column-id]').length,
      allPressed:document.querySelector('[data-phone-week-staff-all]')?.getAttribute('aria-pressed')||'',
    };
  })()`);
  assert.equal(metrics.todayVisible, false, `${viewport.name}: Today should be absent on current Week`);
  assert.deepEqual(metrics.utilityLabels, ['Week', 'Month']);
  assert.equal(metrics.headers, 7);
  assert.equal(metrics.allPressed, 'true');
  assert.equal(metrics.gridOverflowY, 'hidden');
  assert.ok(metrics.gridScrollHeight <= metrics.gridClientHeight + 2, `${viewport.name}: Week still scrolls vertically ${JSON.stringify(metrics)}`);
  assert.equal(metrics.eighteenVisible, true);
  assert.ok(metrics.eighteenBottom <= metrics.gridBottom + 2, `${viewport.name}: 18:00 is outside fitted grid`);
  assert.ok(metrics.calendarBottom <= viewport.height + 1, `${viewport.name}: Calendar exceeds viewport`);
  assert.ok(metrics.rootScrollHeight <= viewport.height + 2, `${viewport.name}: page still requires vertical scrolling ${JSON.stringify(metrics)}`);
  await screenshot(cdp, `week-${viewport.name}.png`);

  await navigate(cdp, `${origin}/?view=week&date=2026-09-10`);
  await poll(() => evaluate(cdp, `Boolean(document.querySelector('[data-phone-calendar-today]'))`), Boolean);
  const awayToday = await evaluate(cdp, `document.querySelector('[data-phone-calendar-today]')?.getAttribute('href')||''`);
  assert.match(awayToday, /view=week/);
  assert.match(awayToday, /date=2026-09-11/);
}

async function verifyFittedBooking(cdp, origin) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 384, height: 832, deviceScaleFactor: 1, mobile: true, screenWidth: 384, screenHeight: 832 });
  await navigate(cdp, `${origin}/?view=week&date=${TODAY}`);
  await poll(() => evaluate(cdp, `document.body.dataset.phoneWeekGridFitted`), value => value === 'true');
  await evaluate(cdp, `(() => {
    const column=document.querySelector('.week-view .time-column');
    const rect=column.getBoundingClientRect();
    const x=rect.left+rect.width*(2.5/7);
    const y=rect.top+rect.height*.5;
    column.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y,button:0}));
    return true;
  })()`);
  await poll(() => evaluate(cdp, 'location.pathname'), value => value === '/book');
  const target = await evaluate(cdp, `({date:new URL(location.href).searchParams.get('date'),time:new URL(location.href).searchParams.get('time'),staff:new URL(location.href).searchParams.get('staff')})`);
  assert.deepEqual(target, { date: TODAY, time: '12:30', staff: '53' });
}

async function verifyMonth(cdp, origin) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
  await navigate(cdp, `${origin}/?view=month&date=${TODAY}`);
  await poll(() => evaluate(cdp, `document.body.dataset.phoneCalendarSurfaceFitted`), value => value === 'true');
  const metrics = await evaluate(cdp, `(() => {
    const visible=node=>{if(!node)return false;const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&r.width>0&&r.height>0;};
    const calendar=document.querySelector('.calendar-view');
    const days=document.querySelector('.month-days');
    return {
      todayVisible:visible(document.querySelector('[data-phone-calendar-today]')),
      calendarBottom:Math.round(calendar.getBoundingClientRect().bottom),
      calendarHeight:Math.round(calendar.getBoundingClientRect().height),
      daysHeight:Math.round(days.getBoundingClientRect().height),
      rootScrollHeight:document.documentElement.scrollHeight,
    };
  })()`);
  assert.equal(metrics.todayVisible, true, 'Month should expose contextual Today');
  assert.ok(metrics.calendarHeight > 500, JSON.stringify(metrics));
  assert.ok(metrics.daysHeight > 430, JSON.stringify(metrics));
  assert.ok(metrics.calendarBottom <= 845, JSON.stringify(metrics));
  assert.ok(metrics.rootScrollHeight <= 846, JSON.stringify(metrics));
  await screenshot(cdp, 'month-iphone-class.png');

  await evaluate(cdp, `document.querySelector('[data-phone-calendar-today]').click();true`);
  await poll(() => evaluate(cdp, 'new URL(location.href).searchParams.get("view")'), value => value === 'week');
  const returnedDate = await evaluate(cdp, `new URL(location.href).searchParams.get('date')`);
  assert.equal(returnedDate, TODAY);
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) {
    if (process.env.CI) throw new Error('CI must provide Chrome');
    console.log('Chrome not installed; Phone viewport-fit proof is CI-only.');
    return;
  }
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = express();
  app.get('/', (req, res) => {
    const view = req.query.view === 'month' ? 'month' : 'week';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : TODAY;
    res.type('html').send(fixtureHtml(view, date));
  });
  app.get('/book', (_req, res) => res.type('html').send('<!doctype html><title>Booking target</title>'));
  app.get('/wrong-booking', (_req, res) => res.status(500).send('old fixed-grid handler should not win'));
  const server = http.createServer(app);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-phone-viewport-fit-'));
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
    for (const viewport of VIEWPORTS) await verifyWeek(cdp, origin, viewport);
    await verifyFittedBooking(cdp, origin);
    await verifyMonth(cdp, origin);
    console.log(`Phone viewport-fit proof passed for ${VIEWPORTS.map(v => `${v.width}x${v.height}`).join(', ')}`);
  } finally {
    try { cdp?.close(); } catch (_error) {}
    try { chrome?.kill('SIGKILL'); } catch (_error) {}
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
