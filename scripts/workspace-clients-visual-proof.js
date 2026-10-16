const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  renderClientListPage,
  renderClientDetailPage,
} = require('../src/presentation/workspaceClientsUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');

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

function clients() {
  return [
    { id: 901, name: 'Naledi Mokoena', normalized_mobile: '27821234001', profile_status: 'registered', status: 'active', last_visit_at: '2026-08-28T08:00:00.000Z' },
    { id: 902, name: 'Amina Daniels', normalized_mobile: '27821234002', profile_status: 'minimal', status: 'active', last_visit_at: null },
    { id: 903, name: 'Thandi Ndlovu', normalized_mobile: '27821234003', profile_status: 'registered', status: 'active', last_visit_at: '2026-08-24T12:00:00.000Z' },
    { id: 904, name: 'Zinhle Khumalo', normalized_mobile: '27821234004', profile_status: 'registered', status: 'active', last_visit_at: '2026-08-17T09:30:00.000Z' },
    { id: 905, name: 'Mia Petersen', normalized_mobile: '27821234005', profile_status: 'registered', status: 'active', last_visit_at: '2026-08-12T07:00:00.000Z' },
    { id: 906, name: 'Lerato Molefe', normalized_mobile: '27821234006', profile_status: 'minimal', status: 'active', last_visit_at: null },
  ];
}

function listHtml() {
  return renderClientListPage({
    clients: clients(), hasMore: true, offset: 0, pageSize: 24, query: '', status: 'active',
  }, { calendarNavigationAllowed: true });
}

function detailHtml() {
  return renderClientDetailPage({
    client: {
      id: 901,
      name: 'Naledi Mokoena',
      normalized_mobile: '27821234001',
      date_of_birth: '1991-06-14',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-08-15T10:00:00.000Z',
      status: 'active',
    },
    appointments: [
      { starts_at: '2026-08-28T08:00:00.000Z', ends_at: '2026-08-28T09:00:00.000Z', status: 'completed', title: 'Massage', services: [{ name: 'Bamboo Sports Massage' }], staff: [{ name: 'Christel' }] },
      { starts_at: '2026-08-08T10:00:00.000Z', ends_at: '2026-08-08T11:00:00.000Z', status: 'cancelled', title: 'Facial', services: [{ name: 'Brightening Facial' }], staff: [{ name: 'Abigail' }] },
      { starts_at: '2026-07-21T07:30:00.000Z', ends_at: '2026-07-21T08:30:00.000Z', status: 'completed', title: 'Pedicure', services: [{ name: 'Medi-Heel Pedicure' }], staff: [{ name: 'Christel' }] },
    ],
    hasMore: true, historyOffset: 0, pageSize: 20,
  }, { calendarNavigationAllowed: true });
}

function calendarHtml() {
  const model = {
    view: 'day', dateKey: '2026-08-30', todayKey: '2026-08-30', selectedStaffId: null,
    permittedStaff: [{ id: 1, displayName: 'Christel' }],
    period: { dateKeys: ['2026-08-30'], previousAnchor: '2026-08-29', nextAnchor: '2026-08-31' },
    timeline: {
      appointments: [], blocks: [], leave: [], closures: [], externalBusy: [], scheduleExceptions: [], recurringClosures: [],
      staff: [{ id: 1, displayName: 'Christel' }],
      workingWindows: [{ staffId: 1, dayOfWeek: 0, startsLocal: '08:00:00', endsLocal: '17:00:00' }],
    },
    readOnly: true, mutationCapability: { enabled: false },
  };
  return renderCalendarPage(model, { clientNavigationAllowed: true, clientsPath: '/calendar/clients' });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.CI) throw new Error('CI must provide Chrome for Workspace Clients visual proof');
  console.log('Chrome not installed; visual proof generation skipped outside CI.');
  process.exit(0);
}

const outDir = path.resolve(process.env.WORKSPACE_CLIENTS_PROOF_DIR || path.join(process.cwd(), 'artifacts', 'workspace-clients-v1-visual-proof'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const proofCases = [
  { view: 'clients-list', viewport: 'desktop', width: 1440, height: 960, html: listHtml() },
  { view: 'client-detail', viewport: 'desktop', width: 1440, height: 960, html: detailHtml() },
  { view: 'clients-list', viewport: 'narrow', width: 390, height: 844, html: listHtml() },
  { view: 'client-detail', viewport: 'narrow', width: 390, height: 844, html: detailHtml() },
  { view: 'calendar-navigation', viewport: 'desktop', width: 1440, height: 960, html: calendarHtml() },
];
const manifest = [];

for (const proof of proofCases) {
  if (!/aria-label="Workspace"/.test(proof.html) || !/>Calendar<|>Calendar<\//.test(proof.html) || !/>Clients<|>Clients<\//.test(proof.html)) {
    throw new Error(`${proof.view}/${proof.viewport} does not contain the shared Calendar and Clients Workspace navigation`);
  }
  const stem = `${proof.view}-${proof.viewport}`;
  const htmlPath = path.join(outDir, `${stem}.html`);
  const pngPath = path.join(outDir, `${stem}.png`);
  fs.writeFileSync(htmlPath, proof.html);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-clients-proof-'));
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${proof.width},${proof.height}`,
    `--user-data-dir=${profileDir}`, `--screenshot=${pngPath}`, '--virtual-time-budget=1000',
    pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8' });
  fs.rmSync(profileDir, { recursive: true, force: true });
  if (result.status !== 0 || !fs.existsSync(pngPath)) {
    throw new Error(`Chromium screenshot failed for ${proof.view}/${proof.viewport}: ${result.stderr || result.stdout || result.status}`);
  }
  const stat = fs.statSync(pngPath);
  manifest.push({ view: proof.view, viewport: proof.viewport, width: proof.width, height: proof.height, file: path.basename(pngPath), bytes: stat.size, sha256: sha256(pngPath) });
}

const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(exactHead)) throw new Error('Workspace Clients proof could not resolve the exact checked-out head');
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  exactHead,
  syntheticDataOnly: true,
  productionReads: 0,
  productionMutations: 0,
  screenshots: manifest,
}, null, 2)}\n`);
console.log(`Workspace Clients visual proof generated: ${manifest.length} screenshots`);
for (const item of manifest) console.log(`${item.view}/${item.viewport}: ${item.bytes} bytes sha256=${item.sha256}`);
