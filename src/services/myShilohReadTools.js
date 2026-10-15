'use strict';

const clientContext = require('./myShilohClientContext');
const { authoritativeSlotsForIntent } = require('./clientBookingAvailability');
const { createClientPlanningRequestService } = require('./clientPlanningRequests');
const { createShilohRewardsService } = require('./shilohRewards');

const TOOL_NAMES = Object.freeze({
  TREATMENT_HISTORY: 'get_my_treatment_history',
  REQUEST_STATUS: 'get_my_request_status',
  NEXT_APPOINTMENT: 'get_my_next_appointment',
  UPCOMING_BOOKINGS: 'get_my_upcoming_bookings',
  FORM_STATUS: 'get_my_form_status',
  PAYMENT_STATUS: 'get_my_payment_status',
  REWARDS_STATUS: 'get_my_rewards_status',
  FIND_AVAILABLE_SLOTS: 'find_available_slots',
});

const READ_TOOL_DEFINITIONS = Object.freeze([
  ...[
    [TOOL_NAMES.TREATMENT_HISTORY, 'Read the signed-in client’s own recent completed treatments, only after they ask to repeat a past treatment or book their usual. History does not prove current eligibility, price or availability. Ask which treatment if ambiguous; never invent a usual.'],
    [TOOL_NAMES.REQUEST_STATUS, 'Read canonical appointment change, booking and Reception request states. Pending is awaiting Shiloh approval, not a confirmed change.'],
  ].map(([name, description]) => ({ type: 'function', name, description, strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } })),
  {
    type: 'function',
    name: TOOL_NAMES.NEXT_APPOINTMENT,
    description: 'Get the authenticated client’s next canonical Shiloh appointment and its booking-request approval state. Pending requests are not confirmed bookings.',
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
    name: TOOL_NAMES.UPCOMING_BOOKINGS,
    description: 'Get up to ten upcoming canonical Shiloh appointments with booking-request approval states. Pending requests are not confirmed bookings.',
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
    name: TOOL_NAMES.FORM_STATUS,
    description: 'Get consultation-form status for the authenticated client’s selected owned appointment. This returns status only and never form answers.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { appointmentStartsAt: { type: ['string','null'], description:'Exact startsAt of the client-selected booking; null for their next visit.' } },
      required: ['appointmentStartsAt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.PAYMENT_STATUS,
    description: 'Get payment position for the authenticated client’s selected owned appointment from Shiloh’s canonical payment authority.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { appointmentStartsAt: { type: ['string','null'], description:'Exact startsAt of the client-selected booking; null for their next visit.' } },
      required: ['appointmentStartsAt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.REWARDS_STATUS,
    description: 'Get the authenticated client’s Shiloh Rewards balance, unlock status and agreed earning policy from the rewards ledger.',
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
    name: TOOL_NAMES.FIND_AVAILABLE_SLOTS,
    description: 'Check canonical client-bookable availability for a Shiloh service on an exact local date. This is read-only and never books a slot.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'The Shiloh treatment or service name requested by the client.',
        },
        date: {
          type: 'string',
          description: 'Exact local clinic date in YYYY-MM-DD format.',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
        practitioner: {
          type: ['string', 'null'],
          description: 'Exact requested client-bookable practitioner name, or null for any eligible practitioner.',
        },
        afterTime: { type: ['string','null'], description:'Only return canonical slots strictly later than this clinic-local HH:MM time. Use for later-time followups; null for no lower bound.', pattern:'^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
        daypart: {
          type: ['string', 'null'],
          enum: ['morning', 'afternoon', 'evening', null],
          description: 'Optional local daypart filter.',
        },
      },
      required: ['service', 'date', 'practitioner', 'daypart', 'afterTime'],
      additionalProperties: false,
    },
  },
]);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function safeText(value, max = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function publicAppointment(appointment) {
  if (!appointment) return null;
  return {
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: String(appointment.status || ''),
    bookingRequestStatus: appointment.bookingRequestStatus || null,
    services: Array.isArray(appointment.services) ? appointment.services.map(String).filter(Boolean) : [],
    practitioners: Array.isArray(appointment.practitioners) ? appointment.practitioners.map(String).filter(Boolean) : [],
  };
}

function publicPayment(payment) {
  if (!payment) return { state: 'none' };
  return {
    state: String(payment.state || 'unknown'),
    currency: String(payment.currency || 'ZAR'),
    amountDue: payment.amountDue == null ? null : String(payment.amountDue),
    paid: payment.paid == null ? null : String(payment.paid),
    refunded: payment.refunded == null ? null : String(payment.refunded),
    netPaid: payment.netPaid == null ? null : String(payment.netPaid),
    rewardsApplied: payment.rewardsApplied == null ? null : String(payment.rewardsApplied),
    outstanding: payment.outstanding == null ? null : String(payment.outstanding),
    depositState: payment.depositState || null,
    depositRequired: payment.depositRequired == null ? null : String(payment.depositRequired),
    depositOutstanding: payment.depositOutstanding == null ? null : String(payment.depositOutstanding),
    priorPaid: payment.priorPaid == null ? null : String(payment.priorPaid),
    welcomeVoucherApplied: payment.welcomeVoucherApplied == null ? null : String(payment.welcomeVoucherApplied),
    treatmentCreditApplied: payment.treatmentCreditApplied == null ? null : String(payment.treatmentCreditApplied),
    giftVoucherApplied: payment.giftVoucherApplied == null ? null : String(payment.giftVoucherApplied),
    securePaymentAvailable: Boolean(payment.activePaymentPath),
  };
}

function createMyShilohReadTools({
  contextService = clientContext,
  availability = authoritativeSlotsForIntent,
  rewardsService = createShilohRewardsService(),
  planningService = createClientPlanningRequestService(),
  now = () => new Date(),
} = {}) {
  if (!contextService || typeof contextService.loadNextAppointment !== 'function') {
    throw new Error('My Shiloh client context service is required');
  }
  if (typeof availability !== 'function') throw new Error('Canonical client availability service is required');

  async function execute(name, args = {}, { crmV2ClientId } = {}) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return { ok: false, error: 'authenticated_client_unavailable' };

    if (name === TOOL_NAMES.TREATMENT_HISTORY) {
      return { ok: true, treatments: await contextService.loadTreatmentHistory(clientId), currentBookingCheckRequired: true };
    }
    if (name === TOOL_NAMES.REQUEST_STATUS) {
      const [context, changes, plans] = await Promise.all([
        contextService.getContext({ crmV2ClientId: clientId }),
        contextService.loadRescheduleHistory(clientId), planningService.forClient(clientId),
      ]);
      return { ok: true, changes,
        bookings: [...(context.activeRequests || []), ...(context.declinedRequests || []).filter(item => item.historyHidden === false)].map(publicAppointment),
        reception: plans.map(item => ({ status: String(item.status), service: String(item.service_name || item.service_detail || '') })),
        pendingMeans: 'Awaiting Shiloh approval; original appointment remains unchanged.' };
    }
    if (name === TOOL_NAMES.NEXT_APPOINTMENT) {
      const appointment = await contextService.loadNextAppointment(clientId);
      return {
        ok: true,
        found: Boolean(appointment),
        appointment: publicAppointment(appointment),
      };
    }

    if (name === TOOL_NAMES.UPCOMING_BOOKINGS) {
      const appointments = await contextService.loadUpcomingAppointments(clientId, { limit: 10 });
      return {
        ok: true,
        count: appointments.length,
        bookings: appointments.map(publicAppointment),
      };
    }

    if (name === TOOL_NAMES.FORM_STATUS) {
      const candidates = args.appointmentStartsAt != null
        ? (await contextService.loadUpcomingAppointments(clientId, { limit:10 })).filter(item => item.startsAt === args.appointmentStartsAt)
        : [await contextService.loadNextAppointment(clientId)].filter(Boolean);
      if (candidates.length > 1) return { ok:false, error:'ambiguous_appointment' };
      const appointment = candidates[0];
      if (!appointment) return { ok: true, appointmentFound: false, forms: [] };
      const forms = await contextService.loadForms(clientId, appointment.id);
      return {
        ok: true,
        appointmentFound: true,
        appointment: publicAppointment(appointment),
        forms: forms.map(form => ({
          title: String(form.title || 'Consultation form'),
          status: String(form.status || 'unknown'),
          actionRequired: form.actionRequired === true,
        })),
      };
    }

    if (name === TOOL_NAMES.PAYMENT_STATUS) {
      const candidates = args.appointmentStartsAt != null
        ? (await contextService.loadUpcomingAppointments(clientId, { limit:10 })).filter(item => item.startsAt === args.appointmentStartsAt)
        : [await contextService.loadNextAppointment(clientId)].filter(Boolean);
      if (candidates.length > 1) return { ok:false, error:'ambiguous_appointment' };
      const appointment = candidates[0];
      if (!appointment) {
        return { ok: true, appointmentFound: false, payment: { state: 'none' } };
      }
      const payment = await contextService.loadPayment(appointment);
      return {
        ok: true,
        appointmentFound: true,
        appointment: publicAppointment(appointment),
        payment: publicPayment(payment),
      };
    }

    if (name === TOOL_NAMES.REWARDS_STATUS) {
      const reward = await rewardsService.getClientBalance(clientId);
      return {
        ok: true,
        currency: 'ZAR',
        balance: Number(reward.balance).toFixed(2),
        unlocked: reward.unlocked === true,
        unlockThreshold: Number(reward.unlockThreshold).toFixed(2),
        earnRatePercent: Number(reward.earnRate),
        expiry: 'none',
        redemptionRequiresClientConfirmation: true,
      };
    }

    if (name === TOOL_NAMES.FIND_AVAILABLE_SLOTS) {
      const service = safeText(args.service);
      const date = dateOnly(args.date);
      const practitioner = args.practitioner == null ? null : safeText(args.practitioner, 80);
      const daypart = args.daypart == null ? null : String(args.daypart);
      const afterTime = args.afterTime ?? null;
      if (afterTime !== null && (typeof afterTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(afterTime))) return {ok:false,error:'invalid_availability_request'};
      if (!service || !date || ![null, 'morning', 'afternoon', 'evening'].includes(daypart)) {
        return { ok: false, error: 'invalid_availability_request' };
      }

      const result = await availability({
        service_text: service,
        preferred_date: date,
        preferred_time: null,
        therapist_text: practitioner || 'Any available therapist',
        service_verified: true,
        status: 'collecting',
      }, {
        daypart,
        now: now(),
      });

      const canonical = Array.isArray(result.slots) ? result.slots : [];
      const clock = value => new Intl.DateTimeFormat('en-GB', {timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
      const slots = canonical.filter(slot => afterTime === null || clock(slot.starts_at) > afterTime);
      return {
        ok: true,
        status: canonical.length && !slots.length ? 'no_slots' : String(result.status || 'unknown'),
        date,
        service: result.service?.name || service,
        requestedPractitioner: practitioner,
        afterTime,
        daypart,
        slots: slots.slice(0, 8).map(slot => ({
          startsAt: new Date(slot.starts_at).toISOString(),
          endsAt: new Date(slot.ends_at).toISOString(),
          practitioner: String(slot.staff_name || ''),
        })),
        moreAvailable: slots.length > 8,
        readOnly: true,
      };
    }

    return { ok: false, error: 'unknown_tool' };
  }

  return {
    definitions: READ_TOOL_DEFINITIONS,
    execute,
  };
}

module.exports = {
  TOOL_NAMES,
  READ_TOOL_DEFINITIONS,
  positiveId,
  dateOnly,
  safeText,
  publicAppointment,
  publicPayment,
  createMyShilohReadTools,
};
