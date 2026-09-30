const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
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
    send(method, params = {}, timeoutMs = 15_000) {
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
    close() {
      socket.close();
    },
  };
}

async function waitForReady(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (result.result?.value === 'complete') return;
    await sleep(40);
  }
  throw new Error('Timed out waiting for mobile proof page to load');
}

const METRICS_EXPRESSION = `(() => {
  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight;
  }
  function rect(el) {
    const value = el.getBoundingClientRect();
    return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
  }
  const root = document.documentElement;
  const nav = document.querySelector('.workspace-nav');
  const menuToggle = document.querySelector('[data-workspace-drawer-toggle]');
  const frame = document.querySelector('.workspace-frame');
  const navLinks = Array.from(document.querySelectorAll('.workspace-link')).filter(visible);
  const targets = Array.from(document.querySelectorAll('.workspace-link,button,.button,.pager-link,.nav-button,.view-tab,.filter,.action-link')).filter(visible);
  const primary = Array.from(document.querySelectorAll('.client-row,.staff-row,.service-row,.panel,.profile-panel,.history-panel,.calendar-view,.controls,.scan-summary')).filter(visible);
  const controls = document.querySelector('.controls');
  const createPanel = document.querySelector('#add-staff-panel');
  const filterPanel = document.querySelector('main[data-staff-list-view] > .filter-panel');
  const management = document.querySelector('.management-card');
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    rootScrollWidth: root.scrollWidth,
    noPageOverflow: root.scrollWidth <= window.innerWidth + 1,
    navPosition: nav ? getComputedStyle(nav).position : null,
    navRight: nav ? nav.getBoundingClientRect().right : null,
    visibleNavLinks: navLinks.length,
    minNavHeight: navLinks.length ? Math.min(...navLinks.map(el => rect(el).height)) : 0,
    menuHeight: menuToggle ? rect(menuToggle).height : 0,
    framePaddingBottom: frame ? parseFloat(getComputedStyle(frame).paddingBottom) || 0 : 0,
    minTouchHeight: targets.length ? Math.min(...targets.map(el => rect(el).height)) : 0,
    overflowingPrimary: primary.filter(el => {
      const value = el.getBoundingClientRect();
      return value.left < -1 || value.right > window.innerWidth + 1;
    }).map(el => el.className),
    controlsPosition: controls ? getComputedStyle(controls).position : null,
    controlsColumns: controls ? getComputedStyle(controls).gridTemplateColumns : null,
    staffCreateCollapsed: createPanel ? createPanel.open === false : null,
    staffFilterOrder: filterPanel ? getComputedStyle(filterPanel).order : null,
    managementBottom: management ? getComputedStyle(management).bottom : null,
    managementRadius: management ? getComputedStyle(management).borderTopLeftRadius : null,
  };
})()`;

function assertMetrics(proof, metrics) {
  if (metrics.innerWidth !== proof.width || metrics.screenWidth !== proof.width) {
    throw new Error(`${proof.view} CSS viewport is ${metrics.innerWidth}px / screen ${metrics.screenWidth}px, expected ${proof.width}px`);
  }
  if (metrics.innerHeight !== proof.height || metrics.screenHeight !== proof.height) {
    throw new Error(`${proof.view} CSS viewport height is ${metrics.innerHeight}px / screen ${metrics.screenHeight}px, expected ${proof.height}px`);
  }
  if (!metrics.noPageOverflow) {
    throw new Error(`${proof.view} has page overflow: ${metrics.rootScrollWidth}px > ${metrics.innerWidth}px`);
  }
  if (metrics.navPosition !== 'fixed' || metrics.navRight > 1) {
    throw new Error(`${proof.view} does not keep Phone navigation hidden off-canvas`);
  }
  if (metrics.visibleNavLinks !== 0 || metrics.menuHeight < 44 || metrics.framePaddingBottom !== 0) {
    throw new Error(`${proof.view} still reserves persistent Phone navigation space`);
  }
  if (metrics.minTouchHeight < 43) {
    throw new Error(`${proof.view} has a touch target below 43px (${metrics.minTouchHeight})`);
  }
  if (metrics.overflowingPrimary.length) {
    throw new Error(`${proof.view} primary content exceeds viewport: ${metrics.overflowingPrimary.join(', ')}`);
  }
  if (proof.view === 'calendar-day' && (metrics.controlsPosition !== 'relative' || String(metrics.controlsColumns).trim().split(/\s+/).length !== 2)) {
    throw new Error(`${proof.view} Calendar controls did not use the compact Calendar-first Phone layout`);
  }
  if (proof.view === 'calendar-agenda-compact' && (metrics.controlsPosition !== 'static' || /\s/.test(String(metrics.controlsColumns).trim()))) {
    throw new Error(`${proof.view} Agenda controls did not retain the stacked compact layout`);
  }
  if (proof.view === 'staff-list-manage' && (String(metrics.staffFilterOrder) !== '1' || metrics.staffCreateCollapsed !== true)) {
    throw new Error(`${proof.view} staff creation form must stay collapsed while browsing the mobile list`);
  }
}

async function main() {
  const chrome = chromeExecutable();
  if (!chrome) {
    if (process.env.CI) throw new Error('CI must provide Chrome for strict Workspace mobile viewport proof');
    console.log('Chrome not installed; strict Workspace mobile viewport proof skipped outside CI.');
    return;
  }

  const outDir = path.resolve(process.env.WORKSPACE_MOBILE_PROOF_DIR || path.join(process.cwd(), 'artifacts', 'workspace-mobile-polish-v1'));
  const manifestPath = path.join(outDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Workspace Mobile Polish visual proof must run before strict viewport verification');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.screenshots) || !manifest.screenshots.length) throw new Error('Workspace Mobile Polish manifest contains no screenshots');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-mobile-cdp-'));
  const browser = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let cdp;
  try {
    const activePortPath = path.join(profileDir, 'DevToolsActivePort');
    await waitForFile(activePortPath);
    const [port] = fs.readFileSync(activePortPath, 'utf8').split(/\r?\n/);
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => {
      if (!response.ok) throw new Error(`Chrome target discovery failed: ${response.status}`);
      return response.json();
    });
    const page = targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome did not expose a page target');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const proof of manifest.screenshots) {
      const htmlPath = path.join(outDir, `${proof.view}.html`);
      const pngPath = path.join(outDir, proof.file);
      if (!fs.existsSync(htmlPath)) throw new Error(`Missing proof HTML for ${proof.view}`);

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: proof.width,
        height: proof.height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: proof.width,
        screenHeight: proof.height,
      });
      await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href });
      await waitForReady(cdp);
      await sleep(80);

      const evaluated = await cdp.send('Runtime.evaluate', {
        expression: METRICS_EXPRESSION,
        returnByValue: true,
      });
      const metrics = evaluated.result?.value;
      if (!metrics) throw new Error(`${proof.view} did not return strict mobile metrics`);
      assertMetrics(proof, metrics);

      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      });
      fs.writeFileSync(pngPath, Buffer.from(capture.data, 'base64'));
      const stat = fs.statSync(pngPath);
      proof.bytes = stat.size;
      proof.sha256 = sha256(pngPath);
      proof.metrics = metrics;
      proof.viewportProof = 'cdp-mobile-emulation';
      console.log(`${proof.view}: true viewport ${metrics.innerWidth}x${metrics.innerHeight} sha256=${proof.sha256}`);
    }

    manifest.assertions = {
      ...manifest.assertions,
      cssViewportMatchesRequested: true,
      cdpMobileEmulation: true,
    };
    manifest.viewportProof = 'cdp-mobile-emulation';
    manifest.viewportVerifiedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Strict Workspace mobile viewport proof verified: ${manifest.screenshots.length} screenshots`);
  } finally {
    if (cdp) cdp.close();
    browser.kill('SIGTERM');
    await sleep(100);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
