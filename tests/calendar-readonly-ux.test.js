const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createCalendarReadOnlyUxService } = require('../src/services/calendarReadOnlyUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const {
  CALENDAR_VIEWER_CONTEXT,
  createCalendarReadOnlyHandler,
  isFeatureEnabled,
} = require('../src/routes/calendarReadOnlyUx');

function timelineFixture() {
  const appointments = [{
    kind: 'appointment', canonical: true, source: 'appointments', id: 880,
    startsAt: '2026-08-24T07:00:00.000Z', endsAt: '2026-08-24T08:30:00.000Z', status: 'booked', clientName: 'Taylor Client', serviceName: 'Therapeutic Massage',
    staffIds: [1, 2],
    staff: [
      { staffId: 1, nameSnapshot: 'Julia', source: 'appointment_staff' },
      { staffId: 2, nameSnapshot: 'Christel', source: 'appointment_staff' },
    ],
    provenance: { authority: 'appointments', canonical: true },
  }];
  const blocks = [{
    kind: 'calendar_block', canonical: true, source: 'calendar_blocks', id: 44,
    startsAt: '2026-08-24T10:00:00.000Z', endsAt: '2026-08-24T11:00:00.000Z',
    staffIds: [1], blockType: 'admin', title: 'Internal block', provenance: { authority: 'calendar_blocks', canonical: true },
  }];
  const leave = [{
    kind: 'approved_leave', canonical: true, source: 'staff_leave_requests', id: 55,
    startsAt: '2026-08-24T12:00:00.000Z', endsAt: '2026-08-24T14:00:00.000Z',
    staffIds: [2], reason: 'Approved leave', provenance: { authority: 'staff_leave_requests', canonical: true },
  }];
  const closures = [{
    kind: 'clinic_closure', canonical: true, source: 'public_holidays', id: 'holiday:2026-08-25',
    date: '2026-08-25', reason: 'Public holiday', provenance: { authority: 'public_holidays', canonical: true },
  }];
  const externalBusy = [{
    kind: 'external_busy', canonical: false, source: 'google_calendar', id: 'google-shared',
    startsAt: '2026-08-24T09:00:00.000Z', endsAt: '2026-08-24T09:30:00.000Z',
    summary: 'External busy', staffIds: [1, 2],
    provenance: { authority: 'PR #395 Google conflict classification', canonical: false },
  }];
  return {
    meta: {
      from: '2026-08-23T22:00:00.000Z', to: '2026-08-24T22:00:00.000Z', viewerScope: 'all_business',
      canonicalSources: ['appointments', 'appointment_staff'], nonCanonicalSources: ['google_calendar'], googleCalendarRequired: true,
    },
    staff: [
      { id: 1, displayName: 'Julia', schedulingType: 'regular', calendarScope: 'all_business' },
      { id: 2, displayName: 'Christel', schedulingType: 'regular', calendarScope: 'all_business' },
    ],
    workingWindows: [
      { kind: 'working_window', canonical: true, source: 'staff_working_hours', staffId: 1, dayOfWeek: 1, startsLocal: '08:00:00', endsLocal: '17:00:00' },
      { kind: 'working_window', canonical: true, source: 'staff_working_hours', staffId: 2, dayOfWeek: 1, startsLocal: '08:00:00', endsLocal: '17:00:00' },
    ],
    scheduleExceptions: [], recurringClosures: [], appointments, blocks, leave, closures, externalBusy,
    events: [...appointments, ...blocks, ...leave, ...closures, ...externalBusy],
  };
}

async function canonicalMobileQuery() {
  return { rows: [{ appointment_id: '880', client_mobile: '27821234567' }] };
}

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

const viewer = { staffId: 99, calendarScope: 'all_business' };

async function buildDayModel() {
  const service = createCalendarReadOnlyUxService({ listTimeline: async () => timelineFixture(), query: canonicalMobileQuery });
  return service.buildModel({ view: 'day', date: '2026-08-24', viewer, now: new Date('2026-08-24T10:00:00Z') });
}

test('Day, Week, Agenda and Month all consume the same SchedulingTimeline contract through one server adapter', async () => {
  const calls = [];
  const service = createCalendarReadOnlyUxService({
    listTimeline: async input => { calls.push(input); return timelineFixture(); },
    query: canonicalMobileQuery,
  });
  const models = [];
  for (const view of ['day', 'week', 'agenda', 'month']) {
    models.push(await service.buildModel({ view, date: '2026-08-24', viewer, now: new Date('2026-08-24T10:00:00Z') }));
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => call.viewer), [viewer, viewer, viewer, viewer]);
  assert.ok(calls.every(call => !Object.hasOwn(call, 'staffIds')), 'UX adapter must not invent an independent authorization filter');
  assert.deepEqual(models.map(model => model.view), ['day', 'week', 'agenda', 'month']);
  assert.ok(models.every(model => model.readOnly === true));
});

test('production Calendar UX is default-off and fails closed before SchedulingTimeline when no browser-safe staff session exists', async () => {
  assert.equal(isFeatureEnabled({}), false);
  let buildCalls = 0;
  const disabledHandler = createCalendarReadOnlyHandler({
    env: {},
    buildModel: async () => { buildCalls += 1; return {}; },
  });
  const disabledRes = fakeResponse();
  await disabledHandler({ query: {}, baseUrl: '/calendar/read-only' }, disabledRes, () => {});
  assert.equal(disabledRes.statusCode, 404);
  assert.equal(buildCalls, 0);

  const enabledHandler = createCalendarReadOnlyHandler({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true' },
    buildModel: async () => { buildCalls += 1; return {}; },
  });
  const enabledRes = fakeResponse();
  await enabledHandler({ query: {}, baseUrl: '/calendar/read-only' }, enabledRes, () => {});
  assert.equal(enabledRes.statusCode, 503);
  assert.match(enabledRes.body, /Secure browser staff sign-in is not configured/i);
  assert.equal(buildCalls, 0, 'no SchedulingTimeline read is permitted without server-authenticated viewer context');
});

test('ADMIN_API_KEY and browser credential storage cannot leak into Calendar HTML', async () => {
  const model = await buildDayModel();
  const secret = 'never-embed-this-admin-key';
  const handler = createCalendarReadOnlyHandler({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true', ADMIN_API_KEY: secret },
    buildModel: async ({ viewer: resolvedViewer }) => {
      assert.deepEqual(resolvedViewer, viewer);
      return model;
    },
  });
  const req = { query: {}, baseUrl: '/calendar/read-only' };
  req[CALENDAR_VIEWER_CONTEXT] = { authenticated: true, source: 'server_staff_session', viewer };
  const res = fakeResponse();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, new RegExp(secret));
  assert.doesNotMatch(res.body, /ADMIN_API_KEY|x-admin-key|localStorage|sessionStorage|document\.cookie/i);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
});

test('PR #380 multi-practitioner appointment renders once as one canonical shared appointment', async () => {
  const model = await buildDayModel();
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  const matches = html.match(/data-event-id="appointment-880"/g) || [];
  assert.equal(matches.length, 1, 'shared appointment must not be cloned into practitioner pseudo-appointments');
  assert.match(html, /Taylor Client/);
  assert.match(html, /Therapeutic Massage/);
  assert.match(html, /Appointment #880/);
  assert.match(html, /Julia \+ Christel/);
  assert.match(html, /one canonical booking/i);
});

test('Google-only and non-canonical debug items are not rendered', async () => {
  const model = await buildDayModel();
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  assert.doesNotMatch(html, /Google-only|Non-canonical|google-shared|data-canonical="false"/i);
  assert.match(html, /Shiloh schedule/);
});

test('provider or SchedulingTimeline failure renders explicit unavailable state without leaking scheduling data', async () => {
  const error = new Error('provider detail that must not reach browser');
  error.code = 'SCHEDULING_GOOGLE_CALENDAR_REQUIRED';
  const handler = createCalendarReadOnlyHandler({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true' },
    buildModel: async () => { throw error; },
  });
  const req = { query: {}, baseUrl: '/calendar/read-only' };
  req[CALENDAR_VIEWER_CONTEXT] = { authenticated: true, source: 'server_staff_session', viewer };
  const res = fakeResponse();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /Calendar unavailable/);
  assert.match(res.body, /Calendar is temporarily unavailable/i);
  assert.doesNotMatch(res.body, /provider detail that must not reach browser/);
});

test('practitioner filtering is display-only and rejects staff outside server-permitted SchedulingTimeline scope', async () => {
  const service = createCalendarReadOnlyUxService({
    listTimeline: async () => ({ ...timelineFixture(), staff: [timelineFixture().staff[0]] }),
    query: canonicalMobileQuery,
  });
  await assert.rejects(
    service.buildModel({ view: 'day', date: '2026-08-24', staff: '2', viewer }),
    error => error.code === 'CALENDAR_UX_STAFF_FILTER_FORBIDDEN',
  );
  const allowed = await service.buildModel({ view: 'day', date: '2026-08-24', staff: '1', viewer });
  assert.deepEqual(allowed.timeline.staff.map(item => item.id), [1]);
  assert.equal(allowed.timeline.appointments.length, 1, 'shared appointment remains one appointment when filtering to one assigned practitioner');
  assert.deepEqual(allowed.timeline.appointments[0].staffIds, [1, 2], 'authoritative multi-staff assignment is not rewritten for display');

  const handler = createCalendarReadOnlyHandler({
    env: { SHILOH_CALENDAR_READONLY_UX_ENABLED: 'true' },
    buildModel: input => service.buildModel({ ...input, date: '2026-08-24' }),
    bookingService: { resolveOperator: async () => { throw new Error('not allowed'); } },
  });
  const req = { query: { staff: ['1', '2'] }, baseUrl: '/calendar/read-only' };
  req[CALENDAR_VIEWER_CONTEXT] = { authenticated: true, source: 'server_staff_session', viewer };
  const res = fakeResponse();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /outside your Calendar access/i);
  assert.doesNotMatch(res.body, /Taylor Client|Christel|appointment-880/);
});

test('navigation is GET-only/read-only and existing appointment-share ICS route remains intact', async () => {
  const model = await buildDayModel();
  const html = renderCalendarPage(model, { basePath: '/calendar/read-only' });
  assert.doesNotMatch(html, /method="post"|fetch\(|XMLHttpRequest|draggable|contenteditable/i);
  assert.match(html, /<form class="people-form" method="get"/);
  assert.match(html, /Today/);
  assert.doesNotMatch(html, /data-calendar-view-option="day"/);
  assert.match(html, />Week<|>Agenda</);

  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendarReadOnlyUx.js'), 'utf8');
  assert.doesNotMatch(routeSource, /router\.(?:post|put|patch|delete)\s*\(/i);
  assert.doesNotMatch(routeSource, /x-admin-key|ADMIN_API_KEY|localStorage|sessionStorage/i);

  const icsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendar.js'), 'utf8');
  assert.match(icsSource, /router\.get\('\/:token\.ics'/);
  assert.match(icsSource, /appointment_calendar_share_tokens/);
  assert.match(icsSource, /text\/calendar; charset=utf-8/);
  assert.match(icsSource, /METHOD:PUBLISH/);
  assert.match(icsSource, /router\.use\('\/read-only', createOptionalCalendarSessionMiddleware\(\{ service: staffBrowserSessionService \}\), createCalendarReadOnlyRouter\(\{/);
  assert.match(icsSource, /renderPage: renderCalendarPageWithScopedAvailabilityFocus/);
  assert.match(icsSource, /SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED|createOptionalCalendarSessionMiddleware/);
});
