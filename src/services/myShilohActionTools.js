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
    description: 'Prepare, but do not execute, a practitioner-approved reschedule request for the authenticated client’s next appointment. Only call this after the client explicitly chooses one exact startsAt value returned by find_available_slots. Never choose a slot for the client.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        startsAt: {
          type: 'string',
          description: 'The exact ISO startsAt value from the canonical find_available_slots result explicitly chosen by the client.',
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
        proposedStartsAt: args?.startsAt,
      })
      : await actionService.prepareCancellation({ sessionId, crmV2ClientId });
    if (!result.ok) {
      const reschedule = name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE;
      if (result.code === 'CLIENT_ACTION_NO_UPCOMING_APPOINTMENT') {
        return {
          modelResult: {
            ok: false,
            error: 'no_upcoming_appointment',
            message: 'There is no upcoming appointment available for this request.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_COMPLEX_BOOKING') {
        return {
          modelResult: {
            ok: false,
            error: 'complex_booking',
            message: 'This linked, group, or complex appointment needs help from the clinic team. Nothing has changed.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_ALREADY_PENDING') {
        return {
          modelResult: {
            ok: false,
            error: 'already_pending',
            message: 'A reschedule request is already waiting for practitioner approval. The current appointment remains unchanged.',
          },
          clientAction: null,
        };
      }
      if (result.code === 'CLIENT_ACTION_SLOT_UNAVAILABLE' || result.code === 'CLIENT_ACTION_INVALID_RESCHEDULE') {
        return {
          modelResult: {
            ok: false,
            error: 'slot_unavailable',
            message: 'That exact requested time is not currently available. Nothing has changed; please check availability again.',
          },
          clientAction: null,
        };
      }
      return {
        modelResult: {
          ok: false,
          error: 'action_unavailable',
          message: reschedule
            ? 'A reschedule confirmation could not be prepared safely. The current appointment is unchanged.'
            : 'A cancellation confirmation could not be prepared safely.',
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
