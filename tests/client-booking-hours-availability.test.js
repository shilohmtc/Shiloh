'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadService(name, overrides) {
  const filename = path.join(__dirname, '../src/services', name);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id),
  }, { filename });
  return module.exports;
}

function fixture({ assistantEnd = '16:00:00', closed = false, missing = false } = {}) {
  let accepted = 0;
  const intent = { status: 'collecting', service_text: 'Massage', service_verified: true,
    therapist_text: 'Christel', preferred_date: '2030-10-15', preferred_time: null };
  const slot = (start, end) => ({ starts_at: `2030-10-15T${start}:00+02:00`, ends_at: `2030-10-15T${end}:00+02:00` });
  const candidates = [slot('08:30', '10:00'), slot('14:30', '16:00'), slot('15:00', '16:30'), slot('16:00', '17:30'), slot('18:00', '19:30')];
  const db = { query: async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM services')) return { rows: [{ id: 1, name: 'Massage' }] };
    if (text.includes('JOIN staff_services')) return { rows: [{ id: 2, display_name: 'Christel' }] };
    if (text.includes('FROM locations')) return { rowCount: 1, rows: [{ id: 1 }] };
    if (text.includes('public_holidays')) return { rows: [{ requested_dow: 2, is_holiday: false, weekly_start: '08:00:00', weekly_end: '18:00:00' }] };
    if (text.includes('location_assistant_booking_hours')) return { rows: [{
      override_type: closed ? 'closed' : null,
      weekly_start: missing ? null : '09:00:00', weekly_end: missing ? null : assistantEnd,
    }] };
    if (text.includes('local_end_date')) {
      const localParts = value => {
        const local = new Date(new Date(value).getTime() + 2 * 60 * 60 * 1000).toISOString();
        return { date: local.slice(0, 10), time: local.slice(11, 19) };
      };
      const start = localParts(params[0]); const end = localParts(params[1]);
      return { rows: [{ local_date: start.date, local_end_date: end.date, local_start: start.time, local_end: end.time }] };
    }
    if (text.includes('AS covered')) return { rows: [{ covered: params[0] >= params[2] && params[1] <= params[3] }] };
    throw new Error(`Unexpected query: ${text}`);
  } };
  const hours = loadService('assistantBookingHours.js', { '../db/pool': { pool: db } });
  const availability = loadService('clientBookingAvailability.js', {
    '../db/pool': { pool: db }, './assistantBookingHours': hours,
    './availabilityService': { listAvailableSlots: async () => ({ status: 'available', slots: candidates }) },
    './bookingIntent': {
      verifyService: async () => ({ verified: true, canonicalName: 'Massage' }),
      getIntent: async () => intent, displayDate: date => date,
      processBookingMessage: async () => { accepted++; return { handled: true }; },
    },
    './clientBookingInteractive': { decorateClientBookingResult: result => result },
  });
  return { availability, hours, intent, candidates, accepted: () => accepted };
}

test('client list agrees with final hours authority for full 90-minute visits and includes exact closing boundary', async () => {
  const { availability, hours, intent, candidates } = fixture();
  const result = await availability.authoritativeSlotsForIntent(intent, { now: new Date('2030-10-15T00:00:00Z') });
  assert.equal(result.status, 'available');
  assert.deepEqual(Array.from(result.slots, row => row.starts_at), [candidates[1].starts_at]);
  for (const candidate of candidates) {
    const finalCheck = await hours.checkAssistantBookingHours({ startsAt: candidate.starts_at, endsAt: candidate.ends_at });
    assert.equal(result.slots.some(row => row.starts_at === candidate.starts_at), finalCheck.covered);
  }
});

test('closed or unconfigured client booking hours hide all otherwise clinic-available slots', async () => {
  for (const options of [{ closed: true }, { missing: true }]) {
    const { availability, intent } = fixture(options);
    const result = await availability.authoritativeSlotsForIntent(intent, { now: new Date('2030-10-15T00:00:00Z') });
    assert.equal(result.status, 'no_slots');
    assert.equal(result.slots.length, 0);
  }
});

test('wider client hours never allow a visit beyond the physical clinic boundary', async () => {
  const { availability, intent, candidates } = fixture({ assistantEnd: '20:00:00' });
  const result = await availability.authoritativeSlotsForIntent(intent, { now: new Date('2030-10-15T00:00:00Z') });
  assert.equal(result.slots.length, 3);
  assert.equal(result.slots.some(row => row.starts_at === candidates[4].starts_at), false);
});

test('stale WhatsApp selection outside client hours is refused and refreshed before booking intent mutation', async () => {
  const f = fixture();
  const result = await f.availability.processClientAvailabilityMessage('27830000000', 'client_slot_2_20301015_1600');
  assert.equal(f.accepted(), 0);
  assert.match(result.reply, /no longer available/);
  assert.equal(result.interactive.rows.length, 1);
  assert.equal(result.interactive.rows[0].id, 'client_slot_2_20301015_1430');
});

test('eligible selected time ending at client closing remains accepted', async () => {
  const f = fixture();
  await f.availability.processClientAvailabilityMessage('27830000000', 'client_slot_2_20301015_1430');
  assert.equal(f.accepted(), 1);
});
