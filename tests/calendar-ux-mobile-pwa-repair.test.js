'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  renderCalendarPage,
  renderEventCard,
  calendar823Styles,
} = require('../src/presentation/calendarReadOnlyUx');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');
const { calendarAppointmentEndTimeClientScript } = require('../src/presentation/calendarAppointmentEndTimeUx');
const { calendarManageAppointmentNotesClientScript } = require('../src/presentation/calendarAppointmentNotesUx');
const { calendarPhoneCompactV2ClientScript } = require('../src/presentation/calendarPhoneCompactV2');
const { workspacePwaClientScript } = require('../src/presentation/workspacePwa');
const {
  createWorkspacePwaHtmlMiddleware,
  isMobilePwaRequest,
} = require('../src/routes/workspacePwa');

const STAFF = Array.from({ length: 7 }, (_unused, index) => ({
  id: index + 1,
  displayName: `Practitioner ${index + 1}`,
  schedulingType: 'regular',
}));

function appointment(id, staffIds, day, hour, name) {
  return {
    id,
    kind: 'appointment',
    canonical: true,
    revision: `revision-${id}`,
    status: 'scheduled',
    clientName: name,
    clientMobile: '27821234567',
    serviceName: 'Synthetic treatment',
    serviceContexts: [{ serviceId: 8, categoryName: 'Massage' }],
    startsAt: `${day}T${String(hour).padStart(2, '0')}:00:00+02:00`,
    endsAt: `${day}T${String(hour + 1).padStart(2, '0')}:00:00+02:00`,
    staffIds,
    staff: staffIds.map(staffId => ({ staffId, nameSnapshot: `Practitioner ${staffId}` })),
  };
}

function weekModel() {
  const events = [
    appointment(101, [1], '2026-09-07', 9, 'Monday Client'),
    appointment(102, [2, 3], '2026-09-08', 10, 'Shared Client'),
  ];
  return {
    view: 'week',
    dateKey: '2026-09-07',
    activeStaffId: 2,
    visibleStaffIds: STAFF.map(person => person.id),
    permittedStaff: STAFF,
    period: {
      dateKeys: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'],
      startKey: '2026-09-07',
      previousAnchor: '2026-08-31',
      nextAnchor: '2026-09-14',
    },
    timeline: {
      staff: STAFF,
      workingWindows: [], scheduleExceptions: [], recurringClosures: [], closures: [], blocks: [], leave: [],
      appointments: events, events,
    },
    mutationCapability: {
      enabled: true,
      operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      allowedServiceIds: null,
    },
  };
}

function responseHarness() {
  const headers = { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'self'" };
  return {
    body: null,
    getHeader(name) { return headers[String(name).toLowerCase()]; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    send(body) { this.body = body; return this; },
    headers,
  };
}

test('#823 Desktop Week is six canonical date lanes, never date × practitioner', () => {
  const html = renderCalendarPage(weekModel(), {
    bookingEnabled: true,
    operationalActions: [{ label: '+ New appointment', href: '/calendar/book', tone: 'primary' }],
  });
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.equal((html.match(/data-week-practitioner-lane/g) || []).length, 0);
  assert.match(html, /data-week-date-lane-count="6"/);
  assert.match(html, /data-people-selection-summary>All staff/);
  assert.equal((html.match(/data-event-id="appointment-102"/g) || []).length, 1);
  assert.match(html, /Practitioner 2 \+ Practitioner 3/);
  assert.doesNotMatch(html, /Practitioner 999|Staff 999/);
  assert.equal((html.match(/data-calendar-booking-slot data-date/g) || []).length, 78);
  assert.doesNotMatch(html, /data-calendar-booking-slot[^>]*staff=/, 'multi-practitioner Week must not guess a practitioner');
  assert.match(calendar823Styles(), /minmax\(150px,1fr\)/);
});

test('#823 top controls are date-first and keep Today plus New appointment prominent', () => {
  const html = renderCalendarPage(weekModel(), {
    operationalActions: [{ label: '+ New appointment', href: '/calendar/book', tone: 'primary' }],
  });
  const controls = html.match(/<section class="controls"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(controls, /class="period-context"/);
  assert.match(controls, /data-calendar-view-option="week"/);
  assert.match(controls, />Today<\/a>/);
  assert.match(controls, />\+ New appointment<\/a>/);
  assert.ok(controls.indexOf('period-context') < controls.indexOf('Practitioners'));
});

test('#823 appointment card is the sole management target and panel owns permitted actions', () => {
  const model = weekModel();
  const html = renderEventCard(model.timeline.events[0], model);
  assert.match(html, /data-appointment-management-target="true"/);
  assert.match(html, /role="button" tabindex="0"/);
  assert.doesNotMatch(html, />Manage<\/button>|Adjust end time/);
  assert.match(html, /data-client-mobile="\+27 82 123 4567"/);
  assert.match(html, /data-practitioner-names="Practitioner 1"/);

  const page = renderCalendarPage(model);
  assert.match(page, /data-panel-mobile/);
  assert.match(page, /data-panel-practitioners/);
  assert.match(page, /data-panel-status/);
  assert.match(page, /data-panel-action="appointment:reschedule"/);
  assert.match(page, /data-panel-action="appointment:reassign"/);
  assert.match(page, /data-panel-action="appointment:cancel"/);

  const operations = calendarOperationalMutationsClientScript();
  assert.doesNotThrow(() => new vm.Script(operations));
  assert.match(operations, /shiloh:appointment-panel-open/);
  assert.match(operations, /appointment-panel-open',[^}]*bubbles:true/);
  assert.match(operations, /\['Enter',' '\]/);
  assert.match(calendarManageAppointmentNotesClientScript(), /shiloh:appointment-panel-open/);
  assert.match(calendarAppointmentEndTimeClientScript(), /shiloh:appointment-panel-open/);
  assert.doesNotMatch(calendarAppointmentEndTimeClientScript(), /data-end-time-dialog|end-time-action/);
});

test('#823 Desktop receives no PWA metadata/client while Android and iOS retain mobile install surfaces', () => {
  const desktop = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152 Safari/537.36' }, get(name) { return this.headers[String(name).toLowerCase()]; } };
  const android = { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 16; Pixel) Chrome/152 Mobile Safari/537.36' }, get(name) { return this.headers[String(name).toLowerCase()]; } };
  const ios = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Mobile/15E148 Safari/604.1' }, get(name) { return this.headers[String(name).toLowerCase()]; } };
  assert.equal(isMobilePwaRequest(desktop), false);
  assert.equal(isMobilePwaRequest(android), true);
  assert.equal(isMobilePwaRequest(ios), true);

  for (const [request, decorated] of [[desktop, false], [android, true], [ios, true]]) {
    request.method = 'GET'; request.path = '/workspace'; request.url = '/workspace';
    const response = responseHarness();
    createWorkspacePwaHtmlMiddleware()(request, response, () => response.send('<html><head></head><body>Workspace</body></html>'));
    assert.equal(response.body.includes('manifest.webmanifest'), decorated);
    assert.equal(response.body.includes('/calendar/pwa/client.js'), decorated);
  }

  const client = workspacePwaClientScript();
  assert.match(client, /beforeinstallprompt',event=>\{if\(!androidDevice\(\)\|\|standalone\(\)\)return/);
  assert.match(client, /Install Shiloh on this Android phone/);
  assert.match(client, /Keep Shiloh close/);
  assert.ok((client.match(/box-sizing:border-box/g) || []).length >= 2);
});

test('#823 Phone Week filters events inside one active date lane instead of hidden Cartesian lanes', () => {
  const script = calendarPhoneCompactV2ClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /\[data-week-date-lane\]/);
  assert.match(script, /dataset\.eventStaffIds/);
  assert.match(script, /phoneStaffVisible/);
  assert.doesNotMatch(script, /\[data-week-practitioner-lane\]/);
});
