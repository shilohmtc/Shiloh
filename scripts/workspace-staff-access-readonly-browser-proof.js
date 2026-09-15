// Permanent synthetic authenticated regression proof for Staff access.
//
// This proof intentionally retains the older bounded diagnostic Staff detail
// check while treating the friendly Staff access profile UI as the canonical
// owner-facing access editor.
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
const { createWorkspaceStaffRouter } = require('../src/routes/workspaceStaff');
const { createWorkspaceStaffMutationRouter } = require('../src/routes/workspaceStaffMutations');

const OUT_DIR = path.join(process.cwd(), 'artifacts', 'workspace-staff-access-editor-v1');
const ENV = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

function chromeExecutable() {
  return [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(candidate => candidate && fs.existsSync(candidate)) || null;
}
function fileSha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
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
async function poll(load, accept, timeoutMs = 15000) {
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
  throw new Error('Timed out waiting for authenticated Workspace Staff Access proof');
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
    send(method, params = {}, timeoutMs = 15000) {
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

function clinicTeam() {
  return {
    id: 20,
    staffId: 17,
    displayName: 'Naomi',
    active: true,
    profileKey: 'clinic_team_v1',
    profileLabel: 'Clinic team',
    profileSummary: 'Can see the clinic Workspace and finish their own visits. Clinic-wide management stays protected.',
    protectedRestrictions: [
      'Cannot change Clinic Hours.',
      'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
      'Cannot change client, service or staff records.',
    ],
    editable: true,
    revision: 'a'.repeat(64),
    toggles: [
      { key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Lets this team member finish only appointments that belong to them.', on: true },
    ],
  };
}
function ownWorkspace() {
  return {
    id: 31,
    staffId: 51,
    displayName: 'Marietjie',
    active: true,
    profileKey: 'own_workspace_v1',
    profileLabel: 'Own workspace',
    profileSummary: 'Can fully manage their own work while clinic-wide records and other practitioners stay protected.',
    protectedRestrictions: [
      'Cannot change Clinic Hours.',
      'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
      'Cannot access clinic-only client relationships.',
      'Cannot create services or change staff/access settings.',
    ],
    editable: true,
    revision: 'b'.repeat(64),
    toggles: [
      { key: 'manage_own_appointments', label: 'Manage my appointments', description: 'Create, reschedule, cancel and adjust only appointments inside this workspace boundary.', on: true },
      { key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Finish only appointments assigned to this practitioner.', on: true },
      { key: 'manage_my_clients', label: 'Manage my clients', description: 'Add and update this practitioner’s own client relationships.', on: true },
      { key: 'manage_my_services', label: 'Manage my services', description: 'Manage only services assigned and permitted to this practitioner.', on: true },
      { key: 'view_clinic_hours', label: 'View clinic hours', description: 'See clinic and booking hours without permission to change them.', on: true },
    ],
  };
}

async function main() {
  const executable = chromeExecutable();
  if (!executable) throw new Error('Chrome is required for authenticated Staff Access proof');

  let incompatible = false;
  let policyWrites = 0;
  let profileWrites = 0;
  let accessV2Writes = 0;
  const people = [clinicTeam(), ownWorkspace()];
  const authority = { operatorAdminId: 61, displayName: 'Access administrator' };

  const sessionService = {
    validateSessionToken: async token => token === 'synthetic-access-session'
      ? { ok: true, adminId: 61, sessionId: 'synthetic-access-session-id', viewer: { calendarScope: 'business_all_staff' } }
      : { ok: false },
    validateCsrfToken: () => false,
  };
  const accessService = {
    resolveManageAccess: async id => id === 61 ? authority : null,
    requireManageAccess: async id => { assert.equal(id, 61); return authority; },
    enableWorkspaceAccess: async () => { throw new Error('Proof must not enable access'); },
  };
  const accessPolicyService = {
    getPolicy: async (adminId, staffId) => {
      assert.equal(adminId, 61);
      assert.equal(String(staffId), '17');
      return incompatible
        ? { supported: false, reason: 'Existing access has a different role or scope and remains read-only in this bounded editor.' }
        : {
            supported: true,
            staffId: 17,
            role: 'practitioner',
            businessRole: 'employee_practitioner',
            calendarScope: 'own_appointments',
            serviceScope: 'own_services',
            capabilities: ['appointment:view'],
            revision: 'synthetic-access-revision',
            definitions: [
              { key: 'appointment:view', label: 'Workspace & Calendar', description: 'See your own Workspace Dashboard and permitted appointments.', mandatory: true },
              { key: 'booking:update', label: 'Complete / No-show visits', description: 'Record Completed or No-show only for visits whose canonical assignments resolve entirely to you.', mandatory: false },
            ],
          };
    },
    updatePolicy: async () => { policyWrites += 1; throw new Error('Browser proof must not perform policy writes'); },
  };
  const profileService = {
    list: async ({ adminId }) => { assert.equal(adminId, 61); return { authority, people }; },
    get: async ({ adminId, principalId }) => {
      assert.equal(adminId, 61);
      const person = people.find(item => item.id === Number(principalId));
      if (!person) throw Object.assign(new Error('Staff access was not found.'), { httpStatus: 404, code: 'STAFF_ACCESS_NOT_FOUND' });
      return { authority, person };
    },
    applyProfile: async () => { profileWrites += 1; throw new Error('CSRF must reject before Staff access profile writes'); },
    setToggle: async () => { profileWrites += 1; throw new Error('CSRF must reject before Staff access toggle writes'); },
  };
  const accessV2Service = {
    applyPreset: async () => { accessV2Writes += 1; throw new Error('CSRF must reject before Access V2 writes'); },
  };
  const staffService = {
    resolveAccess: async adminId => adminId === 61 ? { displayName: 'Access administrator' } : null,
    resolveManageAccess: async adminId => adminId === 61 ? authority : null,
    getStaffDetail: async ({ adminId }) => {
      assert.equal(adminId, 61);
      return {
        staff: { id: 17, display_name: 'Synthetic Practitioner', status: 'active', resource_type: 'practitioner', business_role: 'employee_practitioner', scheduling_type: 'regular', client_bookable: true, revision: 'synthetic-staff-revision' },
        services: [{ name: 'Synthetic treatment', duration_minutes: 60, status: 'active' }],
        manageAllowed: false,
        access: incompatible
          ? { businessRole: 'business_admin', calendarScope: 'all_business', serviceScope: 'all_services', capabilities: ['appointment:view', 'staff:manage'] }
          : { businessRole: 'employee_practitioner', calendarScope: 'own_appointments', serviceScope: 'own_services', capabilities: ['appointment:view'] },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.get('/calendar/staff/client.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  app.get('/calendar/workspace/nav.js', (_req, res) => res.type('application/javascript').send("'use strict';"));
  app.use('/calendar/team', createWorkspaceStaffMutationRouter({
    env: ENV,
    sessionService,
    service: staffService,
    accessService,
    accessCompletionService: { completeWorkspaceAccess: async () => { throw new Error('Proof must not complete access'); } },
    accessPolicyService,
    accessV2Service,
    profileService,
    receptionDeviceSigninService: {},
  }));
  app.use('/calendar/team', createWorkspaceStaffRouter({
    env: ENV,
    sessionService,
    service: staffService,
    accessService,
    accessPolicyService,
    accessV2Service,
    profileService,
    clientAccessService: { resolveAccess: async () => null },
  }));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-access-editor-proof-'));
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let server;
  let chrome;
  let cdp;
  try {
    server = https.createServer(createCertificate(directory), app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `https://127.0.0.1:${server.address().port}`;
    const port = await reservePort();
    chrome = spawn(executable, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
      '--ignore-certificate-errors', '--remote-allow-origins=*', `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(directory, 'profile')}`, 'about:blank',
    ], { stdio: 'ignore' });
    const targets = await poll(async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), value => value.some(target => target.type === 'page'));
    cdp = await connectCdp(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    let dialogs = 0;
    cdp.on('Page.javascriptDialogOpening', () => { dialogs += 1; });

    // No browser session: owner-facing Staff access is private.
    await cdp.send('Page.navigate', { url: `${origin}/calendar/team/staff-access` });
    await poll(() => evaluate(cdp, 'document.body.innerText'), value => value.includes('Unauthorized'));
    await cdp.send('Network.setCookie', { name: 'shiloh_staff_session', value: 'synthetic-access-session', url: origin, secure: true, httpOnly: true, sameSite: 'Strict' });

    const screenshots = [];
    async function capture(name) {
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = `${name}.png`;
      const target = path.join(OUT_DIR, file);
      fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
      return { file, sha256: fileSha256(target), bytes: fs.statSync(target).size };
    }

    // Keep the older technical staff detail as a bounded diagnostic compatibility proof.
    for (const broader of [false, true]) {
      incompatible = broader;
      for (const [name, width, height] of [['desktop', 1440, 960], ['phone', 390, 844]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
        await cdp.send('Page.navigate', { url: `${origin}/calendar/team/17?proof=${name}-${broader}` });
        const selector = broader ? '[data-staff-access-readonly]' : '[data-access-policy-editor]';
        await poll(() => evaluate(cdp, `document.readyState==='complete' && !!document.querySelector('${selector}')`), Boolean);
        const geometry = await evaluate(cdp, `({
          width:innerWidth,
          overflow:document.documentElement.scrollWidth>innerWidth,
          editor:!!document.querySelector('[data-staff-access-policy-form]'),
          readonly:!!document.querySelector('[data-staff-access-readonly]'),
          forbidden:Array.from(document.querySelectorAll('input[name="capability"]')).some(n=>!['appointment:view','booking:update'].includes(n.value)),
          text:document.body.innerText,
          targets:Array.from(document.querySelectorAll('a.button,button')).filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;}).map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))
        })`);
        assert.equal(geometry.width, width);
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.forbidden, false);
        assert.doesNotMatch(geometry.text, /synthetic-access-session|password|TOTP/i);
        if (broader) {
          assert.equal(geometry.editor, false);
          assert.equal(geometry.readonly, true);
          assert.doesNotMatch(geometry.text, /Save access/);
        } else {
          assert.equal(geometry.editor, true);
          assert.match(geometry.text, /Complete \/ No-show visits/);
          assert.match(geometry.text, /Own appointments/);
          assert.match(geometry.text, /Own services/);
        }
        if (width === 390) assert.ok(geometry.targets.every(target => target.height >= 44 && target.width >= 44));
        screenshots.push({ ...(await capture(`${name}-${broader ? 'incompatible' : 'practitioner'}-diagnostic`)), width, height, noOverflow: true, editor: geometry.editor });
      }
    }

    // Canonical owner-facing Staff access: friendly profiles and protected boundaries.
    for (const [route, label, expectedSwitches] of [
      ['/calendar/team/staff-access', 'access-list', 0],
      ['/calendar/team/staff-access/20', 'clinic-team', 1],
      ['/calendar/team/staff-access/31', 'own-workspace', 5],
    ]) {
      for (const [name, width, height] of [['desktop', 1440, 960], ['phone', 390, 844]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
        await cdp.send('Page.navigate', { url: `${origin}${route}?proof=${name}` });
        await poll(() => evaluate(cdp, "document.readyState==='complete' && !!document.querySelector('[data-workspace-staff-access]')"), Boolean);
        const geometry = await evaluate(cdp, `({
          width:innerWidth,
          overflow:document.documentElement.scrollWidth>innerWidth,
          text:document.body.innerText,
          switches:Array.from(document.querySelectorAll('[role="switch"]')).map(n=>({label:n.getAttribute('aria-label'),checked:n.getAttribute('aria-checked')})),
          targets:Array.from(document.querySelectorAll('a.button,button,.person-card')).filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;}).map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))
        })`);
        assert.equal(geometry.width, width);
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.switches.length, expectedSwitches);
        assert.doesNotMatch(geometry.text, /calendar_scope|service_scope|canonical principal|synthetic-access-session|TOTP|recovery code/i);
        assert.match(geometry.text, /Staff access/);
        if (label === 'access-list') {
          assert.match(geometry.text, /Naomi/);
          assert.match(geometry.text, /Marietjie/);
          assert.match(geometry.text, /Clinic team/);
          assert.match(geometry.text, /Own workspace/);
        }
        if (label === 'clinic-team') {
          assert.match(geometry.text, /Cannot change Clinic Hours\./);
          assert.match(geometry.text, /Cannot change client, service or staff records\./);
        }
        if (label === 'own-workspace') {
          assert.match(geometry.text, /Manage my appointments/);
          assert.match(geometry.text, /Manage my clients/);
          assert.match(geometry.text, /Manage my services/);
          assert.match(geometry.text, /Cannot edit, cancel, reassign or delete another practitioner’s appointments\./);
          assert.match(geometry.text, /Cannot access clinic-only client relationships\./);
          assert.ok(geometry.switches.every(item => item.label && item.checked === 'true'));
        }
        if (width === 390) assert.ok(geometry.targets.every(target => target.height >= 44 && target.width >= 44));
        screenshots.push({ ...(await capture(`${name}-${label}`)), width, height, noOverflow: true, switchCount: geometry.switches.length });
      }
    }

    // Old technical entry intentionally redirects to the friendly canonical page.
    await cdp.send('Page.navigate', { url: `${origin}/calendar/team/workspace-access` });
    await poll(() => evaluate(cdp, 'location.pathname'), value => value === '/calendar/team/staff-access');
    assert.match(await evaluate(cdp, 'document.body.innerText'), /Staff access/);

    // Mutation endpoints stay CSRF protected and must not reach mutation services.
    incompatible = false;
    const policyRejected = await evaluate(cdp, `fetch('/calendar/team/17/access/policy',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'proof_policy',expectedAccessRevision:'synthetic-access-revision',capabilities:['booking:update']})}).then(r=>r.status)`);
    assert.equal(policyRejected, 403);
    assert.equal(policyWrites, 0);

    const toggleRejected = await evaluate(cdp, `fetch('/calendar/team/staff-access/31/toggle',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'proof_toggle',expectedRevision:'${'b'.repeat(64)}',toggle:'manage_my_clients',on:false})}).then(r=>r.status)`);
    assert.equal(toggleRejected, 403);
    assert.equal(profileWrites, 0);

    const v2Rejected = await evaluate(cdp, `fetch('/calendar/team/workspace-access/20/preset',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'proof_v2',expectedRevision:'${'a'.repeat(64)}',preset:'employee_practitioner_v1'})}).then(r=>r.status)`);
    assert.equal(v2Rejected, 403);
    assert.equal(accessV2Writes, 0);
    assert.equal(dialogs, 0);

    const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
      exactHead,
      syntheticDataOnly: true,
      authenticated: true,
      productionReads: 0,
      productionMutations: 0,
      providerWrites: 0,
      policyWrites,
      profileWrites,
      accessV2Writes,
      csrfRejectedStatus: { policy: policyRejected, profileToggle: toggleRejected, accessV2: v2Rejected },
      nativeDialogs: dialogs,
      canonicalStaffAccessPath: '/calendar/team/staff-access',
      screenshots,
    }, null, 2));
    console.log(`Authenticated Staff access proof passed: ${screenshots.length} screenshots; CSRF denials ${policyRejected}/${toggleRejected}/${v2Rejected}; no access writes.`);
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { chromeExecutable, fileSha256, createCertificate, reservePort, poll, connectCdp, evaluate };
