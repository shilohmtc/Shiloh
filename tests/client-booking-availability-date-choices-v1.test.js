const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dateChoicesPath = path.join(__dirname, '..', 'src', 'services', 'clientBookingDateChoices.js');
const availabilityPath = path.join(__dirname, '..', 'src', 'services', 'clientBookingAvailability.js');

const dateChoicesSource = fs.readFileSync(dateChoicesPath, 'utf8');
const availabilitySource = fs.readFileSync(availabilityPath, 'utf8');

const {
  applyAvailabilityAwareDateChoices,
  availableDateChoicesForIntent,
  dateChoiceButtons,
} = require(dateChoicesPath);

const baseIntent = {
  status: 'collecting',
  service_text: 'Swedish Massage',
  service_verified: true,
  therapist_text: 'Christel',
  preferred_date: null,
  preferred_time: null,
};

function fakeSlotsForDates(dates) {
  const available = new Set(dates);
  return async (intent) => ({
    status: available.has(intent.preferred_date) ? 'available' : 'no_slots',
    slots: available.has(intent.preferred_date) ? [{ starts_at: `${intent.preferred_date}T10:00:00+02:00` }] : [],
  });
}

test('same-day is offered only when canonical availability returns a qualifying slot, and unavailable days are skipped', async () => {
  const choices = await availableDateChoicesForIntent(baseIntent, {
    now: new Date('2026-09-03T08:00:00Z'),
    clinicDateStatus: async () => ({ covered: true }),
    slotsForIntent: fakeSlotsForDates(['2026-09-03', '2026-09-05']),
    maxDays: 7,
  });

  assert.deepEqual(choices.map((choice) => choice.date), ['2026-09-03', '2026-09-05']);
  assert.equal(choices[0].title, 'Today');
  assert.match(choices[1].title, /Sat|5 Sep/i);
});

test('after-hours or exhausted same-day availability omits Today and advances to genuinely bookable dates', async () => {
  const choices = await availableDateChoicesForIntent(baseIntent, {
    now: new Date('2026-09-03T18:30:00Z'),
    clinicDateStatus: async () => ({ covered: true }),
    slotsForIntent: fakeSlotsForDates(['2026-09-04', '2026-09-07']),
    maxDays: 7,
  });

  assert.deepEqual(choices.map((choice) => choice.date), ['2026-09-04', '2026-09-07']);
  assert.equal(choices[0].title, 'Tomorrow');
  assert.notEqual(choices[0].title, 'Today');
});

test('closed clinic days are skipped before slot availability is considered', async () => {
  const checkedSlots = [];
  const choices = await availableDateChoicesForIntent(baseIntent, {
    now: new Date('2026-09-03T08:00:00Z'),
    clinicDateStatus: async ({ date }) => ({ covered: date !== '2026-09-04' }),
    slotsForIntent: async (intent) => {
      checkedSlots.push(intent.preferred_date);
      const available = ['2026-09-04', '2026-09-05', '2026-09-06'].includes(intent.preferred_date);
      return { slots: available ? [{ starts_at: `${intent.preferred_date}T10:00:00+02:00` }] : [] };
    },
    maxDays: 7,
  });

  assert.deepEqual(choices.map((choice) => choice.date), ['2026-09-05', '2026-09-06']);
  assert.equal(checkedSlots.includes('2026-09-04'), false);
});

test('runtime date buttons carry stable explicit dates and stay inside Meta reply-button limits', () => {
  const buttons = dateChoiceButtons([
    { date: '2026-09-04', title: 'Tomorrow' },
    { date: '2026-09-07', title: 'Mon 7 Sep' },
    { date: '2026-09-08', title: 'Tue 8 Sep' },
  ]);

  assert.deepEqual(buttons.map((button) => button.id), [
    'client_date_2026-09-04',
    'client_date_2026-09-07',
    'client_date_other',
  ]);
  assert.ok(buttons.length <= 3);
  assert.ok(buttons.every((button) => button.title.length <= 20));
});

test('availability-aware send decoration preserves booking copy and free-text fallback', async () => {
  const result = await applyAvailabilityAwareDateChoices({
    handled: true,
    intent: baseIntent,
    interactive: {
      type: 'button',
      body: 'What day would you prefer? Type another day/date if needed.',
      buttons: [
        { id: 'client_date_today', title: 'Today' },
        { id: 'client_date_tomorrow', title: 'Tomorrow' },
      ],
    },
  }, {
    now: new Date('2026-09-03T18:30:00Z'),
    clinicDateStatus: async () => ({ covered: true }),
    slotsForIntent: fakeSlotsForDates(['2026-09-05', '2026-09-06']),
    maxDays: 7,
  });

  assert.match(result.interactive.body, /Type another day\/date/i);
  assert.deepEqual(result.interactive.buttons.map((button) => button.id), [
    'client_date_2026-09-05',
    'client_date_2026-09-06',
    'client_date_other',
  ]);
});

test('no qualifying dates never falls back to blind Today/Tomorrow buttons', async () => {
  const result = await applyAvailabilityAwareDateChoices({
    handled: true,
    intent: baseIntent,
    interactive: {
      type: 'button',
      body: 'What day would you prefer?',
      buttons: [
        { id: 'client_date_today', title: 'Today' },
        { id: 'client_date_tomorrow', title: 'Tomorrow' },
      ],
    },
  }, {
    now: new Date('2026-09-03T18:30:00Z'),
    clinicDateStatus: async () => ({ covered: true }),
    slotsForIntent: fakeSlotsForDates([]),
    maxDays: 3,
  });

  assert.deepEqual(result.interactive.buttons, [{ id: 'client_date_other', title: 'Choose another date' }]);
  assert.match(result.interactive.body, /could not find a directly available date/i);
});

test('production wiring uses canonical future-slot authority and preserves explicit/free-text date routing', () => {
  assert.match(dateChoicesSource, /authoritativeSlotsForIntent/);
  assert.match(dateChoicesSource, /getClinicDateStatus/);
  assert.match(dateChoicesSource, /localIsoDate\(now\)/);
  assert.match(availabilitySource, /if \(!isFutureSlot\(enriched, now\)\) continue/);
  assert.match(availabilitySource, /const date = explicitBookingDate\(value\)\|\|extractDate\(value\)/);
  assert.match(availabilitySource, /async function revalidateSelectedSlot/);
  assert.match(availabilitySource, /const result = await listAvailableSlots\(/);
});

test('legacy availability-aware choices do not touch Meta template contracts', () => {
  assert.doesNotMatch(dateChoicesSource, /sendWhatsAppTemplate|assertTemplateSendAllowed|templateName|WABA/i);
});
