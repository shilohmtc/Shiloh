'use strict';

// Canonical shared message data. No provider credentials or network operations.
const LEGACY_TEMPLATE_NAME = 'shiloh_birthday_wish_v1';

const TEMPLATE_NAME = 'shiloh_birthday_wish_v2';

const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'MARKETING';

const TEMPLATE_BODY = 'Happy birthday, {{1}}! 🎂 Wishing you a beautiful day from all of us at Shiloh Massage Therapy and Aesthetic Clinic. Thank you for being part of our community. 🌿';

const TEMPLATE_FOOTER = 'Reply BIRTHDAY OFF any time to stop birthday wishes.';

function buildBirthdayTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: { body_text: [['Christel']] },
      },
      {
        type: 'FOOTER',
        text: TEMPLATE_FOOTER,
      },
    ],
  };
}

module.exports = { LEGACY_TEMPLATE_NAME, TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, TEMPLATE_FOOTER, buildBirthdayTemplateDefinition };
