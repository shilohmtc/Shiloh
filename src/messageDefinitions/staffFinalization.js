'use strict';

// Canonical shared message data. No provider credentials or network operations.
const TEMPLATE_NAME = 'shiloh_staff_finalization_v1';

const ACTION_TEMPLATE_NAME = 'shiloh_staff_finalization_actions_v1';

const TEMPLATE_LANGUAGE = 'en';

const TEMPLATE_CATEGORY = 'UTILITY';

const TEMPLATE_BODY = 'Hi {{1}}, {{2}} Shiloh visit(s) {{4}} for {{3}}. Please open Shiloh Admin > Appointments > Finalize past visits and record Completed or No-show. Attendance is never inferred automatically.';

const ACTION_TEMPLATE_BODY = 'Hi {{1}}, you have {{2}} Shiloh visit(s) awaiting finalization. Review them in batches if needed and return later. Attendance is never inferred automatically.';

const ACTION_BUTTON_TEXT = 'Finalize past visits';

const ACTION_BUTTON_PAYLOAD = 'admin_action_finalize';

function buildStaffFinalizationTemplateDefinition() {
  return {
    name: TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: TEMPLATE_BODY,
        example: {
          body_text: [['Abigail', '2', '2026-08-12', 'need finalization from today']],
        },
      },
    ],
  };
}

function buildStaffFinalizationActionTemplateDefinition() {
  return {
    name: ACTION_TEMPLATE_NAME,
    language: TEMPLATE_LANGUAGE,
    category: TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: ACTION_TEMPLATE_BODY,
        example: { body_text: [['Christel', '24']] },
      },
      {
        type: 'BUTTONS',
        buttons: [{ type: 'QUICK_REPLY', text: ACTION_BUTTON_TEXT }],
      },
    ],
  };
}

module.exports = { TEMPLATE_NAME, ACTION_TEMPLATE_NAME, TEMPLATE_LANGUAGE, TEMPLATE_CATEGORY, TEMPLATE_BODY, ACTION_TEMPLATE_BODY, ACTION_BUTTON_TEXT, ACTION_BUTTON_PAYLOAD, buildStaffFinalizationTemplateDefinition, buildStaffFinalizationActionTemplateDefinition };
