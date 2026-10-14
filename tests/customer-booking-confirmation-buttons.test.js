const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const confirmation = fs.readFileSync(path.join(root, 'src', 'services', 'customerBookingConfirmation.js'), 'utf8');
const appointmentActions = fs.readFileSync(path.join(root, 'src', 'services', 'customerAppointmentActions.js'), 'utf8');
const provisioning = fs.readFileSync(path.join(root, 'src', 'messageDefinitions', 'bookingConfirmation.js'), 'utf8');
const { shouldSendLegacyConfirmationSupplements, bookingConfirmationTemplatePayload, providerMessageId } = require('../src/services/customerBookingConfirmation');

test('live booking confirmation v1 suppresses all four redundant supplemental message groups', () => {
  assert.equal(shouldSendLegacyConfirmationSupplements('shiloh_booking_confirmation_v1'), false);
  assert.equal(shouldSendLegacyConfirmationSupplements('shiloh_booking_confirmation_v2'), false);
  assert.equal(shouldSendLegacyConfirmationSupplements(''), true);

  const suppression = confirmation.indexOf('const supplementalActionsSuppressed=!shouldSendLegacyConfirmationSupplements(template);');
  const guard = confirmation.indexOf('if(!supplementalActionsSuppressed){', suppression);
  const googleAction = confirmation.indexOf("sendOptionalConfirmationAction('google_calendar'", guard);
  const appleAction = confirmation.indexOf("sendOptionalConfirmationAction('apple_outlook_calendar'", guard);
  const changeAction = confirmation.indexOf("sendOptionalConfirmationAction('booking_change_buttons'", guard);
  const postBookAction = confirmation.indexOf("sendOptionalConfirmationAction('post_confirmation_menu'", guard);

  assert.ok(suppression >= 0, 'suppression policy must be evaluated after confirmation delivery');
  assert.ok(guard > suppression, 'legacy supplemental sends must be behind the suppression guard');
  for (const index of [googleAction, appleAction, changeAction, postBookAction]) {
    assert.ok(index > guard, 'every redundant supplemental group must remain inside the guarded legacy block');
  }
  assert.match(confirmation, /supplementalActionsSuppressed,confirmationActions/);
});

test('approved Meta v1 contract stays unchanged while live delivery is simplified', () => {
  assert.match(provisioning, /shiloh_booking_confirmation_v1/);
  assert.match(provisioning, /Google Calendar: \{\{6\}\}/);
  assert.match(provisioning, /Apple \/ Outlook \/ phone: \{\{7\}\}/);
  assert.match(provisioning, /Reply RESCHEDULE or CANCEL/);
  assert.match(confirmation, /bookingConfirmationTemplatePayload\(\{template,appointmentId,clientName,serviceName,staffName,date,time,google,ics\}\)/);
});

test('canonical calendar and booking-change actions remain available outside automatic v1 delivery', () => {
  assert.match(appointmentActions, /sendWhatsAppCtaUrl/);
  assert.match(appointmentActions, /Add to Google Calendar/);
  assert.match(appointmentActions, /Add to Apple \/ Outlook/);
  assert.match(appointmentActions, /client_reschedule_booking/);
  assert.match(appointmentActions, /client_cancel_booking/);
  assert.match(appointmentActions, /requirePhoneMatch/);
});


test('v2 delivery uses the exact five body parameters and three appointment-scoped quick replies', () => {
  const payload = bookingConfirmationTemplatePayload({
    template: 'shiloh_booking_confirmation_v2',
    appointmentId: 575,
    clientName: 'Juvan Botha',
    serviceName: 'Full Body Swedish',
    staffName: 'Christel',
    date: 'Friday, 21 August 2026',
    time: '15:00–16:30',
    google: 'https://calendar.google.example/v1',
    ics: 'https://shiloh.example/calendar/token.ics',
  });
  assert.deepEqual(payload, {
    bodyParameters: ['Juvan Botha', 'Full Body Swedish', 'Christel', 'Friday, 21 August 2026', '15:00–16:30'],
    quickReplyPayloads: [
      'client_booking_confirmation_v2_calendar_575',
      'client_booking_confirmation_v2_manage_575',
      'client_postbook_my_appointments',
    ],
  });
});

test('v1 fallback retains seven body parameters and no quick replies', () => {
  const payload = bookingConfirmationTemplatePayload({
    template: 'shiloh_booking_confirmation_v1',
    appointmentId: 575,
    clientName: 'Juvan Botha',
    serviceName: 'Full Body Swedish',
    staffName: 'Christel',
    date: 'Friday, 21 August 2026',
    time: '15:00–16:30',
    google: 'https://calendar.google.example/v1',
    ics: 'https://shiloh.example/calendar/token.ics',
  });
  assert.deepEqual(payload, {
    bodyParameters: [
      'Juvan Botha',
      'Full Body Swedish',
      'Christel',
      'Friday, 21 August 2026',
      '15:00–16:30',
      'https://calendar.google.example/v1',
      'https://shiloh.example/calendar/token.ics',
    ],
    quickReplyPayloads: [],
  });
});

test('provider acceptance evidence extracts the durable Meta message id', () => {
  assert.equal(providerMessageId({ messages: [{ id: 'wamid.test' }] }), 'wamid.test');
  assert.equal(providerMessageId({}), null);
  assert.match(confirmation, /template_name=\$2,provider_message_id=\$3/);
  assert.match(confirmation, /templateName:template\|\|null,providerMessageId:acceptedProviderMessageId/);
});
