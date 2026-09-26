'use strict';

const {
  ACTION_TYPE_CANCEL,
  ACTION_TYPE_RESCHEDULE,
  createMyShilohClientActionService,
} = require('./myShilohClientActions');
const {
  ACTION_TYPE_FORM,
  createMyShilohConsultationFormActionService,
} = require('./myShilohConsultationFormActions');

const ACTION_TOOL_NAMES = Object.freeze({
  PREPARE_CANCELLATION: 'prepare_my_cancellation',
  PREPARE_RESCHEDULE: 'prepare_my_reschedule',
  PREPARE_CONSULTATION_FORM: 'prepare_my_consultation_form',
  OPEN_PROFILE: 'open_my_personal_details',
});

const ACTION_TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    name: ACTION_TOOL_NAMES.PREPARE_CANCELLATION,
    description: 'Prepare, but do not execute, cancellation of the authenticated client’s next upcoming Shiloh appointment. This creates a confirmation card that the client must explicitly approve.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: ACTION_TOOL_NAMES.PREPARE_RESCHEDULE,
    description: 'Prepare a reschedule request for the authenticated client’s next appointment using an exact startsAt returned by find_available_slots. This never moves the appointment; client confirmation and the authorized clinic decision are still required.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        startsAt: {
          type: 'string',
          description: 'Exact ISO 8601 slot start returned by find_available_slots.',
        },
      },
      required: ['startsAt'],
      additionalProperties: false,
    },
  },
]);

const CONSULTATION_FORM_TOOL_DEFINITION = Object.freeze({
  type: 'function',
  name: ACTION_TOOL_NAMES.PREPARE_CONSULTATION_FORM,
  description: 'Prepare a Complete form action for the authenticated client’s single pending consultation form. The form target is resolved server-side and the AI never receives a form ID or access token.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
});

const PROFILE_TOOL_DEFINITION = Object.freeze({
  type: 'function',
  name: ACTION_TOOL_NAMES.OPEN_PROFILE,
  description: 'Open the authenticated client’s Personal details area in My Shiloh. Use when they ask to view, correct or update their profile details. The verified WhatsApp number remains non-editable.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
});

function createMyShilohActionTools({
  actionService = createMyShilohClientActionService(),
  formActionService = createMyShilohConsultationFormActionService(),
} = {}) {
  if (
    !actionService
    || typeof actionService.prepareCancellation !== 'function'
    || typeof actionService.prepareReschedule !== 'function'
    || !formActionService
    || typeof formActionService.prepareFormAction !== 'function'
  ) {
    throw new Error('My Shiloh client action service is required');
  }

  function handles(name) {
    return name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION
      || name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE
      || name === ACTION_TOOL_NAMES.PREPARE_CONSULTATION_FORM
      || name === ACTION_TOOL_NAMES.OPEN_PROFILE;
  }

  async function execute(name, args = {}, { sessionId, crmV2ClientId } = {}) {
    if (!handles(name)) return { modelResult: { ok: false, error: 'unknown_action_tool' }, clientAction: null };
    if (name === ACTION_TOOL_NAMES.OPEN_PROFILE) {
      return {
        modelResult: {
          ok: true,
          prepared: true,
          action: 'profile_details',
          message: 'The signed-in Personal details area is ready to open. No profile value has been changed.',
        },
        clientAction: {
          type: 'profile_details',
          title: 'Update your personal details',
          detail: 'Review your full name, date of birth and gender in your private Profile area.',
          note: 'Your verified WhatsApp number cannot be changed here. The clinic team must verify a replacement number.',
          label: 'Open personal details',
          href: '#profile',
        },
      };
    }
    const result = name === ACTION_TOOL_NAMES.PREPARE_CONSULTATION_FORM
      ? await formActionService.prepareFormAction({ sessionId, crmV2ClientId })
      : name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE
      ? await actionService.prepareReschedule({
        sessionId,
        crmV2ClientId,
        proposedStartsAt: args.startsAt,
      })
      : await actionService.prepareCancellation({ sessionId, crmV2ClientId });
    if (!result.ok) {
      if (result.code === 'CLIENT_FORM_MULTIPLE_PENDING') {
        return {
          modelResult: {
            ok: false,
            error: 'multiple_forms_pending',
            message: 'More than one consultation form is waiting. The clinic team must help open the correct form safely.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_FORM_UNAVAILABLE') {
        return {
          modelResult: {
            ok: false,
            error: 'form_unavailable',
            message: 'There is no consultation form that can be opened safely right now.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_NO_UPCOMING_APPOINTMENT') {
        return {
          modelResult: {
            ok: false,
            error: 'no_upcoming_appointment',
            message: 'There is no upcoming appointment available to cancel.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_SLOT_UNAVAILABLE' || result.code === 'CLIENT_ACTION_RESCHEDULE_SLOT_INVALID') {
        return {
          modelResult: {
            ok: false,
            error: 'slot_unavailable',
            message: 'That replacement time is no longer available. Check availability again before preparing another request.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_COMPLEX_BOOKING') {
        return {
          modelResult: {
            ok: false,
            error: 'complex_booking',
            message: 'This is a linked/group booking and cannot be cancelled through this self-service confirmation. The clinic team must help with it.',
          },
          clientAction: null,
        };
      }
      return {
        modelResult: {
          ok: false,
          error: 'action_unavailable',
          message: 'A cancellation confirmation could not be prepared safely.',
        },
        clientAction: null,
      };
    }
    return {
      modelResult: result.modelResult,
      clientAction: [ACTION_TYPE_CANCEL, ACTION_TYPE_RESCHEDULE, ACTION_TYPE_FORM].includes(result.clientAction?.type)
        ? result.clientAction
        : null,
    };
  }

  return {
    definitions: [...ACTION_TOOL_DEFINITIONS, CONSULTATION_FORM_TOOL_DEFINITION, PROFILE_TOOL_DEFINITION],
    handles,
    execute,
  };
}

module.exports = {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_DEFINITIONS,
  CONSULTATION_FORM_TOOL_DEFINITION,
  PROFILE_TOOL_DEFINITION,
  createMyShilohActionTools,
};
