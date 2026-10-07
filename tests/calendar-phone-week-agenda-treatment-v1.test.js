const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderCalendarPage,
  renderEventCard,
  calendarFirstPhoneStyles,
} = require('../src/presentation/calendarReadOnlyUx');
const { desktopAppointmentCardDensityCss } = require('../src/presentation/calendarServiceFamilyVisuals');
const { staffCalendarAccessClientScript } = require('../src/presentation/staffCalendarAccessUx');

function appointment({ id, clientName, staffId, staffName, startsAt, endsAt, serviceName = 'Full Body Swedish' }) {
  return {
    id,
    kind: 'appointment',
    canonical: true,
    revision: `rev-${id}`,
    status: 'scheduled',
    clientName,
    clientMobile: '27821234567',
    serviceName,
    startsAt,
    endsAt,
    staffIds: [staffId],
    staff: [{ staffId, nameSnapshot: staffName }],
    serviceContexts: [{ serviceId: 33, categoryName: 'Massage' }],
  };
}

function weekModel({ selectedStaffId = null } = {}) {
  const staff = [
    { id: 1, displayName: 'Abigail' },
    { id: 2, displayName: 'ILince' },
  ];
  const appointments = [
    appointment({
      id: 7901,
      clientName: 'Helen',
      staffId: 1,
      staffName: 'Abigail',
      startsAt: '2026-09-11T07:00:00.000Z',
      endsAt: '2026-09-11T08:30:00.000Z',
    }),
    appointment({
      id: 7902,
      clientName: 'Melindi',
      staffId: 2,
      staffName: 'ILince',
      startsAt: '2026-09-11T07:00:00.000Z',
      endsAt: '2026-09-11T08:30:00.000Z',
    }),
    appointment({
      id: 7903,
      clientName: 'Elani Greyling F',
      staffId: 1,
      staffName: 'Abigail',
      startsAt: '2026-09-11T09:00:00.000Z',
      endsAt: '2026-09-11T10:30:00.000Z',
      serviceName: 'Lymphatic Drainage Reset Package',
    }),
  ];
  const visibleAppointments = selectedStaffId == null
    ? appointments
    : appointments.filter(item => item.staffIds.includes(selectedStaffId));
  const visibleStaff = selectedStaffId == null
    ? staff
    : staff.filter(person => person.id === selectedStaffId);

  return {
    view: 'week',
    dateKey: '2026-09-11',
    selectedStaffId,
    permittedStaff: staff,
    period: {
      startKey: '2026-09-07',
      previousAnchor: '2026-08-31',
      nextAnchor: '2026-09-14',
      dateKeys: [
        '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
        '2026-09-11', '2026-09-12',
      ],
    },
    timeline: {
      staff: visibleStaff,
      workingWindows: [],
      scheduleExceptions: [],
      recurringClosures: [],
      closures: [],
      leave: [],
      externalBusy: [],
      appointments: visibleAppointments,
      blocks: [],
      events: visibleAppointments,
    },
    mutationCapability: { enabled: false },
  };
}

test('Phone Week preserves a legible horizontally pannable spatial time grid instead of a stacked-card feed', () => {
  const css = calendarFirstPhoneStyles();
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.week-time-grid\{display:grid!important;grid-template-columns:44px max-content!important;overflow-x:auto!important/);
  assert.match(css, /\.week-grid\{display:grid!important;grid-template-columns:repeat\(var\(--week-lane-count\),220px\)!important;min-width:calc\(var\(--week-lane-count\) \* 220px\)!important/);
  assert.match(css, /\.week-day\{position:relative!important;display:block!important;min-width:220px!important;width:220px!important/);
  assert.match(css, /\.time-column\{height:936px!important;min-height:936px!important/);
  assert.match(css, /\.positioned-event\{position:absolute!important;[^}]*top:var\(--event-top\)!important;[^}]*height:var\(--event-height\)!important/);
  assert.doesNotMatch(css, /grid-template-columns:minmax\(0,1fr\)!important;min-width:0!important;width:100%!important;gap:10px/);
});

test('Phone Week preserves all permitted appointments from the canonical filtered Week model', () => {
  const html = renderCalendarPage(weekModel(), { clientNavigationAllowed: true });

  assert.match(html, /data-view="week"/);
  assert.match(html, /data-spatial-week="true"/);
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.doesNotMatch(html, /data-date="2026-09-13"/);
  assert.match(html, /data-view-practitioner-context|People in view/);
  assert.doesNotMatch(html, /data-week-practitioner-name/);
  assert.match(html, /Helen/);
  assert.match(html, /Melindi/);
  assert.match(html, /Elani Greyling F/);
  assert.match(html, /class="positioned-event"[^>]* style="--event-top:144px;--event-height:105px"/);
});

test('selected-practitioner Week scope remains constrained before Phone presentation', () => {
  const html = renderCalendarPage(weekModel({ selectedStaffId: 2 }), { clientNavigationAllowed: true });

  assert.match(html, /Melindi/);
  assert.doesNotMatch(html, /Helen/);
  assert.doesNotMatch(html, /Elani Greyling F/);
});

test('Phone Week uses readable compact event content and the whole block as the touch-safe management target', () => {
  const css = calendarFirstPhoneStyles();
  assert.match(css, /\.positioned-event \.event-card\{position:relative!important;height:100%!important;min-height:44px!important;padding:5px 7px!important/);
  assert.match(css, /\.event-time\{display:block!important;font-size:\.65rem!important/);
  assert.match(css, /\.event-practitioner-full[^}]*\.event-service-context[^}]*\{display:none!important\}/);
  assert.match(css, /\.event-practitioner-compact\{display:block!important/);
  assert.match(renderCalendarPage(weekModel()), /data-appointment-management-target="true"/);
});

test('taller Phone Week appointments progressively reveal service context', () => {
  const css = calendarFirstPhoneStyles();
  assert.match(css, /@container \(min-height:84px\)/);
  assert.match(css, /\.event-service-context\{display:flex!important/);
});

test('Manage/detail data contract remains unchanged for Phone cards', () => {
  const item = appointment({
    id: 7999,
    clientName: 'Julalie',
    staffId: 2,
    staffName: 'ILince',
    startsAt: '2026-09-11T14:00:00.000Z',
    endsAt: '2026-09-11T14:45:00.000Z',
    serviceName: 'Bamboo Sports Massage',
  });
  const model = {
    permittedStaff: [{ id: 2, displayName: 'ILince' }],
    mutationCapability: {
      enabled: true,
      operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      allowedServiceIds: null,
    },
    timeline: { events: [item] },
  };
  const html = renderEventCard(item, model);

  assert.match(html, /data-appointment-id="7999"/);
  assert.match(html, /data-revision="rev-7999"/);
  assert.match(html, /data-staff-ids="2"/);
  assert.match(html, /data-client-name="Julalie"/);
  assert.match(html, /data-service-name="Bamboo Sports Massage"/);
  assert.match(html, /data-appointment-management-target="true"/);
  assert.doesNotMatch(html, /data-calendar-operation="manage-appointment">Manage<\/button>/);
  assert.match(html, /Bamboo Sports Massage/);
});

test('Desktop Week overlap and Desktop density remain explicitly desktop-gated', () => {
  const desktopCss = desktopAppointmentCardDensityCss();
  const clientScript = staffCalendarAccessClientScript();

  assert.match(desktopCss, /@media\(min-width:701px\)/);
  assert.match(clientScript, /matchMedia\('\(min-width: 701px\)'\)/);
  assert.match(clientScript, /grid\.setAttribute\('data-week-overlap-layout','phone'\)/);
  assert.match(clientScript, /--week-event-left/);
  assert.match(clientScript, /--week-event-width/);
  assert.match(clientScript, /data-week-overlap-layout/);
});
