'use strict';

// Canonical shared message data. No provider credentials or network operations.
const TEMPLATE_NAME = 'shiloh_appointment_reminder_actions_v1';

const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'UTILITY';

const TEMPLATE_BODY = `Hello {{1}},

This is a friendly reminder of your appointment at Shiloh Massage Therapy & Aesthetic Clinic.

Treatment: {{2}}
Date: {{3}}
Time: {{4}}

We look forward to welcoming you.

Need to make a change? Use a button below.`;

function buildReminderActionTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: {
          body_text: [['Dummy Test', 'Medi-Heel Pedicure', 'Sat, 15 Aug 2026', '12:15']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Reschedule' },
          { type: 'QUICK_REPLY', text: 'Cancel booking' },
        ],
      },
    ],
  };
}

module.exports = { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, buildReminderActionTemplateDefinition };
