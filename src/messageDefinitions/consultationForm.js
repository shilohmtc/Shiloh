'use strict';

// Canonical shared message data. No provider credentials or network operations.
const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'UTILITY';

const TEMPLATE_FOOTER = 'Shiloh Massage Therapy & Aesthetic Clinic';

const FORM_URL = 'https://app.shilohmtc.co.za/forms/f/{{1}}';

const TEMPLATE_SPECS = Object.freeze([
  Object.freeze({
    key: 'consultation_form',
    name: 'shiloh_consultation_form_v1',
    header: 'Consultation form',
    body: 'Hi {{1}}, before your Shiloh appointment for {{2}} on {{3}}, please complete your consultation form. It only takes a few minutes and helps your practitioner prepare for your treatment. If you have already completed it, no further action is needed.',
    bodyExample: ['Naledi Mokoena', 'Full Body Swedish', 'Thursday, 24 September 2026'],
  }),
  Object.freeze({
    key: 'consultation_form_reminder',
    name: 'shiloh_consultation_form_reminder_v1',
    header: 'Consultation form reminder',
    body: 'Hi {{1}}, a reminder to complete your consultation form before your Shiloh appointment for {{2}} on {{3}}. If you have already completed it, no further action is needed.',
    bodyExample: ['Naledi Mokoena', 'Hot Stone Massage', 'Thursday, 24 September 2026'],
  }),
]);

function buildConsultationFormTemplateDefinition(spec) {
  if (!spec) throw new Error('Consultation form template spec is required');
  return {
    name: spec.name,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: spec.header,
      },
      {
        type: 'BODY',
        text: spec.body,
        example: { body_text: [spec.bodyExample] },
      },
      {
        type: 'FOOTER',
        text: TEMPLATE_FOOTER,
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Complete form',
            url: FORM_URL,
            example: ['example-consultation-token'],
          },
        ],
      },
    ],
  };
}

function buildConsultationFormTemplateDefinitions() {
  return TEMPLATE_SPECS.map(buildConsultationFormTemplateDefinition);
}

function semanticButton(button = {}) {
  const normalized = { type: String(button.type || '').toUpperCase() };
  if (button.text != null) normalized.text = button.text;
  if (button.url != null) normalized.url = button.url;
  return normalized;
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

function providerContractMatches(provider, definition) {
  return Boolean(
    provider?.name === definition.name
    && provider?.language === definition.language
    && String(provider?.category || '').toUpperCase() === definition.category
    && JSON.stringify(semanticComponents(provider?.components)) === JSON.stringify(semanticComponents(definition.components))
  );
}

module.exports = { TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_FOOTER, FORM_URL, TEMPLATE_SPECS, buildConsultationFormTemplateDefinition, buildConsultationFormTemplateDefinitions, semanticButton, semanticComponents, providerContractMatches };
