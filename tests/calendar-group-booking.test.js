const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MIN_GROUP_GUESTS,
  MAX_GROUP_GUESTS,
  GROUP_DISCOUNT_CAPABILITY,
  normalizeGuest,
  ensureDistinctGroupGuests,
  createCalendarGroupBookingService,
} = require('../src/services/calendarGroupBooking');
const { priceLinkedBooking } = require('../src/services/calendarCouplesPricing');
const { renderCalendarGroupBookingPage, calendarGroupBookingClientScript } = require('../src/presentation/calendarGroupBookingUx');

const root = path.resolve(__dirname, '..');

test('group bookings require 3-10 distinct minimal client identities', () => {
  assert.equal(MIN_GROUP_GUESTS, 3);
  assert.equal(MAX_GROUP_GUESTS, 10);
  assert.equal(GROUP_DISCOUNT_CAPABILITY, 'appointment:group:discount');
  const names = ['Test Alpha', 'Test Bravo', 'Test Charlie'];
  const guests = names.map((name, index) => normalizeGuest({ name, mobile: `082 555 010${index + 1}` }));
  assert.doesNotThrow(() => ensureDistinctGroupGuests(guests));
  assert.equal(guests[0].dateOfBirth, null);
  assert.equal(guests[0].gender, null);
  assert.throws(() => ensureDistinctGroupGuests(guests.slice(0, 2)), error => error.code === 'GROUP_GUEST_COUNT_INVALID');
  assert.throws(() => ensureDistinctGroupGuests([...guests.slice(0, 2), { ...guests[2], mobile: guests[0].mobile }]), error => error.code === 'GROUP_DUPLICATE_MOBILE');
});

test('linked pricing supports ten allocations and an optional discount note', () => {
  const pricing = priceLinkedBooking({ prices: [500, 600, 700], discount: { type: 'percent', value: 10 }, canDiscount: true, minGuests: 3, maxGuests: 10 });
  assert.equal(pricing.subtotal, 1800);
  assert.equal(pricing.discountAmount, 180);
  assert.equal(pricing.discountReason, null);
  assert.equal(pricing.allocations.length, 3);
  assert.equal(pricing.allocations.reduce((sum, value) => sum + value, 0), pricing.total);
});

test('group options reuse canonical fixed-price Services and eligible Staff', async () => {
  const standardBooking = {
    resolveOperator: async id => ({ id, calendarAuthority: { capabilities: ['appointment:group:discount'] } }),
    listBookableOptions: async () => ({
      authority: {},
      staff: [{ id: 11, displayName: 'Abigail' }, { id: 12, displayName: 'Christel' }, { id: 13, displayName: 'Marietjie' }],
      services: [
        { id: 90, name: 'Couples Massage', externalSource: 'shiloh_special', externalId: 'couples-massage-v1', durationMinutes: 90, price: 1080, staffIds: [11, 12] },
        { id: 81, name: 'Swedish', durationMinutes: 60, price: 590, variablePrice: false, staffIds: [11, 12, 13] },
      ],
    }),
  };
  const service = createCalendarGroupBookingService({ db: {}, standardBooking });
  const options = await service.listOptions(7);
  assert.deepEqual(options.services.map(item => item.name), ['Swedish']);
  assert.equal(options.authority.canApplyDiscount, true);
  assert.equal(options.staff.length, 3);
});

test('production Group surface starts at three and supports dynamic guests and optional discount note', () => {
  const html = renderCalendarGroupBookingPage({
    options: {
      services: [{ id: 81, name: 'Swedish', durationMinutes: 60, price: 590, staffIds: [11, 12, 13] }],
      staff: [{ id: 11, displayName: 'Abigail' }, { id: 12, displayName: 'Christel' }, { id: 13, displayName: 'Marietjie' }],
      authority: { canApplyDiscount: true },
    },
    prefill: { date: '2026-09-14', time: '10:30' },
  });
  assert.equal((html.match(/data-guest="[123]"/g) || []).length, 3);
  assert.match(html, /data-add-guest/);
  assert.match(html, /3–10/);
  assert.match(html, /Note <span class="optional">Optional/);
  assert.doesNotMatch(calendarGroupBookingClientScript(), /discount value and reason|required reason/i);
  assert.match(calendarGroupBookingClientScript(), /cannot treat two group guests at overlapping times/);
  assert.match(calendarGroupBookingClientScript(), /startTimes/);
});

test('group schema and atomic service preserve one parent with separate appointment children', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations/124_group_bookings_and_optional_discount_note.sql'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/calendarGroupBooking.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/calendar.js'), 'utf8');
  assert.match(migration, /group_booking/);
  assert.match(migration, /guest_position BETWEEN 1 AND 10/);
  assert.match(migration, /admin_group_booking_sessions/);
  assert.match(migration, /appointment:group:discount/);
  assert.match(route, /\/book\/group/);
  assert.ok(service.indexOf("client.query('BEGIN')") < service.indexOf('INSERT INTO crm_v2_clients'));
  assert.ok(service.indexOf('INSERT INTO crm_v2_clients') < service.indexOf('INSERT INTO appointment_groups'));
  assert.ok(service.indexOf('queueCustomerBookingConfirmation') < service.lastIndexOf("client.query('COMMIT')"));
  assert.match(service, /client\.query\('ROLLBACK'\)/);
  assert.match(service, /for \(let index = 0; index < selections\.length/);
});
