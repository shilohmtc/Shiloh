const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  standardizeBookingCategories,
  standardizeInteractive,
  standardizeRow,
} = require('../src/services/adminUxStandardization');

function service(id, name) { return { id, name }; }

test('Body Treatments contains the existing body services plus the three approved services', () => {
  const massage = service(1, 'Back & Neck Massage');
  const bodySculp = service(2, 'Body Sculp');
  const vaginal = service(3, 'Vaginal Tightening & Rejuvenation');
  const pelvic = service(4, 'Neo Pelvic Therapy');
  const ozone = service(5, 'Ozone & Far Infrared');
  const needling = service(6, 'Microneedling');
  const consultation = service(7, 'Consultation');

  const categories = [
    {
      name: 'Massage & Body',
      services: [massage, bodySculp],
      groups: [
        { name: 'Sports & Therapeutic', services: [massage] },
        { name: 'Body Technology', services: [bodySculp] },
      ],
    },
    {
      name: 'Needling & Aesthetics',
      services: [vaginal, needling],
      groups: [{ name: 'Needling & Regeneration', services: [vaginal, needling] }],
    },
    {
      name: 'Other',
      services: [pelvic, ozone, consultation],
      groups: [{ name: 'Other Treatments', services: [pelvic, ozone, consultation] }],
    },
  ];

  const result = standardizeBookingCategories(categories);
  const body = result.find((category) => category.name === 'Body Treatments');
  assert.ok(body);
  assert.deepEqual(body.services.map((item) => item.id), [1, 2, 3, 4, 5]);
  assert.equal(body.services.length, 5);

  const technology = body.groups.find((group) => group.name === 'Body Technology');
  assert.ok(technology);
  assert.deepEqual(technology.services.map((item) => item.id), [2, 3, 4, 5]);

  const aesthetics = result.find((category) => category.name === 'Needling & Aesthetics');
  assert.deepEqual(aesthetics.services.map((item) => item.id), [6]);

  const other = result.find((category) => category.name === 'Other');
  assert.deepEqual(other.services.map((item) => item.id), [7]);
});

test('Body Treatments rename preserves non-target service IDs and removes duplicate target entries', () => {
  const ozone = service(10, 'Ozone & Far Infrared');
  const categories = [
    { name: 'Massage & Body', services: [ozone], groups: [{ name: 'Other Massage & Body', services: [ozone] }] },
    { name: 'Other', services: [ozone], groups: [{ name: 'Other Treatments', services: [ozone] }] },
  ];

  const result = standardizeBookingCategories(categories);
  assert.equal(result[0].name, 'Body Treatments');
  assert.deepEqual(result[0].services.map((item) => item.id), [10]);
  assert.ok(!result.some((category) => category.name === 'Massage & Body'));
  assert.ok(!result.some((category) => category.name === 'Other'));
});

test('new-booking cancellation copy is explicit without changing existing appointment cancellation', () => {
  const newBooking = standardizeRow({ id: 'admin_booking_cancel_flow', title: 'Cancel booking', description: 'Exit without creating anything' });
  assert.equal(newBooking.title, 'Cancel new booking');
  assert.equal(newBooking.description, 'Exit without creating a booking');

  const existingAppointment = standardizeRow({ id: 'manage_cancel_booking_123', title: 'Cancel booking', description: 'Cancel this appointment safely' });
  assert.equal(existingAppointment.title, 'Cancel booking');
  assert.equal(existingAppointment.description, 'Cancel this appointment safely');
});

test('pending new-booking confirmation button is standardized without changing unrelated cancellation controls', () => {
  const result = standardizeInteractive({
    type: 'button',
    body: 'Choose whether to confirm or cancel this pending booking.',
    buttons: [
      { id: 'admin_booking_confirm', title: 'Confirm booking' },
      { id: 'admin_booking_cancel', title: 'Cancel booking' },
      { id: 'cancel_confirm', title: 'Confirm cancellation' },
    ],
  });

  assert.equal(result.buttons[0].title, 'Confirm booking');
  assert.equal(result.buttons[1].title, 'Cancel new booking');
  assert.equal(result.buttons[2].title, 'Confirm cancellation');
});

test('Admin action labels and descriptions use the standardized menu copy', () => {
  assert.deepEqual(
    standardizeRow({ id: 'admin_action_booking', title: 'Make a booking', description: 'Book using authoritative availability' }),
    { id: 'admin_action_booking', title: 'New booking', description: 'Create a new booking' }
  );
  assert.deepEqual(
    standardizeRow({ id: 'admin_action_manage_booking', title: 'Manage a booking', description: 'Reschedule or cancel an existing appointment' }),
    { id: 'admin_action_manage_booking', title: 'Manage booking', description: 'View, reschedule or cancel a booking' }
  );
  assert.deepEqual(
    standardizeRow({ id: 'admin_section_schedule', title: 'Schedule', description: 'Open schedule admin actions' }),
    { id: 'admin_section_schedule', title: 'Schedule', description: 'Working hours and time off' }
  );
});

test('interactive presentation standardizes headings, category labels and back copy', () => {
  const result = standardizeInteractive({
    type: 'list',
    body: '*Find & book an appointment*\n\nChoose what you want to do.',
    sectionTitle: 'Massage & Body',
    rows: [
      { id: 'admin_booking_category:0', title: 'Massage & Body', description: '5 services' },
      { id: 'menu', title: '← Back to Admin', description: 'Return to the main admin menu' },
    ],
  });

  assert.equal(result.body, '*New booking*\n\nChoose an action.');
  assert.equal(result.sectionTitle, 'Body Treatments');
  assert.equal(result.rows[0].title, 'Body Treatments');
  assert.equal(result.rows[1].description, 'Return to the main Admin menu');
});

test('Shiloh Admin welcome keeps branding and personalized greeting while removing redundant prompts', () => {
  const result = standardizeInteractive({
    type: 'list',
    body: '*Shiloh Admin 🌿*\nWelcome back, Jean-Pierre 👋\n\nWhat would you like to do today?\n\nChoose a section below.',
    rows: [],
  });

  assert.equal(
    result.body,
    '*Shiloh Admin 🌿*\nWelcome back, Jean-Pierre 👋\n\nWhat would you like to manage today?'
  );
});

test('Admin welcome polish does not rewrite non-Admin messages with similar wording', () => {
  const body = '*Client menu*\n\nWhat would you like to do today?\n\nChoose a section below.';
  const result = standardizeInteractive({ type: 'list', body, rows: [] });
  assert.equal(result.body, body);
});

test('Admin UX standardization preload remains while Block Time no-op is absent', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const scriptName of ['start', 'dev']) {
    const script = pkg.scripts[scriptName];
    assert.doesNotMatch(script, /adminBlockTimePatch\.js/);
    assert.match(script, /adminUxStandardizationPatch\.js/);
  }
});
