const { displayDate } = require('./bookingIntent');
const { CLIENT_COPY } = require('../config/clientCopy');

const CLIENT_BOOKING_BUTTON_COMMANDS = Object.freeze({
  client_book_now: 'services',
  client_booking_start: 'services',
  client_date_today: 'today',
  client_date_tomorrow: 'tomorrow',
  client_time_morning: 'morning',
  client_time_afternoon: 'afternoon',
  client_time_evening: 'evening',
  client_booking_confirm: 'yes',
  client_booking_change: 'change',
  client_booking_cancel: 'cancel',
  client_reschedule_booking: 'RESCHEDULE',
  client_cancel_booking: 'CANCEL',
  client_postbook_book_another: 'booking',
  client_postbook_my_appointments: 'my appointments',
  client_postbook_main_menu: 'main menu',
});

const BOOKING_CONFIRMATION_V2_PAYLOAD_PREFIX = 'client_booking_confirmation_v2';

function bookingConfirmationV2QuickReplyPayloads(appointmentId) {
  const id = Number(appointmentId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Booking confirmation v2 requires a valid appointment id');
  return [
    `${BOOKING_CONFIRMATION_V2_PAYLOAD_PREFIX}_calendar_${id}`,
    `${BOOKING_CONFIRMATION_V2_PAYLOAD_PREFIX}_manage_${id}`,
    'client_postbook_my_appointments',
  ];
}

function commandForClientBookingButton(id = '') {
  const normalized = String(id || '').trim();
  const v2 = normalized.match(/^client_booking_confirmation_v2_(calendar|manage)_(\d+)$/);
  if (v2) return `booking confirmation v2 ${v2[1]} ${v2[2]}`;
  return CLIENT_BOOKING_BUTTON_COMMANDS[normalized] || null;
}

function treatmentTeamLines() {
  return [
    'Shiloh’s client-facing treatment team:',
    '• Christel — Massage practitioner',
    '• Abigail — Massage & Lymphatic Drainage practitioner',
    '• Marietjie — Beauty & Aesthetics practitioner',
  ];
}

function bookingDiscoveryInteractive() {
  return {
    type: 'list',
    body: [
      '*What would you like to book? 🌿*',
      '',
      CLIENT_COPY.bookingDiscoveryPrompt,
    ].join('\n'),
    buttonText: 'Choose service',
    rows: [
      { id: 'client_family_beauty', title: 'Beauty & Aesthetics', description: 'View beauty & aesthetics treatments' },
      { id: 'client_family_massage', title: 'Massage Treatments', description: 'View massage treatments' },
      { id: 'client_family_lymphatic', title: 'Lymphatic Drainage', description: 'View lymphatic drainage treatments' },
      { id: 'client_family_pedicure', title: 'Elim MediHeel Pedicures', description: 'View pedicure treatments' },
    ],
    sectionTitle: 'Shiloh treatments',
  };
}

function practitionerRequiredInteractive(intent) {
  return {
    type: 'button',
    body: [
      `*${intent.service_text}*`,
      '',
      'Choose from the practitioners currently eligible for this treatment, including an explicit *Any available* option.',
    ].join('\n'),
    buttons: [
      { id: 'client_selected_service_practitioners', title: 'See practitioners' },
      { id: 'client_browse_services', title: 'Change treatment' },
    ],
  };
}

function dateInteractive(intent) {
  return {
    type: 'button',
    body: [
      `*${intent.service_text}*`,
      `Practitioner: ${intent.therapist_text}`,
      '',
      'What day would you prefer?',
      'Choose a quick option below, or type another day/date such as *next Friday* or *21 August*.',
    ].join('\n'),
    buttons: [
      { id: 'client_date_today', title: 'Today' },
      { id: 'client_date_tomorrow', title: 'Tomorrow' },
    ],
  };
}

function timeInteractive(intent) {
  return {
    type: 'button',
    body: [
      `*${intent.service_text}*`,
      `Date: ${displayDate(intent.preferred_date)}`,
      `Practitioner: ${intent.therapist_text}`,
      '',
      'What time of day would you prefer?',
      'Choose below, or type an exact time such as *14:00* or *2pm*.',
    ].join('\n'),
    buttons: [
      { id: 'client_time_morning', title: 'Morning' },
      { id: 'client_time_afternoon', title: 'Afternoon' },
      { id: 'client_time_evening', title: 'Evening' },
    ],
  };
}

function confirmationInteractive(intent) {
  return {
    type: 'button',
    body: [
      '*Please check your booking preferences*',
      `Service: ${intent.service_text}`,
      `Practitioner: ${intent.therapist_text}`,
      `Date: ${displayDate(intent.preferred_date)}`,
      `Time: ${intent.preferred_time}`,
      '',
      'Nothing is booked yet. Confirm these details to continue to Shiloh’s Booking Policy & Terms, or change/cancel the request.',
    ].join('\n'),
    buttons: [
      { id: 'client_booking_confirm', title: 'Confirm details' },
      { id: 'client_booking_change', title: 'Change details' },
      { id: 'client_booking_cancel', title: 'Cancel request' },
    ],
  };
}

function postConfirmationButtons() {
  return [
    { id: 'client_postbook_book_another', title: 'Book another' },
    { id: 'client_postbook_my_appointments', title: 'My appointments' },
    { id: 'client_postbook_main_menu', title: 'Main menu' },
  ];
}

function decorateClientBookingResult(result) {
  if (!result?.handled || !result.intent) return result;
  const intent = result.intent;

  if (intent.status === 'collecting' && !intent.service_text) {
    return { ...result, interactive: bookingDiscoveryInteractive() };
  }

  if (
    ['collecting', 'awaiting_confirmation'].includes(intent.status) &&
    intent.service_text &&
    intent.service_verified !== false &&
    !intent.therapist_text
  ) {
    return { ...result, interactive: practitionerRequiredInteractive(intent) };
  }

  if (
    intent.status === 'collecting' &&
    intent.service_text &&
    intent.service_verified !== false &&
    intent.therapist_text &&
    !intent.preferred_date
  ) {
    return { ...result, interactive: dateInteractive(intent) };
  }

  if (
    intent.status === 'collecting' &&
    intent.service_text &&
    intent.service_verified !== false &&
    intent.therapist_text &&
    intent.preferred_date &&
    !intent.preferred_time
  ) {
    return { ...result, interactive: timeInteractive(intent) };
  }

  if (intent.status === 'awaiting_confirmation' && intent.therapist_text) {
    return { ...result, interactive: confirmationInteractive(intent) };
  }

  return result;
}

module.exports = {
  CLIENT_BOOKING_BUTTON_COMMANDS,
  BOOKING_CONFIRMATION_V2_PAYLOAD_PREFIX,
  bookingConfirmationV2QuickReplyPayloads,
  bookingDiscoveryInteractive,
  commandForClientBookingButton,
  dateInteractive,
  timeInteractive,
  confirmationInteractive,
  postConfirmationButtons,
  decorateClientBookingResult,
  practitionerRequiredInteractive,
  treatmentTeamLines,
};
