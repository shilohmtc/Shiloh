'use strict';

// Canonical shared message data. No provider credentials or network operations.
const TEMPLATE_NAME = 'shiloh_booking_confirmation_v1';

const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'UTILITY';

const TEMPLATE_BODY = `Hi {{1}}, your Shiloh appointment is confirmed. 🌿

✨ Service: {{2}}
👤 With: {{3}}
📅 Date: {{4}}
🕐 Time: {{5}}

Add to calendar:
Google Calendar: {{6}}
Apple / Outlook / phone: {{7}}

Need to make a change? Reply RESCHEDULE or CANCEL.
We look forward to seeing you. 🌿`;

function buildBookingConfirmationTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: {
          body_text: [[
            'Christel',
            'HIFU',
            'Abigail',
            'Friday, 14 August 2026',
            '10:00–10:30',
            'https://calendar.google.com/calendar/render?example=1',
            'https://shiloh.example/calendar/example.ics',
          ]],
        },
      },
    ],
  };
}

module.exports = { TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, buildBookingConfirmationTemplateDefinition };
