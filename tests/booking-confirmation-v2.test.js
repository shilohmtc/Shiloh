const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const provisioning = require('../src/messageDefinitions/bookingConfirmationV2');
const {
  bookingConfirmationV2QuickReplyPayloads,
  commandForClientBookingButton,
} = require('../src/services/clientBookingInteractive');
const {
  manageBookingInteractive,
  processBookingConfirmationV2Action,
} = require('../src/services/bookingConfirmationV2Actions');
const { CONTRACTS, configuredTemplateName, assertTemplateSendAllowed, resetTemplateInventoryCache } = require('../src/services/metaTemplateContracts');

const originalGet = axios.get;
const originalPost = axios.post;
const originalEnv = { ...process.env };

test.afterEach(() => {
  axios.get = originalGet;
  axios.post = originalPost;
  process.env = { ...originalEnv };
});

test('booking confirmation v2 freezes the exact approved local contract', () => {
  assert.equal(provisioning.TEMPLATE_NAME, 'shiloh_booking_confirmation_v2');
  assert.equal(provisioning.TEMPLATE_LANGUAGE, 'en');
  assert.equal(provisioning.TEMPLATE_CATEGORY, 'UTILITY');
  assert.equal(provisioning.TEMPLATE_HEADER, 'Appointment confirmed');
  assert.equal(provisioning.TEMPLATE_FOOTER, 'Shiloh Massage Therapy & Aesthetic Clinic');
  assert.deepEqual(provisioning.TEMPLATE_BUTTONS, [
    'Add to calendar',
    'Manage booking',
    'My appointments',
  ]);

  const definition = provisioning.buildBookingConfirmationV2TemplateDefinition();
  assert.equal(definition.name, 'shiloh_booking_confirmation_v2');
  assert.equal(definition.language, 'en');
  assert.equal(definition.category, 'UTILITY');
  assert.deepEqual(definition.components.map((component) => component.type), ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);

  const header = definition.components[0];
  const body = definition.components[1];
  const footer = definition.components[2];
  const buttons = definition.components[3];
  assert.deepEqual(header, { type: 'HEADER', format: 'TEXT', text: 'Appointment confirmed' });
  assert.equal(footer.text, 'Shiloh Massage Therapy & Aesthetic Clinic');
  assert.deepEqual(buttons.buttons, [
    { type: 'QUICK_REPLY', text: 'Add to calendar' },
    { type: 'QUICK_REPLY', text: 'Manage booking' },
    { type: 'QUICK_REPLY', text: 'My appointments' },
  ]);

  assert.equal((body.text.match(/\{\{[1-5]\}\}/g) || []).length, 5);
  for (let i = 1; i <= 5; i += 1) assert.match(body.text, new RegExp(`\\{\\{${i}\\}\\}`));
  assert.doesNotMatch(body.text, /\{\{6\}\}|https?:\/\/|www\.|book another|upsell|offer|discount/i);
  assert.equal(body.example.body_text[0].length, 5);
});

test('booking confirmation v2 renders long realistic values without truncation or URL leakage', () => {
  const values = [
    'Naledi-Palesa Mokoena van der Merwe',
    'Advanced Full Body Swedish Massage with Focused Lower Back, Hip & Psoas Release',
    'Abigail Ndlovu-Mahlangu',
    'Thursday, 27 August 2026',
    '15:15–16:45',
  ];
  const rendered = provisioning.renderBookingConfirmationV2Body(values);
  for (const value of values) assert.match(rendered, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(rendered, /https?:\/\/|www\.|book another/i);
  assert.equal(rendered.includes('{{'), false);
  assert.equal(rendered.includes('…') && !values.some((value) => value.includes('…')), false);
  assert.throws(() => provisioning.renderBookingConfirmationV2Body(values.slice(0, 4)), /exactly five/);
});

test('v2 quick-reply payloads are appointment-scoped and normalize into canonical handlers', () => {
  const payloads = bookingConfirmationV2QuickReplyPayloads(575);
  assert.deepEqual(payloads, [
    'client_booking_confirmation_v2_calendar_575',
    'client_booking_confirmation_v2_manage_575',
    'client_postbook_my_appointments',
  ]);
  assert.equal(commandForClientBookingButton(payloads[0]), 'booking confirmation v2 calendar 575');
  assert.equal(commandForClientBookingButton(payloads[1]), 'booking confirmation v2 manage 575');
  assert.equal(commandForClientBookingButton(payloads[2]), 'my appointments');
  assert.throws(() => bookingConfirmationV2QuickReplyPayloads(0), /valid appointment id/);
});

test('Add to calendar delegates to the existing appointment CTA path with phone ownership required', async () => {
  const calls = [];
  const result = await processBookingConfirmationV2Action('27821234567', 'booking confirmation v2 calendar 575', {
    sendCalendar: async (...args) => {
      calls.push(args);
      return { sent: true, appointmentId: 575, actions: { googleCalendar: true, appleOutlook: true } };
    },
  });
  assert.equal(result.handled, true);
  assert.equal(result.appointmentId, 575);
  assert.deepEqual(calls, [[575, '27821234567', { requirePhoneMatch: true }]]);
});

test('Manage booking first tap is non-mutating and reuses guarded canonical booking actions', async () => {
  const expected = {
    type: 'button',
    body: '*Manage booking*\nChoose an option below. Shiloh will re-check the appointment before any change is made.',
    buttons: [
      { id: 'client_reschedule_booking', title: 'Reschedule' },
      { id: 'client_cancel_booking', title: 'Cancel booking' },
      { id: 'client_postbook_my_appointments', title: 'My appointments' },
    ],
  };
  assert.deepEqual(manageBookingInteractive(), expected);
  const result = await processBookingConfirmationV2Action('27821234567', 'booking confirmation v2 manage 575');
  assert.equal(result.handled, true);
  assert.equal(result.appointmentId, 575);
  assert.deepEqual(result.interactive, expected);
});

test('v2 is sendable only when explicitly selected and the exact provider gate passes', async () => {
  const entry = CONTRACTS.find((item) => item.key === 'booking_confirmation_v2');
  assert.ok(entry);
  assert.equal(entry.contract.name, 'shiloh_booking_confirmation_v2');
  assert.equal(entry.env, 'WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE');
  assert.equal(entry.sendable, true);

  process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE = 'shiloh_booking_confirmation_v1';
  assert.equal(configuredTemplateName(entry), 'shiloh_booking_confirmation_v1');
  await assert.rejects(() => assertTemplateSendAllowed('shiloh_booking_confirmation_v2'), /configuration does not match contract/);

  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'waba-test';
  process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE = 'shiloh_booking_confirmation_v2';
  const exact = provisioning.buildBookingConfirmationV2TemplateDefinition();
  axios.get = async () => ({ data: { data: [{ id: 'provider-1', status: 'APPROVED', ...exact }] } });
  resetTemplateInventoryCache();
  const state = await assertTemplateSendAllowed('shiloh_booking_confirmation_v2', 'en');
  assert.equal(state.ready, true);
  assert.equal(state.provider.duplicateCount, 0);
  assert.equal(state.contract.exact, true);
});
