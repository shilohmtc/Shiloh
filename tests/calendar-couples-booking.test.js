const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createCalendarCouplesBookingService,
  normalizeGuest,
  ensureDistinctGuests,
} = require('../src/services/calendarCouplesBooking');
const {
  renderCalendarCouplesBookingPage,
  calendarCouplesBookingClientScript,
} = require('../src/presentation/calendarCouplesBookingUx');
const {
  localDateTimeFromInputs,
  canonicalLocalDateTimeFromInputs,
} = require('../src/services/calendarCreateBooking');

const root = path.resolve(__dirname, '..');

test('#983 preserves the South African display slot while using an unambiguous database timestamp', () => {
  assert.equal(localDateTimeFromInputs('2026-09-14', '12:00'), '14/09/2026 12:00');
  assert.equal(canonicalLocalDateTimeFromInputs('2026-09-14', '12:00'), '2026-09-14 12:00:00');
  assert.throws(
    () => canonicalLocalDateTimeFromInputs('2026-09-31', '12:00'),
    error => error.code === 'CALENDAR_BOOKING_INVALID_SLOT'
  );
});

test('#971 validates two complete, distinct CRM V2 guest identities', () => {
  const guests = [
    normalizeGuest({ clientId: 10, name: 'Alex Adams', mobile: '082 123 4567', dateOfBirth: '1990-01-02', gender: 'female' }),
    normalizeGuest({ name: 'Sam Adams', mobile: '082 987 6543', dateOfBirth: '1991-03-04', gender: 'prefer not to say' }),
  ];
  assert.equal(guests[0].mobile, '27821234567');
  assert.equal(guests[1].gender, 'prefer_not_to_say');
  assert.doesNotThrow(() => ensureDistinctGuests(guests));
  assert.throws(
    () => ensureDistinctGuests([guests[0], { ...guests[1], mobile: guests[0].mobile }]),
    error => error.code === 'COUPLES_DUPLICATE_MOBILE'
  );
});

test('#971 derives the Couples Massage team from authorized service mappings', async () => {
  const standardBooking = {
    resolveOperator: async id => ({ id }),
    listBookableOptions: async () => ({
      authority: { bookingFlow: 'practitioner_first' },
      staff: [
        { id: 11, displayName: 'Abigail' },
        { id: 12, displayName: 'Christel' },
        { id: 13, displayName: 'Marietjie' },
      ],
      services: [
        {
          id: 90,
          name: 'Couples Massage',
          externalSource: 'shiloh_special',
          externalId: 'couples-massage-v1',
          durationMinutes: 90,
          price: 1080,
          staffIds: [11, 12],
        },
        { id: 81, name: 'Deep Tissue Massage', durationMinutes: 60, price: 850, variablePrice: false, staffIds: [11, 12] },
        { id: 82, name: 'Hydrating Facial', durationMinutes: 75, price: 720, variablePrice: false, staffIds: [12] },
      ],
    }),
  };
  const service = createCalendarCouplesBookingService({ db: { query() {} }, standardBooking });
  const options = await service.listOptions(7);
  assert.deepEqual(options.staff.map(person => person.displayName), ['Abigail', 'Christel']);
  assert.equal(options.groupService.name, 'Couples Massage');
  assert.deepEqual(options.services.map(service => service.name), ['Deep Tissue Massage', 'Hydrating Facial']);
});

test('#971 production Storybook surface exposes complete phone-friendly paired booking fields', () => {
  const html = renderCalendarCouplesBookingPage({
    options: {
      groupService: { id: 90, name: 'Couples Massage' },
      services: [
        { id: 81, name: 'Deep Tissue Massage', durationMinutes: 60, price: 850, staffIds: [11, 12] },
        { id: 82, name: 'Hydrating Facial', durationMinutes: 75, price: 720, staffIds: [12] },
      ],
      staff: [{ id: 11, displayName: 'Abigail' }, { id: 12, displayName: 'Christel' }],
      authority: { canApplyDiscount: true },
    },
    prefill: { date: '2026-09-14', time: '10:30' },
  });
  assert.match(html, /data-guest="1"/);
  assert.match(html, /data-guest="2"/);
  assert.equal((html.match(/type="date"/g) || []).length, 3);
  assert.equal((html.match(/data-gender=/g) || []).length, 2);
  assert.match(html, /New profiles are saved only when the whole booking succeeds/);
  assert.equal((html.match(/data-service=/g) || []).length, 2);
  assert.match(html, /Rand amount/);
  assert.match(html, /Percentage/);
  assert.match(html, /data-discount-reason/);
  assert.match(html, /@media\(max-width:700px\)/);
  assert.match(calendarCouplesBookingClientScript(), /Guest 1 and Guest 2 need different mobile numbers/);
  assert.match(calendarCouplesBookingClientScript(), /serviceIds/);
  assert.match(calendarCouplesBookingClientScript(), /Canonical subtotal/);
});

test('#971 schema and Calendar projection retain one group with two appointment children', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/120_couples_booking_groups.sql'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/calendarCouplesBooking.js'), 'utf8');
  const scheduling = fs.readFileSync(path.join(root, 'src/services/schedulingEngine.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(root, 'src/presentation/calendarReadOnlyUx.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS appointment_groups/);
  assert.match(migration, /PRIMARY KEY \(group_id, guest_position\)/);
  assert.match(migration, /UNIQUE \(appointment_id\)/);
  assert.match(migration, /admin_couples_booking_sessions/);
  assert.match(scheduling, /appointment_group_members/);
  assert.match(calendar, /event-couples/);
  assert.match(calendar, /appointmentGroupType === 'couples_massage'/);
  assert.ok(service.indexOf("client.query('BEGIN')") < service.indexOf('INSERT INTO crm_v2_clients'));
  assert.ok(service.indexOf('INSERT INTO crm_v2_clients') < service.indexOf('INSERT INTO appointment_groups'));
  assert.ok(service.indexOf('obligations.push(await queueCustomerBookingConfirmation') < service.lastIndexOf("client.query('COMMIT')"));
  assert.match(service, /client\.query\('ROLLBACK'\)/);
});

test('#985 persists the complete canonical pricing decision on the booking group', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/121_couples_booking_pricing_audit.sql'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/calendarCouplesBooking.js'), 'utf8');
  for (const column of [
    'canonical_subtotal',
    'discount_type',
    'discount_value',
    'discount_amount',
    'discount_reason',
    'final_total',
    'discounted_by_admin_id',
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(service, new RegExp(column));
  }
  assert.match(migration, /canonical_subtotal = discount_amount \+ final_total/);
  assert.match(migration, /final_total = total_price/);
  assert.match(migration, /service:pricing/);
});
