const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { renderClientListPage, renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const { renderStaffListPage, renderStaffDetailPage } = require('../src/presentation/workspaceStaffUx');
const { renderServicesListPage, renderServiceDetailPage } = require('../src/presentation/workspaceServicesUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { applyCalendarResponsivePolish } = require('../src/routes/calendarReadOnlyUx');

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

function clientsListHtml() {
  return renderClientListPage({
    clients: [
      { id: 901, name: 'Naledi Mokoena With A Deliberately Long Canonical Name', normalized_mobile: '27821234001', status: 'active', last_appointment_at: '2026-09-01T08:00:00.000Z' },
      { id: 902, name: 'Amina Daniels', normalized_mobile: '27821234002', status: 'active', last_appointment_at: null },
      { id: 903, name: 'Thandi Ndlovu', normalized_mobile: '27821234003', status: 'active', last_appointment_at: '2026-08-24T12:00:00.000Z' },
    ],
    hasMore: true, offset: 0, pageSize: 24, query: '', status: 'active',
  }, { calendarNavigationAllowed: true });
}

function clientDetailHtml() {
  return renderClientDetailPage({
    client: {
      id: 901,
      name: 'Naledi Mokoena With A Deliberately Long Canonical Name',
      normalized_mobile: '27821234001',
      date_of_birth: '1991-06-14',
      gender: 'female',
      profile_status: 'registered',
      mobile_verified_at: '2026-08-15T10:00:00.000Z',
      status: 'active',
    },
    appointments: [
      { id: 7001, starts_at: '2026-09-03T08:00:00.000Z', ends_at: '2026-09-03T09:15:00.000Z', status: 'confirmed', title: 'Massage', services: [{ name: 'Bamboo Sports Massage With Extended Treatment Description' }], staff: [{ name: 'Christel' }] },
      { id: 7002, starts_at: '2026-08-08T10:00:00.000Z', ends_at: '2026-08-08T11:00:00.000Z', status: 'cancelled', title: 'Facial', services: [{ name: 'Brightening Facial' }], staff: [{ name: 'Abigail' }] },
    ],
    communications: [], communicationsUnavailable: false,
    hasMore: false, historyOffset: 0, pageSize: 20,
  }, { calendarNavigationAllowed: true });
}

const staffRows = [
  { id: 1, display_name: 'Christel With A Longer Operational Display Name', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 18, active_admin_count: 1, business_role: 'business_admin' },
  { id: 2, display_name: 'Abigail', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 8, active_admin_count: 1, business_role: 'employee_practitioner' },
  { id: 3, display_name: 'ILince', resource_type: 'practitioner', status: 'active', scheduling_type: 'regular', client_bookable: true, service_count: 1, active_admin_count: 1, business_role: 'employee_practitioner' },
];

function staffListHtml() {
  return renderStaffListPage({
    staff: staffRows, hasMore: false, offset: 0, pageSize: 30, query: '', status: 'active', manageAllowed: true,
  }, {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  });
}

function staffDetailHtml() {
  return renderStaffDetailPage({
    staff: { ...staffRows[0], revision: 'a'.repeat(64) },
    services: [
      { name: 'Full Body Swedish', duration_minutes: 60, status: 'active' },
      { name: 'Bamboo Sports Massage With Extended Treatment Description', duration_minutes: 75, status: 'active' },
    ],
    access: {
      businessRole: 'business_admin', calendarScope: 'all_business', serviceScope: 'all_services',
      capabilities: ['appointment:create', 'appointment:view', 'client:lookup', 'schedule:manage', 'staff:view'],
    },
    manageAllowed: true,
  }, {
    calendarNavigationAllowed: true,
    clientsNavigationAllowed: true,
    staffAccessScriptPath: '/calendar/staff/client.js',
  });
}

const servicesRows = [
  { id: 1, name: 'Bamboo Sports Massage With Extended Treatment Description', category_name: 'Massage', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 15, total_minutes: 75, variable_price: false, price: '780.00', display_price: null, status: 'active', assigned_staff_count: 2, client_bookable_staff_count: 1, booking_eligibility: { eligible: true, clientBookableStaffCount: 1 } },
  { id: 2, name: 'Advanced Facial Consultation', category_name: 'Facials', duration_minutes: 45, processing_time_minutes: 0, extra_time_minutes: 0, total_minutes: 45, variable_price: true, price: '450.00', display_price: 'From R450', status: 'active', assigned_staff_count: 1, client_bookable_staff_count: 0, booking_eligibility: { eligible: false, clientBookableStaffCount: 0 } },
  { id: 3, name: 'Full Body Swedish', category_name: 'Massage', duration_minutes: 60, processing_time_minutes: 0, extra_time_minutes: 0, total_minutes: 60, variable_price: false, price: '650.00', display_price: null, status: 'active', assigned_staff_count: 3, client_bookable_staff_count: 2, booking_eligibility: { eligible: true, clientBookableStaffCount: 2 } },
];

const servicesOptions = {
  calendarNavigationAllowed: true,
  clientsNavigationAllowed: true,
  staffNavigationAllowed: true,
  staffAccessScriptPath: '/calendar/staff/client.js',
  manageAllowed: true,
};

function servicesListHtml() {
  return renderServicesListPage({
    services: servicesRows, hasMore: false, offset: 0, pageSize: 30, query: '', status: 'active',
  }, servicesOptions);
}

function serviceDetailHtml() {
  return renderServiceDetailPage({
    service: {
      ...servicesRows[0], revision: 'b'.repeat(64),
      customer_description: 'A deliberately longer customer-facing treatment description to prove natural mobile wrapping without horizontal page overflow.',
      booking_note: 'Please arrive a few minutes before your appointment.',
    },
    assignedStaff: [
      { id: 1, display_name: 'Christel With A Longer Operational Display Name', resource_type: 'practitioner', status: 'active', client_bookable: true },
      { id: 2, display_name: 'Abigail', resource_type: 'practitioner', status: 'active', client_bookable: true },
    ],
    practitioners: [
      { id: 1, display_name: 'Christel With A Longer Operational Display Name', status: 'active', client_bookable: true, assigned: true },
      { id: 2, display_name: 'Abigail', status: 'active', client_bookable: true, assigned: true },
      { id: 3, display_name: 'ILince', status: 'active', client_bookable: true, assigned: false },
    ],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 2, authority: 'read_projection_only' },
  }, servicesOptions);
}

function calendarHtml(view = 'day') {
  const appointments = [
    {
      id: 7001, kind: 'appointment', canonical: true, source: 'appointments', status: 'confirmed',
      clientName: 'Naledi Mokoena With A Deliberately Long Canonical Name',
      serviceName: 'Bamboo Sports Massage With Extended Treatment Description',
      serviceContexts: [{ serviceName: 'Bamboo Sports Massage With Extended Treatment Description', categoryName: 'Massage' }],
      startsAt: '2026-09-03T06:00:00.000Z', endsAt: '2026-09-03T07:15:00.000Z',
      staffIds: [1], staff: [{ staffId: 1, nameSnapshot: 'Christel' }],
    },
    {
      id: 7002, kind: 'appointment', canonical: true, source: 'appointments', status: 'scheduled',
      clientName: 'Amina Daniels', serviceName: 'Advanced Facial Consultation',
      serviceContexts: [{ serviceName: 'Advanced Facial Consultation', categoryName: 'Facials' }],
      startsAt: '2026-09-03T08:30:00.000Z', endsAt: '2026-09-03T09:15:00.000Z',
      staffIds: [2], staff: [{ staffId: 2, nameSnapshot: 'Abigail' }],
    },
  ];
  const dateKeys = ['2026-09-03','2026-09-04','2026-09-05','2026-09-06','2026-09-07','2026-09-08','2026-09-09'];
  const model = {
    view,
    dateKey: '2026-09-03',
    selectedStaffId: null,
    permittedStaff: [{ id: 1, displayName: 'Christel' }, { id: 2, displayName: 'Abigail' }],
    period: {
      startKey: '2026-09-03', previousAnchor: '2026-09-02', nextAnchor: view === 'day' ? '2026-09-04' : '2026-09-10',
      dateKeys: view === 'day' ? ['2026-09-03'] : dateKeys,
    },
    timeline: {
      staff: [{ id: 1, displayName: 'Christel' }, { id: 2, displayName: 'Abigail' }],
      workingWindows: [
        { staffId: 1, dayOfWeek: 4, startsLocal: '08:00:00', endsLocal: '17:00:00' },
        { staffId: 2, dayOfWeek: 4, startsLocal: '08:00:00', endsLocal: '17:00:00' },
      ],
      scheduleExceptions: [], recurringClosures: [], closures: [], leave: [], externalBusy: [], blocks: [],
      appointments, events: appointments,
    },
    mutationCapability: { enabled: false },
  };
  return applyCalendarResponsivePolish(renderCalendarPage(model, {
    clientNavigationAllowed: true,
    operationalActions: [{ label: 'Create booking', href: '/calendar/book?date=2026-09-03', tone: 'primary' }],
    timelineReadOnlyMessage: 'Timeline remains read-only in this synthetic mobile proof.',
  }));
}

function stripExternalScripts(html) {
  return String(html).replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/gi, '');
}

function instrument(html) {
  const probe = `<pre id="mobile-proof-metrics" hidden></pre><script>(function(){
    function visible(el){if(!el)return false;var s=getComputedStyle(el);var r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.right>0&&r.left<window.innerWidth&&r.bottom>0&&r.top<window.innerHeight;}
    function rect(el){var r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};}
    var root=document.documentElement;
    var nav=document.querySelector('.workspace-nav');
    var menuToggle=document.querySelector('[data-workspace-drawer-toggle]');
    var frame=document.querySelector('.workspace-frame');
    var navLinks=Array.from(document.querySelectorAll('.workspace-link')).filter(visible);
    var targets=Array.from(document.querySelectorAll('.workspace-link,button,.button,.pager-link,.nav-button,.view-tab,.filter,.action-link')).filter(visible);
    var primary=Array.from(document.querySelectorAll('.client-row,.staff-row,.service-row,.panel,.profile-panel,.history-panel,.calendar-view,.controls,.scan-summary')).filter(visible);
    var overflowingPrimary=primary.filter(function(el){var r=el.getBoundingClientRect();return r.left < -1 || r.right > window.innerWidth + 1;}).map(function(el){return el.className;});
    var controls=document.querySelector('.controls');
    var createPanel=document.querySelector('#add-staff-panel');
    var filterPanel=document.querySelector('main[data-staff-list-view] > .filter-panel');
    var management=document.querySelector('.management-card');
    var metrics={
      innerWidth:window.innerWidth,
      rootScrollWidth:root.scrollWidth,
      noPageOverflow:root.scrollWidth <= window.innerWidth + 1,
      navPosition:nav?getComputedStyle(nav).position:null,
      navRight:nav?nav.getBoundingClientRect().right:null,
      visibleNavLinks:navLinks.length,
      minNavHeight:navLinks.length?Math.min.apply(null,navLinks.map(function(el){return rect(el).height;})):0,
      menuHeight:menuToggle?rect(menuToggle).height:0,
      framePaddingBottom:frame?parseFloat(getComputedStyle(frame).paddingBottom)||0:0,
      minTouchHeight:targets.length?Math.min.apply(null,targets.map(function(el){return rect(el).height;})):0,
      overflowingPrimary:overflowingPrimary,
      controlsPosition:controls?getComputedStyle(controls).position:null,
      controlsColumns:controls?getComputedStyle(controls).gridTemplateColumns:null,
      staffCreateCollapsed:createPanel?createPanel.open===false:null,
      staffFilterOrder:filterPanel?getComputedStyle(filterPanel).order:null,
      managementBottom:management?getComputedStyle(management).bottom:null,
      managementRadius:management?getComputedStyle(management).borderTopLeftRadius:null
    };
    document.getElementById('mobile-proof-metrics').textContent=JSON.stringify(metrics);
  })();</script>`;
  return stripExternalScripts(html).replace('</body>', `${probe}</body>`);
}

function parseMetrics(dump, label) {
  const match = String(dump || '').match(/<pre id="mobile-proof-metrics" hidden="">([^<]+)<\/pre>/i)
    || String(dump || '').match(/<pre id="mobile-proof-metrics" hidden>([^<]+)<\/pre>/i);
  if (!match) throw new Error(`${label} did not emit mobile proof metrics`);
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

const chrome = chromeExecutable();
if (!chrome) {
  if (process.env.CI) throw new Error('CI must provide Chrome for Workspace Mobile Polish proof');
  console.log('Chrome not installed; Workspace Mobile Polish proof skipped outside CI.');
  process.exit(0);
}

const outDir = path.resolve(process.env.WORKSPACE_MOBILE_PROOF_DIR || path.join(process.cwd(), 'artifacts', 'workspace-mobile-polish-v1'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const cases = [
  { name: 'calendar-day', width: 390, height: 844, html: calendarHtml('day'), controlLayout: 'calendar-first' },
  { name: 'calendar-agenda-compact', width: 360, height: 800, html: calendarHtml('agenda'), controlLayout: 'stacked' },
  { name: 'clients-list', width: 390, height: 844, html: clientsListHtml() },
  { name: 'client-detail-compact', width: 360, height: 800, html: clientDetailHtml() },
  { name: 'staff-list-manage', width: 390, height: 844, html: staffListHtml(), expectStaffOrder: true },
  { name: 'staff-detail', width: 390, height: 844, html: staffDetailHtml() },
  { name: 'services-list', width: 390, height: 844, html: servicesListHtml() },
  { name: 'service-detail-compact', width: 360, height: 800, html: serviceDetailHtml() },
];

const screenshots = [];
for (const proof of cases) {
  const html = instrument(proof.html);
  if (!/aria-label="Workspace"/.test(html)) throw new Error(`${proof.name} lacks shared Workspace navigation`);
  const htmlPath = path.join(outDir, `${proof.name}.html`);
  const pngPath = path.join(outDir, `${proof.name}.png`);
  fs.writeFileSync(htmlPath, html);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-mobile-proof-'));
  const common = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${proof.width},${proof.height}`, `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=1200', pathToFileURL(htmlPath).href,
  ];
  const dump = spawnSync(chrome, ['--dump-dom', ...common], { encoding: 'utf8' });
  if (dump.status !== 0) {
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw new Error(`Chromium DOM probe failed for ${proof.name}: ${dump.stderr || dump.stdout || dump.status}`);
  }
  const metrics = parseMetrics(dump.stdout, proof.name);
  if (!metrics.noPageOverflow) throw new Error(`${proof.name} has page overflow: ${metrics.rootScrollWidth}px > ${metrics.innerWidth}px`);
  if (metrics.navPosition !== 'fixed' || metrics.navRight > 1) throw new Error(`${proof.name} does not keep Phone navigation hidden off-canvas`);
  if (metrics.visibleNavLinks !== 0 || metrics.menuHeight < 44 || metrics.framePaddingBottom !== 0) throw new Error(`${proof.name} still reserves persistent Phone navigation space`);
  if (metrics.minTouchHeight < 43) throw new Error(`${proof.name} has a touch target below 43px (${metrics.minTouchHeight})`);
  if (metrics.overflowingPrimary.length) throw new Error(`${proof.name} primary content exceeds viewport: ${metrics.overflowingPrimary.join(', ')}`);
  if (proof.controlLayout === 'calendar-first' && (metrics.controlsPosition !== 'relative' || String(metrics.controlsColumns).trim().split(/\s+/).length !== 2)) {
    throw new Error(`${proof.name} Calendar controls did not use the compact Calendar-first Phone layout: ${JSON.stringify(metrics)}`);
  }
  if (proof.controlLayout === 'stacked' && (metrics.controlsPosition !== 'static' || /\s/.test(String(metrics.controlsColumns).trim()))) {
    throw new Error(`${proof.name} Agenda controls did not retain the stacked compact layout: ${JSON.stringify(metrics)}`);
  }
  if (proof.expectStaffOrder && (String(metrics.staffFilterOrder) !== '1' || metrics.staffCreateCollapsed !== true)) {
    throw new Error(`${proof.name} staff creation form must stay collapsed while browsing the mobile list`);
  }

  const shot = spawnSync(chrome, [`--screenshot=${pngPath}`, ...common], { encoding: 'utf8' });
  fs.rmSync(profileDir, { recursive: true, force: true });
  if (shot.status !== 0 || !fs.existsSync(pngPath)) throw new Error(`Chromium screenshot failed for ${proof.name}: ${shot.stderr || shot.stdout || shot.status}`);
  const stat = fs.statSync(pngPath);
  screenshots.push({
    view: proof.name, width: proof.width, height: proof.height,
    file: path.basename(pngPath), bytes: stat.size, sha256: sha256(pngPath), metrics,
  });
}

const exactHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(exactHead)) throw new Error('Workspace Mobile Polish proof could not resolve exact checked-out head');
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  exactHead,
  syntheticDataOnly: true,
  productionReads: 0,
  productionMutations: 0,
  providerNetworkCalls: 0,
  permissionMutations: 0,
  assertions: {
    hiddenPhoneNavigationDrawer: true,
    noRootPageOverflow: true,
    minimumTouchTargetPx: 43,
    calendarControlsSingleColumn: true,
    staffOperationalListBeforeCreation: true,
  },
  screenshots,
}, null, 2)}\n`);
console.log(`Workspace Mobile Polish proof generated: ${screenshots.length} phone screenshots`);
for (const item of screenshots) console.log(`${item.view}: ${item.bytes} bytes sha256=${item.sha256}`);
