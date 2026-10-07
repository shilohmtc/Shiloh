const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  renderCalendarPage,
  renderEventCard,
  renderOperationalActions,
  eventsForDate,
} = require('../src/presentation/calendarReadOnlyUx');
const { bookingOperationalActions, applyCalendarResponsivePolish } = require('../src/routes/calendarReadOnlyUx');
const { periodFor } = require('../src/services/calendarReadOnlyUx');

function model(view = 'day') {
  const appointment = {
    id: 7001,
    kind: 'appointment',
    canonical: true,
    source: 'appointments',
    status: 'scheduled',
    clientName: 'Demo Client',
    serviceName: 'Bamboo Sports Massage - Area Specific',
    startsAt: '2026-08-27T06:00:00.000Z',
    endsAt: '2026-08-27T07:00:00.000Z',
    staffIds: [1],
    staff: [{ staffId: 1, nameSnapshot: 'Christel' }],
  };
  const block = {
    id: 8001,
    kind: 'calendar_block',
    canonical: true,
    source: 'staff_calendar_blocks',
    blockType: 'admin',
    title: 'Admin block',
    startsAt: '2026-08-27T09:00:00.000Z',
    endsAt: '2026-08-27T09:30:00.000Z',
    staffIds: [2],
  };
  const external = {
    id: 'legacy-google',
    kind: 'external_busy',
    canonical: false,
    source: 'google_calendar',
    summary: 'Legacy external event',
    startsAt: '2026-08-27T10:00:00.000Z',
    endsAt: '2026-08-27T10:30:00.000Z',
    staffIds: [1],
  };
  return {
    view,
    dateKey: '2026-08-27',
    selectedStaffId: null,
    permittedStaff: [{ id: 1, displayName: 'Christel' }, { id: 2, displayName: 'Abigail' }],
    period: periodFor(view, '2026-08-27'),
    timeline: {
      staff: [{ id: 1, displayName: 'Christel' }, { id: 2, displayName: 'Abigail' }],
      workingWindows: [
        { staffId: 1, dayOfWeek: 4, startsLocal: '08:00:00', endsLocal: '17:00:00' },
        { staffId: 2, dayOfWeek: 4, startsLocal: '08:00:00', endsLocal: '17:00:00' },
      ],
      scheduleExceptions: [],
      recurringClosures: [],
      closures: [],
      appointments: [appointment],
      blocks: [block],
      leave: [],
      externalBusy: [],
      events: [appointment, block, external],
    },
  };
}

test('Shiloh-only cockpit renders enriched canonical appointment cards', () => {
  const html = renderCalendarPage(model(), {
    operationalActions: bookingOperationalActions('2026-08-27'),
  });
  assert.match(html, /Demo Client/);
  assert.match(html, /Bamboo Sports Massage - Area Specific/);
  assert.match(html, /08:00–09:00/);
  assert.match(html, /Christel/);
  assert.match(html, /scheduled/);
  assert.match(html, /Appointment #7001/);
  assert.match(html, /class="kind-pill">Appointment/);
  assert.match(html, /Shiloh appointment/);
  assert.doesNotMatch(html, /Legacy external event|Google-only|Non-canonical|PR #395/);
  assert.doesNotMatch(html, /clientMobile|normalized_value|wa\.me|phone/i);
});

test('cockpit exposes labelled controls, scan summary and lane state', () => {
  const html = renderCalendarPage(model());
  assert.match(html, /class="control-label">Date/);
  assert.match(html, /class="control-label">View/);
  assert.match(html, /class="control-label">Practitioner/);
  assert.match(html, /aria-label="Visible period summary"/);
  assert.match(html, /<strong>1<\/strong><span>Appointments<\/span>/);
  assert.match(html, /<strong>1<\/strong><span>Blocks \+ leave<\/span>/);
  assert.match(html, /Shiloh schedule/);
  assert.match(html, /class="lane-count">1 item/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Shiloh <small>Workspace<\/small>/);
  assert.match(html, /class="workspace-link active"[^>]*aria-current="page">Calendar/);
  assert.match(html, /class="time-grid day-time-grid"/);
  assert.match(html, /class="positioned-event"[^>]* style="--event-top:72px;--event-height:69px"/);
});

test('Week uses one shared vertical time rail and six readable Monday-Saturday date lanes', () => {
  const html = renderCalendarPage(model('week'));
  assert.match(html, /class="time-grid week-time-grid"/);
  assert.equal((html.match(/data-week-date-lane(?=[ >])/g) || []).length, 6);
  assert.doesNotMatch(html, /<section class="week-day week-practitioner-lane"/);
  assert.match(html, /class="time-rail"/);
  assert.match(html, /grid-template-columns:repeat\(var\(--week-lane-count\),minmax\(150px,1fr\)\)!important/);
  assert.match(html, /data-spatial-week="true"/);
});

test('appointment management surface exposes only server-granted operations', () => {
  const m = model();
  m.mutationCapability = {
    enabled: true,
    operations: ['appointment:reschedule'],
    calendarScope: 'all_business',
    serviceScope: 'all_services',
    allowedServiceIds: null,
  };
  const html = renderCalendarPage(m);
  assert.match(html, /data-calendar-management-panel/);
  assert.match(html, /data-panel-action="appointment:reschedule"/);
  assert.doesNotMatch(html, /Every change is revalidated by canonical Calendar authority/);
  assert.doesNotMatch(html, /data-allowed-operations="[^"]*appointment:cancel/);
});

test('legacy non-canonical events are excluded from day/week/agenda data projection', () => {
  for (const view of ['day', 'week', 'agenda']) {
    const m = model(view);
    const events = eventsForDate(m, '2026-08-27');
    assert.equal(events.some(item => item.canonical === false || item.kind === 'external_busy'), false);
    const html = renderCalendarPage(m);
    assert.doesNotMatch(html, /Legacy external event|google_calendar|external_busy/);
  }
});

test('operational action contract exposes only guarded Create booking', () => {
  assert.deepEqual(bookingOperationalActions('2026-08-27'), [
    {
      label: '+ New appointment',
      ariaLabel: 'Create booking',
      href: '/calendar/book?date=2026-08-27',
      tone: 'primary',
    },
  ]);
  const html = renderOperationalActions(bookingOperationalActions('2026-08-27'));
  assert.match(html, /aria-label="Create booking"[^>]*>\+ New appointment<\/a>/);
  assert.doesNotMatch(html, /Confirm client contact|client-authority/);
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendarReadOnlyUx.js'), 'utf8');
  assert.doesNotMatch(routeSource, /Confirm client contact|\/calendar\/client-authority/);
});

test('narrow-screen contract keeps the compact Phone controls and spatial Week scroller bounded', () => {
  const raw = renderCalendarPage(model('week'));
  const html = applyCalendarResponsivePolish(raw);
  assert.match(html, /@media\(max-width:700px\)/);
  assert.match(html, /\.action-link,.signout-button\{min-height:44px/);
  assert.match(html, /\.nav-button,\.view-tab,\.filter,\.scope-pill\{min-height:44px/);
  assert.match(html, /\.controls\{position:sticky;top:0;z-index:5;grid-template-columns:1fr;/);
  assert.doesNotMatch(html, /\.controls\{position:sticky;top:0;z-index:5;grid-template-columns:1fr 1fr;/);
  assert.match(html, /body\[data-calendar-view="week"\][\s\S]*\.week-time-grid\{display:grid!important;grid-template-columns:44px max-content!important;overflow-x:auto!important/);
  assert.match(html, /body\[data-calendar-view="week"\][\s\S]*\.week-grid\{display:grid!important;grid-template-columns:repeat\(var\(--week-lane-count\),220px\)!important;min-width:calc\(var\(--week-lane-count\) \* 220px\)!important/);
  assert.match(html, /\.positioned-event\{position:absolute!important;[^}]*top:var\(--event-top\)!important/);
});

test('event card renderer escapes operational fields', () => {
  const html = renderEventCard({
    id: 7002,
    kind: 'appointment',
    canonical: true,
    clientName: '<Client>',
    serviceName: 'Massage & Care',
    status: 'scheduled',
    startsAt: '2026-08-27T06:00:00.000Z',
    endsAt: '2026-08-27T07:00:00.000Z',
    staffIds: [1],
  }, model());
  assert.match(html, /&lt;Client&gt;/);
  assert.match(html, /Massage &amp; Care/);
  assert.doesNotMatch(html, /<Client>/);
});
