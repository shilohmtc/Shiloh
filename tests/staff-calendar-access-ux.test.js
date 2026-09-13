const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  renderStaffCalendarAccessPage,
  staffCalendarAccessClientScript,
} = require('../src/presentation/staffCalendarAccessUx');
const {
  createStaffCalendarAccessPageHandler,
  createStaffCalendarEmergencyPageHandler,
  createStaffCalendarAccessClientHandler,
  isStaffCalendarAccessUxEnabled,
} = require('../src/routes/staffCalendarAccessUx');
const {
  CALENDAR_VIEWER_CONTEXT,
  createCalendarReadOnlyHandler,
} = require('../src/routes/calendarReadOnlyUx');
const { createCalendarReadOnlyUxService } = require('../src/services/calendarReadOnlyUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');

function fakeResponse() {
  return {
    statusCode: null,
    contentType: null,
    body: null,
    headers: {},
    headersSent: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    send(value) { this.body = String(value); this.headersSent = true; return this; },
  };
}

function timelineFor(staff) {
  return {
    meta: {
      from: '2026-08-23T22:00:00.000Z',
      to: '2026-08-24T22:00:00.000Z',
      canonicalSources: ['appointments', 'appointment_staff'],
      nonCanonicalSources: ['google_calendar'],
      googleCalendarRequired: true,
    },
    staff,
    workingWindows: staff.map(person => ({
      kind: 'working_window', canonical: true, source: 'staff_working_hours',
      staffId: person.id, dayOfWeek: 1, startsLocal: '08:00:00', endsLocal: '17:00:00',
    })),
    scheduleExceptions: [],
    recurringClosures: [],
    appointments: [],
    blocks: [],
    leave: [],
    closures: [],
    externalBusy: [],
    events: [],
  };
}

const enabledEnv = {
  SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true',
  SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true',
};

test('staff Calendar access surface remains default-off and requires both existing Calendar gates', () => {
  assert.equal(isStaffCalendarAccessUxEnabled({}), false);
  assert.equal(isStaffCalendarAccessUxEnabled({ SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true' }), false);
  assert.equal(isStaffCalendarAccessUxEnabled({ SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED: 'true' }), false);
  assert.equal(isStaffCalendarAccessUxEnabled(enabledEnv), true);

  const off = createStaffCalendarAccessPageHandler({ env: {} });
  const offRes = fakeResponse();
  off({ query: {}, baseUrl: '/calendar/staff' }, offRes);
  assert.equal(offRes.statusCode, 404);

  const on = createStaffCalendarAccessPageHandler({ env: enabledEnv });
  const onRes = fakeResponse();
  on({ query: {}, baseUrl: '/calendar/staff' }, onRes);
  assert.equal(onRes.statusCode, 200);
  assert.match(onRes.headers['cache-control'], /no-store/);
  assert.match(onRes.headers['content-security-policy'], /script-src 'self'/);
  assert.match(onRes.headers['content-security-policy'], /connect-src 'self'/);
});

test('Workspace sign-in is human initiated and contains no retired fallback controls', () => {
  const html = renderStaffCalendarAccessPage();
  const client = staffCalendarAccessClientScript();
  assert.match(html, /Shiloh Workspace/);
  assert.match(html, /Open from Shiloh WhatsApp/);
  assert.match(html, /send <code>calendar<\/code>/);
  assert.doesNotMatch(html + client, /totp|recovery code|break-glass|Sign in with authenticator/i);
  assert.match(client, /if\(select\('\[data-shiloh-staff-calendar-access\]'\)\)probeSession\(\);/);
  assert.doesNotMatch(html + client, /beginChallenge|sendWhatsAppMessage|requestChallenge|verifyChallenge/);
});

test('#946 normal sign-in is passkey-only and the retired Emergency page redirects safely', () => {
  const emergencyEnv = {
    ...enabledEnv,
    SHILOH_STAFF_PASSKEY_AUTH_ENABLED: 'true',
    SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://app.shilohmtc.co.za',
    SHILOH_STAFF_WEBAUTHN_RP_ID: 'app.shilohmtc.co.za',
  };
  const normalRes = fakeResponse();
  createStaffCalendarAccessPageHandler({ env: emergencyEnv })({ query: {}, baseUrl: '/calendar/staff' }, normalRes);
  assert.equal(normalRes.statusCode, 200);
  assert.match(normalRes.body, /Continue with device sign-in/);
  assert.doesNotMatch(normalRes.body, /Emergency sign-in|href="\/calendar\/staff\/emergency"/);
  assert.doesNotMatch(normalRes.body, /data-shiloh-totp-form|data-shiloh-recovery-form/);

  const emergencyRes = fakeResponse();
  createStaffCalendarEmergencyPageHandler({ env: emergencyEnv })({ query: {} }, emergencyRes);
  assert.equal(emergencyRes.statusCode, 302);
  assert.equal(emergencyRes.headers.location, '/calendar/staff');
  assert.equal(emergencyRes.body, 'Found');
});

test('browser client uses only canonical session contracts and never persists browser authority', () => {
  const client = staffCalendarAccessClientScript();
  for (const endpoint of ['/session', '/csrf', '/logout']) {
    assert.match(client, new RegExp(endpoint.replace('/', '\\/')));
  }
  assert.doesNotMatch(client, /totp|break-glass|recovery\/verify/i);
  assert.doesNotMatch(client, /AUTH_BASE\+'\/challenge'/);
  assert.doesNotMatch(client, /AUTH_BASE\+'\/verify'/);
  assert.match(client, /WORKSPACE_PATH='\/calendar\/workspace'/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|document\.cookie|ADMIN_API_KEY|x-admin-key|Bearer\s|jsonwebtoken|\bJWT\b/i);
  assert.doesNotMatch(client, /location\.(?:assign|replace)[^\n]*(?:code|csrf|token)=/i);
  assert.doesNotMatch(client, /\/appointments|\/blocks|\/leave|\/schedule|\/reschedule|\/cancel/i);
});

test('sign-in UX exposes session-ended and logout states', () => {
  const client = staffCalendarAccessClientScript();
  const sessionPage = renderStaffCalendarAccessPage({ reason: 'session' });
  const logoutPage = renderStaffCalendarAccessPage({ reason: 'logout' });
  assert.match(sessionPage, /missing, expired, or revoked/i);
  assert.match(logoutPage, /You are signed out/i);
  assert.match(client, /Could not complete secure sign-out/);
});

test('CSRF material remains request-body or in-memory only and never enters URLs or persistent storage', () => {
  const html = renderStaffCalendarAccessPage();
  const client = staffCalendarAccessClientScript();
  assert.match(client, /body:JSON\.stringify\(payload\|\|\{\}\)/);
  assert.match(client, /csrfToken=String\(csrfBody\.csrfToken\|\|''\)/);
  assert.match(client, /'x-shiloh-csrf-token':csrfToken/);
  assert.doesNotMatch(html, /name="(?:code|csrf|token|session)/i);
  assert.doesNotMatch(html + client, /localStorage|sessionStorage|document\.cookie/i);
});

test('logout explicitly rotates CSRF then calls the accepted CSRF-protected logout endpoint', () => {
  const client = staffCalendarAccessClientScript();
  const csrfIndex = client.indexOf("AUTH_BASE+'/csrf'");
  const logoutIndex = client.indexOf("AUTH_BASE+'/logout'");
  assert.ok(csrfIndex >= 0);
  assert.ok(logoutIndex > csrfIndex);
  assert.match(client, /'x-shiloh-csrf-token':csrfToken/);
  assert.match(client, /ACCESS_PATH\+'\?reason=logout'/);
  assert.match(client, /ACCESS_PATH\+'\?reason=session'/);
});

test('revoked, missing or expired Calendar session redirects to staff sign-in before SchedulingTimeline is read', async () => {
  let buildCalls = 0;
  const handler = createCalendarReadOnlyHandler({
    env: enabledEnv,
    buildModel: async () => { buildCalls += 1; return {}; },
  });
  const res = fakeResponse();
  await handler({ query: {}, baseUrl: '/calendar/read-only' }, res, () => {});
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/calendar/staff?reason=session');
  assert.equal(buildCalls, 0);
});

test('own_staff scope has no practitioner switcher and a manual other-staff filter still fails closed', async () => {
  const ownViewer = { calendarScope: 'own_staff', staffId: 44 };
  const service = createCalendarReadOnlyUxService({
    listTimeline: async ({ viewer }) => {
      assert.deepEqual(viewer, { calendarScope: 'own_appointments', staffId: 44 });
      return timelineFor([{ id: 44, displayName: 'Christel' }]);
    },
  });
  const model = await service.buildModel({ view: 'day', date: '2026-08-24', viewer: ownViewer });
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  assert.match(html, /Christel • your permitted timeline/);
  assert.doesNotMatch(html, /All permitted/);
  assert.doesNotMatch(html, /staff=45/);
  await assert.rejects(
    service.buildModel({ view: 'day', date: '2026-08-24', staff: '45', viewer: ownViewer }),
    error => error.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN',
  );
});

test('business-wide presentation can switch only among practitioners returned by canonical SchedulingTimeline scope', async () => {
  const businessViewer = { calendarScope: 'business_all_staff' };
  const service = createCalendarReadOnlyUxService({
    listTimeline: async ({ viewer }) => {
      assert.deepEqual(viewer, { calendarScope: 'all_business' });
      return timelineFor([
        { id: 44, displayName: 'Christel' },
        { id: 45, displayName: 'Abigail' },
      ]);
    },
  });
  const model = await service.buildModel({ view: 'day', date: '2026-08-24', viewer: businessViewer });
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  assert.match(html, /data-people-picker/);
  assert.match(html, /1 of 2 visible/);
  assert.match(html, /staff=44/);
  assert.match(html, /staff=45/);
  assert.doesNotMatch(html, /staff=46/);
});

test('authenticated Calendar remains scheduling-read-only while adding only staff-session logout interaction', async () => {
  const viewer = { calendarScope: 'own_staff', staffId: 44 };
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => timelineFor([{ id: 44, displayName: 'Christel' }]),
  });
  const model = await service.buildModel({ view: 'day', date: '2026-08-24', viewer });
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  assert.match(html, /data-shiloh-logout/);
  assert.match(html, /Read-only operational view/);
  assert.doesNotMatch(html, /Create booking|Reschedule appointment|Cancel appointment|drag(?:gable)?|contenteditable/i);
  assert.doesNotMatch(html, /<form|method="post"/i);

  const accessRoute = fs.readFileSync(path.join(__dirname, '..', 'src/routes/staffCalendarAccessUx.js'), 'utf8');
  assert.doesNotMatch(accessRoute, /router\.(?:post|put|patch|delete)\s*\(/i);
  assert.doesNotMatch(accessRoute, /calendarScope|staffId|business_role|ADMIN_API_KEY|x-admin-key/i);
});

test('existing Calendar share ICS route remains separate and unchanged in authority', () => {
  const calendarRoute = fs.readFileSync(path.join(__dirname, '..', 'src/routes/calendar.js'), 'utf8');
  assert.match(calendarRoute, /router\.get\('\/:token\.ics'/);
  assert.match(calendarRoute, /appointment_calendar_share_tokens/);
  assert.match(calendarRoute, /METHOD:PUBLISH/);
  assert.match(calendarRoute, /router\.use\('\/staff-auth', createStaffBrowserSessionRouter/);
  assert.match(calendarRoute, /router\.use\('\/staff', staffCalendarAccessUxRoutes\)/);
  assert.match(calendarRoute, /router\.use\('\/read-only', createOptionalCalendarSessionMiddleware/);
});

test('staff access client asset is default-off with the same no-store browser security envelope', () => {
  const off = createStaffCalendarAccessClientHandler({ env: {} });
  const offRes = fakeResponse();
  off({}, offRes);
  assert.equal(offRes.statusCode, 404);

  const on = createStaffCalendarAccessClientHandler({ env: enabledEnv });
  const onRes = fakeResponse();
  on({}, onRes);
  assert.equal(onRes.statusCode, 200);
  assert.match(onRes.contentType, /application\/javascript/);
  assert.match(onRes.headers['cache-control'], /no-store/);
  assert.match(onRes.body, /\/calendar\/staff-auth/);
});
