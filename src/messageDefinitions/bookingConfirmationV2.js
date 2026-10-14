'use strict';

// Canonical shared message data. No provider credentials or network operations.
const TEMPLATE_NAME = 'shiloh_booking_confirmation_v2';

const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'UTILITY';

const TEMPLATE_HEADER = 'Appointment confirmed';

const TEMPLATE_BODY = `Hi {{1}}, your Shiloh appointment is confirmed. 🌿

✨ Service: {{2}}
👤 Practitioner: {{3}}
📅 Date: {{4}}
🕐 Time: {{5}}

Use the options below to add this appointment to your calendar or manage your booking.

We look forward to welcoming you. 🌿`;

const TEMPLATE_FOOTER = 'Shiloh Massage Therapy & Aesthetic Clinic';

const TEMPLATE_BUTTONS = Object.freeze([
  'Add to calendar',
  'Manage booking',
  'My appointments',
]);

function buildBookingConfirmationV2TemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: TEMPLATE_HEADER,
      },
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: {
          body_text: [[
            'Naledi Mokoena',
            'Full Body Swedish',
            'Abigail',
            'Thursday, 20 August 2026',
            '15:00–16:30',
          ]],
        },
      },
      {
        type: 'FOOTER',
        text: TEMPLATE_FOOTER,
      },
      {
        type: 'BUTTONS',
        buttons: TEMPLATE_BUTTONS.map((text) => ({ type: 'QUICK_REPLY', text })),
      },
    ],
  };
}

function semanticButton(button = {}) {
  return { type: String(button.type || '').toUpperCase(), text: button.text ?? null };
}

function semanticComponents(components = []) {
  return (Array.isArray(components) ? components : []).map((component) => {
    const normalized = { type: String(component.type || '').toUpperCase() };
    if (component.format != null) normalized.format = String(component.format).toUpperCase();
    if (component.text != null) normalized.text = component.text;
    if (Array.isArray(component.buttons)) normalized.buttons = component.buttons.map(semanticButton);
    return normalized;
  });
}

function providerContractMatches(provider) {
  const expected = buildBookingConfirmationV2TemplateDefinition();
  return Boolean(
    provider?.name === expected.name &&
    provider?.language === expected.language &&
    String(provider?.category || '').toUpperCase() === expected.category &&
    JSON.stringify(semanticComponents(provider?.components)) === JSON.stringify(semanticComponents(expected.components))
  );
}

function renderBookingConfirmationV2Body(values = []) {
  if (!Array.isArray(values) || values.length !== 5) throw new Error('Booking confirmation v2 requires exactly five body values');
  return TEMPLATE_BODY.replace(/\{\{([1-5])\}\}/g, (_, index) => String(values[Number(index) - 1] ?? ''));
}

module.exports = { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_HEADER, TEMPLATE_BODY, TEMPLATE_FOOTER, TEMPLATE_BUTTONS, buildBookingConfirmationV2TemplateDefinition, semanticButton, semanticComponents, providerContractMatches, renderBookingConfirmationV2Body };
