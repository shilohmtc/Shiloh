'use strict';

const {
  ACTION_TYPE_CANCEL,
  ACTION_TYPE_RESCHEDULE,
  createMyShilohClientActionService,
} = require('./myShilohClientActions');

const ACTION_TOOL_NAMES = Object.freeze({
  PREPARE_CANCELLATION: 'prepare_my_cancellation',
  PREPARE_RESCHEDULE: 'prepare_my_reschedule',
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
    description: 'Prepare a reschedule request for the authenticated client’s next appointment using an exact startsAt returned by find_available_slots. This never moves the appointment; client confirmation is still required and practitioner approval remains authoritative.',
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

function createMyShilohActionTools({
  actionService = createMyShilohClientActionService(),
} = {}) {
  if (
    !actionService
    || typeof actionService.prepareCancellation !== 'function'
    || typeof actionService.prepareReschedule !== 'function'
  ) {
    throw new Error('My Shiloh client action service is required');
  }

  function handles(name) {
    return name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION
      || name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE;
  }

  async function execute(name, args = {}, { sessionId, crmV2ClientId } = {}) {
    if (!handles(name)) return { modelResult: { ok: false, error: 'unknown_action_tool' }, clientAction: null };
    const result = name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE
      ? await actionService.prepareReschedule({
        sessionId,
        crmV2ClientId,
        proposedStartsAt: args.startsAt,
      })
      : await actionService.prepareCancellation({ sessionId, crmV2ClientId });
    if (!result.ok) {
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
      clientAction: [ACTION_TYPE_CANCEL, ACTION_TYPE_RESCHEDULE].includes(result.clientAction?.type)
        ? result.clientAction
        : null,
    };
  }

  return {
    definitions: ACTION_TOOL_DEFINITIONS,
    handles,
    execute,
  };
}

module.exports = {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_DEFINITIONS,
  createMyShilohActionTools,
};
