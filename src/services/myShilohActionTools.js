'use strict';

const { ACTION_TYPE_CANCEL, createMyShilohClientActionService } = require('./myShilohClientActions');

const ACTION_TOOL_NAMES = Object.freeze({
  PREPARE_CANCELLATION: 'prepare_my_cancellation',
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
]);

function createMyShilohActionTools({
  actionService = createMyShilohClientActionService(),
} = {}) {
  if (!actionService || typeof actionService.prepareCancellation !== 'function') {
    throw new Error('My Shiloh client action service is required');
  }

  function handles(name) {
    return name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION;
  }

  async function execute(name, _args = {}, { sessionId, crmV2ClientId } = {}) {
    if (!handles(name)) return { modelResult: { ok: false, error: 'unknown_action_tool' }, clientAction: null };
    const result = await actionService.prepareCancellation({ sessionId, crmV2ClientId });
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
      clientAction: result.clientAction?.type === ACTION_TYPE_CANCEL ? result.clientAction : null,
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
