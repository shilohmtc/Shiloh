const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderCalendarPage,
  renderOperationalActions,
  calendarFirstPhoneStyles,
  goldieDensityPhoneStyles,
} = require('../src/presentation/calendarReadOnlyUx');
const { periodFor } = require('../src/services/calendarReadOnlyUx');
const { bookingOperationalActions, applyCalendarResponsivePolish } = require('../src/routes/calendarReadOnlyUx');
const { bookingPrefillFromQuery } = require('../src/routes/calendarCreateBooking');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');

const STAFF = [
  { id: 31, displayName: 'Amber Room', schedulingType: 'regular' },
  { id: 32, displayName: 'Birch Room', schedulingType: 'regular' },
  { id: 33, displayName: 'Cedar Room', schedulingType: 'regular' },
];

function appointment(id, staffIds, startsAt, durationMinutes, clientName = `Client ${id}`) {
  return {
    id,
    kind: 'appointment',
    canonical: true,
    revision: `rev-${id}`,
    status: 'scheduled',
    clientName,
    clientMobile: '27821234567',
    serviceName: 'Synthetic treatment',
    serviceContexts: [{ serviceId: 81, categoryName: 'Massage' }],
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000).toISOString(),
    staffIds,
    staff: staffIds.map(staffId => ({ staffId, nameSnapshot: STAFF.find(person => person.id === staffId)?.displayName })),
  };
}

function model(view = 'day', visibleStaffIds = [31], mutationEnabled = true) {
  const visible = new Set(visibleStaffIds);
  const appointments = [
    appointment(9901, [31], '2026-09-07T06:00:00.000Z', 60, 'Long but readable client name'),
    appointment(9902, [31, 32], '2026-09-11T08:00:00.000Z', 90, 'Shared Client'),
  ].filter(item => item.staffIds.some(id => visible.has(id)));
  return {
    view,
    dateKey: '2026-09-07',
    period: periodFor(view, '2026-09-07'),
    selectedStaffId: visibleStaffIds.length === 1 ? visibleStaffIds[0] : null,
    visibleStaffIds,
    visibleStaffSelectionExplicit: true,
    permittedStaff: STAFF,
    timeline: {
      staff: STAFF.filter(person => visible.has(person.id)),
      workingWindows: STAFF.filter(person => visible.has(person.id)).flatMap(person => [1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ staffId: person.id, dayOfWeek, startsLocal: '08:00:00', endsLocal: '17:00:00' }))),
      scheduleExceptions: [], recurringClosures: [], closures: [], leave: [], externalBusy: [], blocks: [],
      appointments,
      events: appointments,
    },
    mutationCapability: mutationEnabled ? {
      enabled: true,
      operations: ['appointment:reschedule', 'appointment:cancel', 'appointment:reassign'],
      calendarScope: 'all_business',
      serviceScope: 'all_services',
      allowedServiceIds: null,
    } : { enabled: false },
  };
}

function render(view, staffIds = [31], bookingEnabled = true) {
  return renderCalendarPage(model(view, staffIds), {
    bookingEnabled,
    bookingPath: '/calendar/book',
    operationalActions: bookingOperationalActions('2026-09-07'),
  });
}

test('Day and Week expose touch-safe empty-time links into the existing Create Booking route', () => {
  const day = render('day', [31]);
  assert.equal((day.match(/data-calendar-booking-slot data-date/g) || []).length, 13);
  assert.match(day, /href="\/calendar\/book\?date=2026-09-07&amp;time=08%3A00&amp;staff=31"/);
  assert.match(day, /data-calendar-booking-hint|Tap an empty time to start an appointment/);

  const week = render('week', [31]);
  assert.equal((week.match(/data-calendar-booking-slot data-date/g) || []).length, 78);
  assert.match(week, /href="\/calendar\/book\?date=2026-09-11&amp;time=10%3A00&amp;staff=31"/);
  assert.doesNotMatch(render('month', [31]), /data-calendar-booking-slot/);
  assert.doesNotMatch(render('day', [31], false), /data-calendar-booking-slot/);
});

test('multi-practitioner Week preserves People without guessing practitioner on empty slots', () => {
  const html = render('week', [31, 33]);
  assert.match(html, /data-people-selection-summary>2 staff/);
  assert.doesNotMatch(html, /data-calendar-view-option="day"/);
  assert.match(html, /data-calendar-view-option="week"[^>]*staff=31&amp;staff=33/);
  assert.match(html, /data-calendar-view-option="month"[^>]*staff=31&amp;staff=33/);
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.equal((html.match(/data-calendar-booking-slot data-date/g) || []).length, 78);
  assert.doesNotMatch(html, /data-calendar-booking-slot[^>]*staff=/);

  const day = render('day', [31, 33]);
  assert.match(day, /data-staff-id="31"[\s\S]*?data-calendar-booking-slot[^>]*href="\/calendar\/book\?date=2026-09-07&amp;time=07%3A00&amp;staff=31"/);
  assert.match(day, /data-staff-id="33"[\s\S]*?data-calendar-booking-slot[^>]*href="\/calendar\/book\?date=2026-09-07&amp;time=07%3A00&amp;staff=33"/);
});

test('Phone Week uses one active practitioner over six canonical date lanes', () => {
  assert.match(calendarFirstPhoneStyles(), /event-card h4[^}]*white-space:nowrap!important[^}]*overflow-wrap:normal!important;word-break:normal!important/);
  const html = render('week', [31, 33]);
  assert.equal((html.match(/data-week-date-lane(?:\s|>)/g) || []).length, 6);
  assert.doesNotMatch(html, /<section class="week-day week-practitioner-lane"/);
});

test('Phone Calendar keeps Week and Month primary while Month remains overview navigation only', () => {
  const month = render('month', [31, 33]);
  assert.match(month, /data-calendar-view-option="agenda"/);
  assert.doesNotMatch(month, /data-calendar-view-option="day"/);
  assert.match(month, /data-calendar-view-option="week"/);
  assert.match(month, /data-calendar-view-option="month"/);
  assert.match(month, /class="month-day-link"[^>]*view=week[^>]*staff=31&amp;staff=33/);
  const css = calendarFirstPhoneStyles();
  assert.match(css, /data-calendar-view-option="agenda"[^}]*display:none!important/);
  assert.match(css, /data-calendar-view="month"[^}]*\.month-events[^}]*display:none!important/);
  assert.match(css, /data-calendar-view="month"[^}]*\.view-practitioner-context[^}]*display:none!important/);
  assert.match(css, /data-calendar-view="day"[^}]*\.access-controls[^}]*display:flex!important/);
  assert.match(month, /data-shiloh-logout>Sign out<\/button>/);
});

test('appointment cards remain canonical and the whole Phone Day and Week card is the management target', () => {
  const week = render('week', [31, 32]);
  assert.equal((week.match(/data-event-id="appointment-9902"/g) || []).length, 1);
  assert.match(week, /data-appointment-management-target="true"/);
  assert.doesNotMatch(week, /data-calendar-operation="manage-appointment">Manage<\/button>/);
});

test('canonical Create Booking prefill accepts only operational date, five-minute time and permitted staff', () => {
  const options = { staff: STAFF.slice(0, 2) };
  assert.deepEqual(bookingPrefillFromQuery({ date: '2026-09-07', time: '10:05', staff: '32' }, options), {
    date: '2026-09-07', time: '10:05', staffId: 32,
  });
  assert.deepEqual(bookingPrefillFromQuery({ date: '2026-09-13', time: '10:05', staff: '999' }, options), {
    date: '', time: '', staffId: null,
  });
  assert.deepEqual(bookingPrefillFromQuery({ date: '2026-02-31', time: '10:05', staff: '31' }, options), {
    date: '', time: '', staffId: 31,
  });
  assert.deepEqual(bookingPrefillFromQuery({ date: '2026-09-07', time: '10:03', staff: '999' }, options), {
    date: '2026-09-07', time: '', staffId: null,
  });
});

test('Create Booking renders calendar prefill and selects practitioner only when treatment eligibility permits it', () => {
  const options = {
    staff: STAFF.slice(0, 2),
    services: [{ id: 81, name: 'Synthetic treatment', staffIds: [31] }],
  };
  const page = renderCalendarCreateBookingPage({
    options,
    prefill: { date: '2026-09-07', time: '10:00', staffId: 31 },
  });
  assert.match(page, /id="booking-date"[^>]*value="2026-09-07"/);
  assert.match(page, /id="booking-time"[^>]*value="10:00"/);
  assert.match(page, /data-back-calendar href="\/calendar\/read-only\?view=week&amp;date=2026-09-07&amp;staff=all"/);
  assert.match(page, /"prefill":\{"date":"2026-09-07","time":"10:00","staffId":31\}/);
  const script = calendarCreateBookingClientScript();
  assert.match(script, /permitted\.has\(prefillStaffId\)/);
  assert.match(script, /options\.staff[^;]*returnStaffId/);
});

test('one compact fallback launcher reuses canonical booking authority and mobile overview is retired from runtime', () => {
  const actions = bookingOperationalActions('2026-09-07');
  assert.deepEqual(actions, [{ label: '+ New appointment', ariaLabel: 'Create booking', href: '/calendar/book?date=2026-09-07', tone: 'primary' }]);
  const actionsHtml = renderOperationalActions(actions);
  assert.equal((actionsHtml.match(/class="action-link primary"/g) || []).length, 1);
  assert.match(actionsHtml, /aria-label="Create booking">\+ New appointment/);
  const polished = applyCalendarResponsivePolish(render('day', [31, 32]));
  assert.doesNotMatch(polished, /data-calendar-mobile-overview|mobile-all-staff-overview/);
  assert.match(polished, /class="time-grid day-time-grid"/);
});
