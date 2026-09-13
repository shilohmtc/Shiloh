const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');
const express = require('express');

const requestContext = require('../src/middleware/requestContext');
const {
  requireStaffSession,
  serializeSessionCookie,
} = require('../src/middleware/staffBrowserSession');
const {
  createWorkspacePwaRouter,
  createWorkspacePwaHtmlMiddleware,
} = require('../src/routes/workspacePwa');
const {
  workspaceShellStyles,
  renderWorkspaceNavigation,
} = require('../src/presentation/workspaceShell');
const {
  renderStaffCalendarAccessPage,
} = require('../src/presentation/staffCalendarAccessUx');
const { retireBrowserWhatsAppGuidance } = require('../src/routes/staffCalendarAccessUx');

const execFileAsync = promisify(execFile);
const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-pwa-v1');
const SESSION_TOKEN = 'A'.repeat(43);
const ENV = { NODE_ENV: 'production', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' };

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
  if (generated.status !== 0) throw new Error(`OpenSSL proof certificate failed: ${generated.stderr}`);
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

async function chromeRun(chrome, args) {
  const chromeArgs = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--ignore-certificate-errors',
    '--allow-insecure-localhost', '--disable-dev-shm-usage', ...args,
  ];
  try {
    const result = await execFileAsync(chrome, chromeArgs, {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout || '';
  } catch (error) {
    throw new Error(`Chrome proof failed: ${error.stderr || error.stdout || error.message}`);
  }
}

async function captureScreenshot(chrome, args, filePath) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fs.rmSync(filePath, { force: true });
    await chromeRun(chrome, args);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
  }
  throw new Error(`Chrome proof did not materialize screenshot: ${path.basename(filePath)}`);
}

function workspaceHtml() {
  const nav = renderWorkspaceNavigation({
    active: 'dashboard',
    dashboardHref: '/calendar/workspace',
    calendarHref: '/calendar/read-only',
    clientsHref: '/calendar/clients',
    messagesHref: '/calendar/messages',
    staffHref: null,
    servicesHref: null,
    reportsHref: null,
    displayName: 'Synthetic Practitioner',
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shiloh Workspace PWA proof</title><style>${workspaceShellStyles()}body{margin:0;background:#f7f5ef;color:#20322b;font-family:Inter,system-ui,sans-serif}.proof-main{padding:24px}.proof-card{max-width:720px;padding:20px;border:1px solid #dfe5df;border-radius:16px;background:#fffdf9}.proof-card h1{margin:0 0 8px}.proof-card p{line-height:1.45}</style><script src="/proof-client.js" defer></script></head><body><div class="workspace-frame">${nav}<main class="workspace-main"><section class="proof-main"><div class="proof-card" data-authenticated-workspace><h1>Shiloh Workspace</h1><p>Authenticated synthetic practitioner. Canonical server session required.</p><a href="/calendar/read-only">Calendar</a></div></section></main></div></body></html>`;
}

function createFixture() {
  const state = { valid: true };
  const sessionService = {
    async validateSessionToken(token) {
      if (state.valid && token === SESSION_TOKEN) {
        return { ok: true, sessionId: 791, adminId: 1791, recoveryRequired: false, viewer: { calendarScope: 'own_staff', staffId: 91 } };
      }
      return { ok: false, code: 'STAFF_SESSION_INVALID' };
    },
  };
  const app = express();
  app.use(requestContext);
  app.use('/calendar', createWorkspacePwaHtmlMiddleware());
  app.use('/calendar/pwa', createWorkspacePwaRouter({ sessionService, env: ENV }));
  app.get('/proof-client.js', (_req, res) => res.type('application/javascript').send("addEventListener('load',async()=>{document.documentElement.dataset.rootOverflow=String(document.documentElement.scrollWidth>document.documentElement.clientWidth);document.documentElement.dataset.displayStandalone=String(!!(matchMedia&&matchMedia('(display-mode: standalone)').matches));try{await navigator.serviceWorker.ready;document.documentElement.dataset.swReady='true';}catch(_error){document.documentElement.dataset.swReady='false';}});"));
  app.get('/proof-auth', (_req, res) => {
    state.valid = true;
    res.setHeader('Set-Cookie', serializeSessionCookie(SESSION_TOKEN, { env: ENV, maxAgeSeconds: 3600 }));
    return res.redirect(302, '/calendar/pwa/launch');
  });
  app.get('/proof-expired', (_req, res) => {
    state.valid = false;
    res.setHeader('Set-Cookie', serializeSessionCookie(SESSION_TOKEN, { env: ENV, maxAgeSeconds: 3600 }));
    return res.redirect(302, '/calendar/pwa/launch');
  });
  app.get('/calendar/staff', (req, res) => {
    const reason = String(req.query.reason || '');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return res.type('html').send(retireBrowserWhatsAppGuidance(renderStaffCalendarAccessPage({ reason, providerIndependentAuthEnabled: true })));
  });
  app.get('/calendar/staff-auth/session', requireStaffSession({ service: sessionService, env: ENV }), (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.json({ viewer: req.staffBrowserSession.viewer, recoveryRequired: false });
  });
  app.get('/calendar/workspace', requireStaffSession({ service: sessionService, env: ENV }), (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return res.type('html').send(workspaceHtml());
  });
  app.get('/calendar/workspace/navigation', requireStaffSession({ service: sessionService, env: ENV }), (_req, res) => res.json({}));
  app.get('/calendar/workspace/nav.js', (_req, res) => res.type('application/javascript').send(''));
  return { app, state };
}

async function main() {
  const chrome = chromeExecutable();
  if (!chrome) throw new Error('Chrome/Chromium is required for #791 authenticated browser proof');
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-pwa-proof-'));
  const cert = createCertificate(temp);
  const port = await reservePort();
  const { app } = createFixture();
  const server = https.createServer(cert, app);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const origin = `https://127.0.0.1:${port}`;
  const androidUa = '--user-agent=Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

  try {
    const manifestText = await new Promise((resolve, reject) => {
      https.get(`${origin}/calendar/pwa/manifest.webmanifest`, { rejectUnauthorized: false }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.name, 'Shiloh');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/calendar/pwa/launch');
    assert.deepEqual(manifest.icons.map(icon => [icon.sizes, icon.type, icon.purpose]), [['192x192','image/png','any'],['512x512','image/png','any'],['512x512','image/png','maskable']]);

    const phoneProfile = path.join(temp, 'phone-profile');
    const phonePng = path.join(OUT_DIR, 'phone-390x844.png');
    await captureScreenshot(chrome, [`--user-data-dir=${phoneProfile}`, androidUa, '--window-size=390,844', `--screenshot=${phonePng}`, `${origin}/proof-auth`], phonePng);
    const phoneDom = await chromeRun(chrome, [`--user-data-dir=${phoneProfile}`, androidUa, '--window-size=390,844', '--virtual-time-budget=1600', '--dump-dom', `${origin}/proof-auth`]);
    assert.match(phoneDom, /data-authenticated-workspace/);
    assert.match(phoneDom, /data-root-overflow="false"/);
    assert.match(phoneDom, /manifest\.webmanifest\?v=956-v1/);
    assert.match(phoneDom, /data-sw-ready="true"/);
    assert.doesNotMatch(phoneDom, /In Chrome, tap the .*Add to Home screen/);
    assert.match(phoneDom, /data-workspace-drawer-toggle/);

    const desktopProfile = path.join(temp, 'desktop-profile');
    const desktopPng = path.join(OUT_DIR, 'desktop-1440x900.png');
    await captureScreenshot(chrome, [`--user-data-dir=${desktopProfile}`, '--window-size=1440,900', `--screenshot=${desktopPng}`, `${origin}/proof-auth`], desktopPng);
    const desktopDom = await chromeRun(chrome, [`--user-data-dir=${desktopProfile}`, '--window-size=1440,900', '--virtual-time-budget=1600', '--dump-dom', `${origin}/proof-auth`]);
    assert.match(desktopDom, /data-authenticated-workspace/);
    assert.match(desktopDom, /data-root-overflow="false"/);
    assert.match(desktopDom, /Synthetic Practitioner/);
    assert.doesNotMatch(desktopDom, /manifest\.webmanifest|\/calendar\/pwa\/client\.js|data-shiloh-browser-install|data-shiloh-ios-install/);

    const expiredProfile = path.join(temp, 'expired-profile');
    const expiredPng = path.join(OUT_DIR, 'expired-session.png');
    await captureScreenshot(chrome, [`--user-data-dir=${expiredProfile}`, androidUa, '--window-size=390,844', `--screenshot=${expiredPng}`, `${origin}/proof-expired`], expiredPng);
    const expiredDom = await chromeRun(chrome, [`--user-data-dir=${expiredProfile}`, androidUa, '--window-size=390,844', '--virtual-time-budget=1000', '--dump-dom', `${origin}/proof-expired`]);
    assert.match(expiredDom, /data-shiloh-status(?:="")? data-state="session-ended"><\/div>/);
    assert.doesNotMatch(expiredDom, /data-authenticated-workspace/);

    const report = {
      issue: 791,
      syntheticOnly: true,
      productionCredentialMutation: false,
      manifest: { name: manifest.name, display: manifest.display, startUrl: manifest.start_url, scope: manifest.scope },
      authenticatedPhone: { viewport: '390x844', rootHorizontalOverflow: false, screenshot: path.basename(phonePng), sha256: sha256(phonePng) },
      authenticatedDesktop: { viewport: '1440x900', rootHorizontalOverflow: false, pwaExposed: false, screenshot: path.basename(desktopPng), sha256: sha256(desktopPng) },
      expiredSession: { redirectedToCanonicalEntry: true, persistentStaleWarning: false, screenshot: path.basename(expiredPng), sha256: sha256(expiredPng) },
      installabilityPrerequisites: { raster192: true, raster512: true, maskable512: true, serviceWorkerReady: true, stableId: manifest.id, stableStartUrl: manifest.start_url, stableScope: manifest.scope },
      standaloneLimitation: 'Headless Chromium proves raster manifest prerequisites, service-worker readiness and standalone metadata, but cannot prove Android OS/WebAPK Home-screen installation. Real-device standalone launch remains the final acceptance check.',
    };
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
