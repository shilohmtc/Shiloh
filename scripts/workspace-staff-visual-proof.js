const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { renderStaffListPage, renderStaffDetailPage } = require('../src/presentation/workspaceStaffUx');
const { decorateStaffDetailAccessHtml } = require('../src/presentation/workspaceStaffAccessUx');
const { decorateStaffListOnboardingHtml } = require('../src/presentation/workspaceStaffOnboardingUx');

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

const staff = [
  { id: 1, display_name: 'Christel', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 18, active_admin_count: 1, business_role: 'business_admin' },
  { id: 2, display_name: 'Abigail', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 8, active_admin_count: 1, business_role: 'employee_practitioner' },
  { id: 3, display_name: 'ILince', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 1, active_admin_count: 1, business_role: 'employee_practitioner' },
  { id: 4, display_name: 'Pieter', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: false, service_count: 4, active_admin_count: 0, business_role: null },
];

const renderOptions = {
  calendarNavigationAllowed: true,
  clientsNavigationAllowed: true,
  staffAccessScriptPath: '/calendar/staff/client.js',
};

function listHtml() {
  return renderStaffListPage({ staff, hasMore: false, offset: 0, pageSize: 30, query: '', status: 'active' }, renderOptions);
}

function onboardingHtml() {
  const base = renderStaffListPage({
    staff,
    hasMore: false,
    offset: 0,
    pageSize: 30,
    query: '',
    status: 'active',
    manageAllowed: true,
    accessManageAllowed: true,
    authority: { displayName: 'Synthetic Owner' },
  }, renderOptions);
  return decorateStaffListOnboardingHtml(base, {
    manageAllowed: true,
    accessManageAllowed: true,
  });
}

function onboardingAccessHtml() {
  return onboardingHtml()
    .replace('<option value="none">No Workspace access</option>', '<option value="none">No Workspace access</option>')
    .replace('<option value="practitioner">Practitioner access</option>', '<option value="practitioner" selected>Practitioner access</option>')
    .replace(/ data-onboarding-identity hidden/g, ' data-onboarding-identity');
}

function detailHtml() {
  return renderStaffDetailPage({
    staff: staff[0],
    services: [
      { name: 'Full Body Swedish', duration_minutes: 60, status: 'active' },
      { name: 'Bamboo Sports Massage', duration_minutes: 60, status: 'active' },
      { name: 'Cupping Area Specific', duration_minutes: 45, status: 'active' },
    ],
    access: {
      businessRole: 'business_admin',
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      capabilities: ['appointment:create', 'appointment:view', 'calendar:booking:cancel', 'client:lookup', 'schedule:manage', 'staff:view'],
    },
  }, renderOptions);
}

function accessTarget() {
  return {
    ...staff[2],
    calendar_scope: 'own_appointments',
    revision: 'a'.repeat(64),
  };
}

function accessEnableHtml() {
  const target = accessTarget();
  const base = renderStaffDetailPage({
    staff: target,
    services: [{ name: 'Sports Massage', duration_minutes: 60, status: 'active' }],
    access: null,
    manageAllowed: false,
  }, renderOptions);
  return decorateStaffDetailAccessHtml(base, {
    staff: target,
    access: null,
    accessManageAllowed: true,
  });
}

function accessCompleteHtml() {
  const target = accessTarget();
  const access = {
    businessRole: 'employee_practitioner',
    calendarScope: 'own_appointments',
    serviceScope: 'own_services',
    capabilities: [],
  };
  const base = renderStaffDetailPage({
    staff: target,
    services: [{ name: 'Full Body Swedish', duration_minutes: 60, status: 'active' }],
    access,
    manageAllowed: false,
  }, renderOptions);
  return decorateStaffDetailAccessHtml(base, {
    staff: target,
    access,
    accessManageAllowed: true,
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.CI) throw new Error('CI must provide Chrome for Workspace Staff visual proof');
  console.log('Chrome not installed; visual proof generation skipped outside CI.');
  process.exit(0);
}

const outDir = path.resolve(process.env.WORKSPACE_STAFF_PROOF_DIR || path.join(process.cwd(), 'artifacts', 'workspace-staff-v1-visual-proof'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const proofs = [
  { view: 'staff-list', viewport: 'desktop', width: 1440, height: 960, html: listHtml() },
  { view: 'staff-onboarding', viewport: 'desktop', width: 1440, height: 1100, html: onboardingHtml() },
  { view: 'staff-onboarding-access', viewport: 'desktop', width: 1440, height: 1100, html: onboardingAccessHtml() },
  { view: 'staff-detail', viewport: 'desktop', width: 1440, height: 960, html: detailHtml() },
  { view: 'staff-access-enable', viewport: 'desktop', width: 1440, height: 960, html: accessEnableHtml() },
  { view: 'staff-access-complete', viewport: 'desktop', width: 1440, height: 960, html: accessCompleteHtml() },
  { view: 'staff-list', viewport: 'narrow', width: 390, height: 844, html: listHtml() },
  { view: 'staff-onboarding', viewport: 'narrow', width: 390, height: 1200, html: onboardingHtml() },
  { view: 'staff-onboarding-access', viewport: 'narrow', width: 390, height: 1500, html: onboardingAccessHtml() },
  { view: 'staff-detail', viewport: 'narrow', width: 390, height: 844, html: detailHtml() },
  { view: 'staff-access-enable', viewport: 'narrow', width: 390, height: 1600, html: accessEnableHtml() },
  { view: 'staff-access-complete', viewport: 'narrow', width: 390, height: 1600, html: accessCompleteHtml() },
];
const manifest = [];

for (const proof of proofs) {
  if (!/aria-current="page">Staff/.test(proof.html) || !/>Calendar<|>Calendar<\//.test(proof.html) || !/>Client Directory<|>Client Directory<\//.test(proof.html)) {
    throw new Error(`${proof.view}/${proof.viewport} lacks shared Workspace navigation`);
  }
  if (proof.view === 'staff-onboarding' && (!/data-staff-onboarding-form/.test(proof.html) || !/Practitioner access/.test(proof.html) || !/data-onboarding-identity hidden/.test(proof.html))) {
    throw new Error(`${proof.view}/${proof.viewport} lacks the guided default no-access state`);
  }
  if (proof.view === 'staff-onboarding-access' && (!/data-staff-onboarding-form/.test(proof.html) || !/value="practitioner" selected/.test(proof.html) || !/Staff WhatsApp mobile/.test(proof.html) || /data-onboarding-identity hidden/.test(proof.html))) {
    throw new Error(`${proof.view}/${proof.viewport} lacks the guided practitioner-access state`);
  }
  if (proof.view === 'staff-access-enable' && (!/Enable Workspace access/.test(proof.html) || !/name="identityConfirmed"/.test(proof.html))) {
    throw new Error(`${proof.view}/${proof.viewport} lacks the bounded Access enablement controls`);
  }
  if (proof.view === 'staff-access-complete' && (!/Complete Workspace access/.test(proof.html) || !/data-access-mode="complete"/.test(proof.html) || !/name="identityConfirmed"/.test(proof.html))) {
    throw new Error(`${proof.view}/${proof.viewport} lacks the bounded legacy Access completion controls`);
  }
  const stem = `${proof.view}-${proof.viewport}`;
  const htmlPath = path.join(outDir, `${stem}.html`);
  const pngPath = path.join(outDir, `${stem}.png`);
  fs.writeFileSync(htmlPath, proof.html);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-staff-proof-'));
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${proof.width},${proof.height}`, `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, '--virtual-time-budget=1000', pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8' });
  fs.rmSync(profileDir, { recursive: true, force: true });
  if (result.status !== 0 || !fs.existsSync(pngPath)) throw new Error(`Chromium screenshot failed: ${result.stderr || result.stdout || result.status}`);
  const stat = fs.statSync(pngPath);
  manifest.push({ view: proof.view, viewport: proof.viewport, width: proof.width, height: proof.height, file: path.basename(pngPath), bytes: stat.size, sha256: sha256(pngPath) });
}

const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(exactHead)) throw new Error('Workspace Staff proof could not resolve exact head');
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), exactHead, syntheticDataOnly: true, productionReads: 0, productionMutations: 0, screenshots: manifest }, null, 2)}\n`);
console.log(`Workspace Staff visual proof generated: ${manifest.length} screenshots`);
