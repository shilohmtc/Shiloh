const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderWorkspaceNavigation,
  workspaceShellStyles,
} = require('../src/presentation/workspaceShell');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
const {
  renderServicesListPage,
  renderServiceDetailPage,
} = require('../src/presentation/workspaceServicesUx');
const { renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { safeError: servicesSafeError } = require('../src/routes/workspaceServices');
const { staffCalendarAccessClientScript } = require('../src/presentation/staffCalendarAccessUx');

function dashboardModel() {
  return {
    mode: 'owner_overview', displayName: 'A Very Long Friendly Staff Display Name',
    requestedDateKey: '2026-09-07', operationalDateKey: '2026-09-07',
    appointments: [], teamGroups: [], closures: [], awaitingFinalization: [], recentActivity: [],
    communications: null, calendar: { timeline: { staff: [] } },
  };
}

function serviceModel() {
  return {
    authority: { displayName: 'Naomi' }, hasMore: false, offset: 0, pageSize: 30,
    query: '', status: 'active',
    services: [{
      id: 9, name: 'Synthetic Massage', duration_minutes: 60, total_minutes: 60,
      price: '700.00', status: 'active', assigned_staff_count: 1,
      booking_eligibility: { eligible: true, clientBookableStaffCount: 1 },
    }],
  };
}

test('shared Workspace navigation owns one accessible account and sign-out footer', () => {
  const html = renderWorkspaceNavigation({ active: 'dashboard', displayName: 'A Very Long Friendly Staff Display Name' });
  assert.match(html, /data-workspace-account-footer/);
  assert.match(html, /Signed in as/);
  assert.match(html, /A Very Long Friendly Staff Display Name/);
  assert.equal((html.match(/data-shiloh-logout/g) || []).length, 1);
  assert.ok(html.indexOf('data-workspace-account-footer') > html.indexOf('</nav>'));
  assert.match(workspaceShellStyles(), /\.workspace-account\{[^}]*margin-top:auto/);
  assert.match(workspaceShellStyles(), /\.workspace-account strong\{[^}]*overflow-wrap:anywhere/);
  assert.match(workspaceShellStyles(), /\.workspace-account-signout\{min-height:44px;width:100%\}/);
});

test('Dashboard uses clinic language and has no duplicate header sign-out', () => {
  const html = renderDashboardPage(dashboardModel());
  assert.match(html, /Today's appointments and clinic activity\./);
  assert.match(html, /Signed in as/);
  assert.equal((html.match(/data-shiloh-logout/g) || []).length, 1);
  assert.doesNotMatch(html, /Africa\/Johannesburg · canonical Calendar authority/);
  assert.doesNotMatch(html, /clinic-wide operational view/);
});

test('Services presents exact clinic-facing labels without changing eligibility data', () => {
  const list = renderServicesListPage(serviceModel(), { manageAllowed: true });
  assert.match(list, /Manage services, pricing and practitioner assignments\./);
  assert.match(list, /Available for booking/);
  assert.doesNotMatch(list, /Booking ready|Results are bounded|Canonical offerings|services:view/);
  assert.equal((list.match(/data-shiloh-logout/g) || []).length, 1);

  const empty = renderServicesListPage({ ...serviceModel(), services: [] });
  assert.match(empty, /No services found\./);
  assert.match(empty, /View only/);
  assert.doesNotMatch(empty, /No canonical services|Canonical service authority/);

  const detail = renderServiceDetailPage({
    authority: { displayName: 'Naomi' },
    service: { id: 9, name: 'Synthetic Massage', status: 'active', total_minutes: 60, revision: 'r' },
    assignedStaff: [], practitioners: [],
    bookingEligibility: { eligible: true, clientBookableStaffCount: 1 },
  }, { manageAllowed: false });
  assert.match(detail, /You can view this service, but editing is not available\./);
  assert.doesNotMatch(detail, /services:manage|Canonical mutation authority|controlled slice/);
});

test('Clients and Messages keep internal architecture terms out of ordinary empty and access states', () => {
  const clientDetail = renderClientDetailPage({
    authority: { displayName: 'Naomi' },
    client: { id: 9, name: 'Synthetic Client', status: 'active', profile_status: 'registered' },
    appointments: [], hasMore: false, historyOffset: 0, pageSize: 20,
  });
  assert.match(clientDetail, /Client record/);
  assert.match(clientDetail, /No appointments are recorded for this client\./);
  assert.doesNotMatch(clientDetail, /Canonical client|CRM V2-linked/);

  const messages = renderMessagesPage({
    authority: { displayName: 'Naomi' }, selectedView: 'all', notificationAuthority: null,
    attention: [], activity: [], attentionUnavailable: false, activityUnavailable: false,
  });
  assert.match(messages, /Recovery actions are not available with your current access\./);
  assert.match(messages, /No current My Shiloh updates\./);
  assert.doesNotMatch(messages, /client:notify|canonical communication activity|Fail closed/);
});

test('Services fail-closed messages remain ordinary clinic language', () => {
  assert.equal(servicesSafeError({ httpStatus: 403 }).message, 'You do not have access to this Services action.');
  assert.equal(servicesSafeError({ httpStatus: 404 }).message, 'That service was not found.');
  assert.equal(servicesSafeError({ httpStatus: 409, message: 'Canonical Services changed internally.' }).message, 'Services changed. Reload and retry.');
  assert.equal(servicesSafeError({ httpStatus: 503 }).message, 'Services are temporarily unavailable.');
});

test('shared sign-out still uses the existing CSRF-protected logout endpoint', () => {
  const script = staffCalendarAccessClientScript();
  assert.match(script, /AUTH_BASE\+'\/csrf'/);
  assert.match(script, /AUTH_BASE\+'\/logout'/);
  assert.match(script, /x-shiloh-csrf-token/);
  assert.match(script, /data-shiloh-logout/);
});
