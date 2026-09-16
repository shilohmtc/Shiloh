const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  alignScopedAvailabilityFocus,
  renderCalendarCreateBookingPageWithoutLinkedShortcuts,
} = require('../src/presentation/calendarBookingEntryComposition');
const { renderPhoneCalendarDock } = require('../src/presentation/calendarPhoneCompactV2');

function ownAvailabilityModel() {
  return {
    view: 'week',
    dateKey: '2026-09-16',
    activeStaffId: 51,
    permittedStaff: [
      { id: 51, displayName: 'Abigail' },
      { id: 54, displayName: 'Marietjie' },
    ],
    timeline: {
      staff: [
        { id: 51, displayName: 'Abigail' },
        { id: 54, displayName: 'Marietjie' },
      ],
    },
    mutationCapability: {
      enabled: true,
      linkedStaffId: 54,
      calendarScope: 'own_appointments',
      serviceScope: 'own_services',
      operations: ['calendar_block:manage', 'operational_leave:manage'],
    },
  };
}

test('own availability controls target the linked practitioner even when All staff defaults to another active column', () => {
  const model = ownAvailabilityModel();
  alignScopedAvailabilityFocus(model);
  assert.equal(model.activeStaffId, 54);

  const html = renderPhoneCalendarDock(model, {
    bookingPath: '/calendar/book',
    bookingAllowed: true,
  });
  assert.match(html, /\/calendar\/book\?date=2026-09-16&amp;staff=54/);
  assert.match(html, /data-calendar-operation="add-block"[^>]*data-staff-id="54"/);
  assert.match(html, /data-calendar-operation="add-leave"[^>]*data-staff-id="54"/);
  assert.doesNotMatch(html, /data-calendar-operation="add-(?:block|leave)"[^>]*data-staff-id="51"/);
});

test('broad schedule managers keep their explicitly active practitioner', () => {
  const model = ownAvailabilityModel();
  model.mutationCapability.calendarScope = 'all_business';
  model.mutationCapability.linkedStaffId = 54;
  alignScopedAvailabilityFocus(model);
  assert.equal(model.activeStaffId, 51);
});

test('ordinary Create booking no longer duplicates Couples and Group entry points', () => {
  const html = renderCalendarCreateBookingPageWithoutLinkedShortcuts({
    options: { staff: [], services: [] },
    prefill: { date: '2026-09-16' },
  });
  assert.doesNotMatch(html, /data-couples-booking-entry|data-group-booking-entry/);
  assert.doesNotMatch(html, /\/calendar\/book\/couples|\/calendar\/book\/group/);
  assert.match(html, /data-back-calendar/);
  assert.match(html, /Create booking/);
});

test('production Calendar composition wires both corrected surfaces', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendar.js'), 'utf8');
  assert.match(source, /createCalendarReadOnlyRouter\(\{[\s\S]*renderPage: renderCalendarPageWithScopedAvailabilityFocus/);
  assert.match(source, /createCalendarCreateBookingRouter\(\{[\s\S]*renderPage: renderCalendarCreateBookingPageWithoutLinkedShortcuts/);
});
