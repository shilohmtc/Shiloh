const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { renderServicesListPage, renderServiceDetailPage } = require('../src/presentation/workspaceServicesUx');

function chromeExecutable() {
  const candidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

const services = [
  { id: 1, name: 'Full Body Swedish', category_name: 'Massage', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 0, total_minutes: 60, variable_price: false, price: '650.00', display_price: null, status: 'active', assigned_staff_count: 3, client_bookable_staff_count: 2, booking_eligibility: { eligible: true, clientBookableStaffCount: 2 } },
  { id: 2, name: 'Bamboo Sports Massage', category_name: 'Massage', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 15, total_minutes: 75, variable_price: false, price: '780.00', display_price: null, status: 'active', assigned_staff_count: 2, client_bookable_staff_count: 1, booking_eligibility: { eligible: true, clientBookableStaffCount: 1 } },
  { id: 3, name: 'Advanced Facial Consultation', category_name: 'Facials', duration_minutes: 45, processing_time_minutes: 0, extra_time_minutes: 0, total_minutes: 45, variable_price: true, price: '450.00', display_price: 'From R450', status: 'active', assigned_staff_count: 1, client_bookable_staff_count: 0, booking_eligibility: { eligible: false, clientBookableStaffCount: 0 } },
  { id: 4, name: 'Legacy Treatment', category_name: 'Massage', duration_minutes: 30, processing_time_minutes: 0, extra_time_minutes: 0, total_minutes: 30, variable_price: false, price: '300.00', display_price: null, status: 'inactive', assigned_staff_count: 1, client_bookable_staff_count: 1, booking_eligibility: { eligible: false, clientBookableStaffCount: 1 } },
];

const options = {
  calendarNavigationAllowed: true,
  clientsNavigationAllowed: true,
  staffNavigationAllowed: true,
  staffAccessScriptPath: '/calendar/staff/client.js',
  manageAllowed: true,
};

function listHtml() {
  return renderServicesListPage({ services, hasMore: false, offset: 0, pageSize: 30, query: '', status: 'all' }, options);
}

function detailHtml() {
  return renderServiceDetailPage({
    service: {
      ...services[0],
      revision: 'a'.repeat(64),
      customer_description: 'A calming full-body massage using classic Swedish techniques.',
      booking_note: 'Please arrive a few minutes before your appointment.',
    },
    assignedStaff: [
      { id: 1, display_name: 'Practitioner One', resource_type: 'practitioner', status: 'active', client_bookable: true },
      { id: 2, display_name: 'Practitioner Two', resource_type: 'practitioner', status: 'active', client_bookable: true },
      { id: 20, display_name: 'Internal Resource', resource_type: 'business_resource', status: 'active', client_bookable: false },
    ],
    practitioners: [
      { id: 1, display_name: 'Practitioner One', status: 'active', client_bookable: true, assigned: true },
      { id: 2, display_name: 'Practitioner Two', status: 'active', client_bookable: true, assigned: true },
      { id: 3, display_name: 'Practitioner Three', status: 'active', client_bookable: true, assigned: false },
    ],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 2, authority: 'read_projection_only' },
  }, options);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.CI) throw new Error('CI must provide Chrome for Workspace Services visual proof');
  console.log('Chrome not installed; visual proof generation skipped outside CI.');
  process.exit(0);
}

const outDir = path.resolve(process.env.WORKSPACE_SERVICES_PROOF_DIR || path.join(process.cwd(), 'artifacts', 'workspace-services-v1-visual-proof'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const proofs = [
  { view: 'services-list', viewport: 'desktop', width: 1440, height: 960, html: listHtml() },
  { view: 'service-detail', viewport: 'desktop', width: 1440, height: 960, html: detailHtml() },
  { view: 'services-list', viewport: 'narrow', width: 390, height: 844, html: listHtml() },
  { view: 'service-detail', viewport: 'narrow', width: 390, height: 844, html: detailHtml() },
];
const manifest = [];

for (const proof of proofs) {
  if (!/aria-current="page">Services/.test(proof.html) || !/>Calendar<|>Calendar<\//.test(proof.html) || !/>Clients<|>Clients<\//.test(proof.html) || !/>Staff<|>Staff<\//.test(proof.html)) {
    throw new Error(`${proof.view}/${proof.viewport} lacks shared Workspace navigation`);
  }
  if (proof.view === 'service-detail' && (!/data-service-edit-form/.test(proof.html) || !/data-service-description-form/.test(proof.html) || !/data-service-assign-form/.test(proof.html))) {
    throw new Error(`${proof.view}/${proof.viewport} lacks Services Stage B management controls`);
  }
  const stem = `${proof.view}-${proof.viewport}`;
  const htmlPath = path.join(outDir, `${stem}.html`);
  const pngPath = path.join(outDir, `${stem}.png`);
  fs.writeFileSync(htmlPath, proof.html);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-services-proof-'));
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
if (!/^[0-9a-f]{40}$/.test(exactHead)) throw new Error('Workspace Services proof could not resolve exact head');
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), exactHead, syntheticDataOnly: true, productionReads: 0, productionMutations: 0, servicesStageBManageUx: true, screenshots: manifest }, null, 2)}\n`);
console.log(`Workspace Services visual proof generated: ${manifest.length} screenshots`);
