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

const { createAssistantPreparation } = require('./myShilohAssistantPreparation');

const ACTION_TOOL_NAMES = Object.freeze({
  PREPARE_BOOKING: 'prepare_my_booking',
  PREPARE_VISIT: 'prepare_my_visit',
  PREPARE_CANCELLATION: 'prepare_my_cancellation',
  PREPARE_RESCHEDULE: 'prepare_my_reschedule',
  PREPARE_CONSULTATION_FORM: 'prepare_my_consultation_form',
  OPEN_PROFILE: 'open_my_personal_details',
  OPEN_PLANNING_REQUEST: 'open_my_reception_planning_request',
});

const ACTION_TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    name: ACTION_TOOL_NAMES.PREPARE_CANCELLATION,
    description: 'Prepare, but do not execute, cancellation of the authenticated client’s selected owned upcoming Shiloh appointment. This creates a confirmation card that the client must explicitly approve.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { appointmentStartsAt: { type: ['string', 'null'], description: 'Exact startsAt from get_my_upcoming_bookings for the appointment chosen by the client; null only when they explicitly mean their next appointment.' } },
      required: ['appointmentStartsAt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: ACTION_TOOL_NAMES.PREPARE_RESCHEDULE,
    description: 'Prepare a reschedule request for the authenticated client’s selected owned appointment using an exact startsAt returned by find_available_slots. This never moves the appointment; client confirmation and the authorized clinic decision are still required.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        appointmentStartsAt: { type: ['string', 'null'], description: 'Exact original startsAt from get_my_upcoming_bookings; null only for an explicit next-appointment request.' },
        startsAt: {
          type: 'string',
          description: 'Exact ISO 8601 slot start returned by find_available_slots.',
        },
      },
      required: ['startsAt', 'appointmentStartsAt'],
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

const PLANNING_REQUEST_TOOL_DEFINITION = Object.freeze({
  type: 'function',
  name: ACTION_TOOL_NAMES.OPEN_PLANNING_REQUEST,
  description: 'Open the signed-in Reception planning form for a flexible time, group visit or tailored event. This only opens the form; no request or appointment is created until the client reviews and submits it.',
  strict: true,
  parameters: { type: 'object', properties: {
    serviceDetail: { type: ['string','null'], description:'Treatment requested, at most 160 characters. Never include health answers.' },
    preferredDate: { type: ['string','null'], description:'Client chosen date YYYY-MM-DD, or null.' },
    preferredDaypart: { type: ['string','null'], enum:['morning','afternoon','any',null] },
    clientNote: { type: ['string','null'], description:'Only client supplied scheduling preferences, practitioner, flexibility and question for Reception. At most 500 characters. No health answers.' },
  }, required: ['serviceDetail','preferredDate','preferredDaypart','clientNote'], additionalProperties: false },
});

const PREPARATION_TOOL_DEFINITIONS = [
  { type:'function', name:ACTION_TOOL_NAMES.PREPARE_BOOKING, strict:true,
    description:'Prepare the existing booking flow from an exact canonical treatment and optional client-chosen practitioner and returned slot. Rechecks current service, price, eligibility and slot; never submits or holds a booking.',
    parameters:{ type:'object', properties:{ service:{type:'string'}, practitioner:{type:['string','null']}, startsAt:{type:['string','null']} }, required:['service','practitioner','startsAt'], additionalProperties:false } },
  { type:'function', name:ACTION_TOOL_NAMES.PREPARE_VISIT, strict:true,
    description:'Prepare a status-only pre-visit checklist with canonical deposit and treatment balance, and existing secure actions. Never reads health answers.',
    parameters:{ type:'object', properties:{ appointmentStartsAt:{type:['string','null']} }, required:['appointmentStartsAt'], additionalProperties:false } },
];

function createMyShilohActionTools({
  actionService = createMyShilohClientActionService(),
  formActionService = createMyShilohConsultationFormActionService(),
  preparation = createAssistantPreparation(),
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
    return PREPARATION_TOOL_DEFINITIONS.some(tool => tool.name === name) || name === ACTION_TOOL_NAMES.PREPARE_CANCELLATION
      || name === ACTION_TOOL_NAMES.PREPARE_RESCHEDULE
      || name === ACTION_TOOL_NAMES.PREPARE_CONSULTATION_FORM
      || name === ACTION_TOOL_NAMES.OPEN_PROFILE
      || name === ACTION_TOOL_NAMES.OPEN_PLANNING_REQUEST;
  }

  async function execute(name, args = {}, { sessionId, crmV2ClientId } = {}) {
    if (!handles(name)) return { modelResult: { ok: false, error: 'unknown_action_tool' }, clientAction: null };
    if (name === ACTION_TOOL_NAMES.PREPARE_BOOKING) return preparation.prepareBooking(args, crmV2ClientId);
    if (name === ACTION_TOOL_NAMES.PREPARE_VISIT) return preparation.checklist(args, crmV2ClientId);
    if (name === ACTION_TOOL_NAMES.OPEN_PLANNING_REQUEST) {
      const draft = {};
      for (const [key, max] of [['serviceDetail',160],['clientNote',500]]) {
        if (typeof args[key] === 'string') draft[key] = args[key].trim().slice(0,max);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(args.preferredDate || '')) draft.preferredDate = args.preferredDate;
      if (['morning','afternoon','any'].includes(args.preferredDaypart)) draft.preferredDaypart = args.preferredDaypart;
      return {
        modelResult: { ok: true, prepared: true, action: 'reception_planning', message: 'The signed-in Reception planning form is ready. Nothing has been submitted or booked.' },
        clientAction: {
          type: 'planning_request', title: 'Tell Reception your plans',
          detail: 'Share a flexible time, group visit or special occasion with the clinic team.',
          note: 'Reception will review your request and arrange the details with you. This does not book an appointment.',
          label: 'Open request form', href: '/my-shiloh/request', draft,
        },
      };
    }
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
        appointmentStartsAt: args.appointmentStartsAt ?? null,
      })
      : await actionService.prepareCancellation({ sessionId, crmV2ClientId, appointmentStartsAt: args.appointmentStartsAt ?? null });
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
    definitions: [...PREPARATION_TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS, CONSULTATION_FORM_TOOL_DEFINITION, PROFILE_TOOL_DEFINITION, PLANNING_REQUEST_TOOL_DEFINITION],
    handles,
    execute,
  };
}

module.exports = {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_DEFINITIONS,
  CONSULTATION_FORM_TOOL_DEFINITION,
  PROFILE_TOOL_DEFINITION,
  PLANNING_REQUEST_TOOL_DEFINITION,
  createMyShilohActionTools,
};
